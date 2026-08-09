# Deployment

Larafeed runs as one Cloudflare Worker with Static Assets, D1, Workers KV, three Queues, Cron, a rate-limit binding, and an optional Images binding.

## Deploy button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/angristan/larafeed)

During setup:

1. Set `AUTH_ORIGIN` to the exact public HTTPS origin, without a trailing slash.
2. Generate `AUTH_OPERATOR_SECRET` with `openssl rand -hex 32` and save it securely.
3. Keep each `*_QUEUE_NAME` value identical to its Queue resource name.
4. Deploy.

The deployment builds the application, applies every D1 migration, and deploys the Worker with Smart Placement. The WebAuthn RP ID is derived from `AUTH_ORIGIN`; it never comes from the request `Host` header.

After the first deployment, open the D1 database settings and enable Read Replication. Larafeed uses D1 Sessions so authenticated requests start with current primary state and later reads can use sequentially consistent replicas.

## Manual deployment

Requirements: Node.js 24, npm, Bun, and an authenticated Wrangler session. The portable environment is the default, unnamed environment in `wrangler.jsonc`. The `production` named environment belongs to this repository's maintainer. A fork must not use it without replacing every route and resource binding.

### Provision a fresh portable environment

Install dependencies, then create the D1 database, full-content KV namespace, and all three Queues. These commands create remote resources:

```bash
npm ci
npm exec -- wrangler d1 create larafeed-template
npm exec -- wrangler kv namespace create larafeed-template-full-content
npm exec -- wrangler queues create larafeed-template-feed-refresh
npm exec -- wrangler queues create larafeed-template-opml-import
npm exec -- wrangler queues create larafeed-template-favicon-refresh
```

Before deployment, edit the default environment in `wrangler.jsonc`:

1. Replace D1 `database_id` value `00000000-0000-0000-0000-000000000010` with the ID returned by `wrangler d1 create`.
2. Replace the `FULL_CONTENT_KV` `id` value `00000000000000000000000000000010` with the ID returned by `wrangler kv namespace create`.
3. Set `AUTH_ORIGIN` to the exact public HTTPS origin, without a path or trailing slash.
4. Change the Worker `name` if `larafeed-template` is already in use in the account.
5. If you change a Queue resource name, replace it in its producer, consumer, and matching `*_QUEUE_NAME` variable. These three values must be identical.
6. If you change the D1 name, update `database_name` as well as the ID.

Set the required operator secret through Wrangler's hidden prompt. Generate and store a private value in a password manager first. Do not put the value on the command line.

```bash
npm exec -- wrangler secret put AUTH_OPERATOR_SECRET --config wrangler.jsonc
```

Then run the repository release validation and deploy:

```bash
npm run validate:release
npm run deploy
```

`npm run deploy` builds the portable environment, dry-runs that generated artifact, applies remote D1 migrations, and deploys the same artifact without rebuilding it. Existing manual environments can start at the secret or validation step after confirming that all configured resources already exist.

## Create the first administrator

Run this from an interactive terminal after deployment. The script asks for the operator secret with terminal echo disabled, so the value does not enter shell history.

```bash
npm run auth:access-link -- \
  --url https://reader.example.com/api/auth/operator/access-link \
  --mode initial-admin \
  --username admin \
  --email admin@example.com \
  --display-name Admin
```

Replace `reader.example.com` with the deployment hostname. Open the returned URL and register a passkey. The one-time token is stored in the URL fragment and expires after 30 minutes.

If every administrator loses access, recover an existing enabled administrator:

```bash
npm run auth:access-link -- \
  --url https://reader.example.com/api/auth/operator/access-link \
  --mode recover-admin \
  --user-id USER_ID
```

Administrators can invite and recover other users from `/admin/users`. Non-interactive automation can inject `LARAFEED_OPERATOR_SECRET` through its secret store. Do not use an inline literal assignment in a shell command.

## Import subscriptions

Open `/settings/opml` and upload an OPML file. Imports are asynchronous and can partially succeed. A stale `xmlUrl` can recover through its safe `htmlUrl`; the first discovered posts are stored before the item succeeds. Exports use canonical feed URLs and preserve categories and custom titles. The current limits are 2 MB, 500 unique feed URLs, and 50 outline levels.

## Optional features

All optional integrations fail closed.

### Turnstile

Turnstile is disabled by default. To enable it:

1. Create hostname-bound Turnstile keys.
2. Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` as Worker secrets.
3. Set `TURNSTILE_ENABLED=true` and deploy again.

Both keys are required when enabled. Passkey rate limiting and exact-origin checks remain active when Turnstile is disabled.

### Images and favicons

Set `IMAGES_ENABLED=true` to enable ownership-checked article image transforms. Also set `FAVICON_REFRESH_ENABLED=true` to discover and normalize favicons. Bitmap favicons are normalized to 32×32 PNGs. SVG favicons pass through a strict local allowlist sanitizer and are stored separately with sandboxed delivery headers. Favicons are stored in D1; Larafeed does not require R2.

Migration `0018_favicon_svg_assets.sql` supports a safe Worker rollback. An older Worker treats SVG-backed hashes as missing, so the client shows its RSS fallback icon. Redeploy an SVG-aware Worker to restore those favicons; do not drop the SVG table during a routine rollback.

### AI summaries

AI summaries run on [Workers AI](https://developers.cloudflare.com/workers-ai/) through the `AI` binding, routed via [AI Gateway](https://developers.cloudflare.com/ai-gateway/). No API keys or secrets are needed; usage bills to the Workers plan (10,000 free Neurons per day, then $0.011 per 1,000 Neurons on Workers Paid).

Set `AI_SUMMARY_ENABLED=true`, `AI_GATEWAY_NAME`, and `AI_MODEL` (a Workers AI model such as `@cf/mistralai/mistral-small-3.1-24b-instruct`), then deploy. The named gateway must exist in the account; use `default` to auto-create one on first use. Request logging follows the gateway's own settings (managed in `cloudflare-tf`).

## Next steps

- Check `GET /up` and `GET /api/health`.
- Import subscriptions through OPML.
- Review Queue failures before increasing refresh capacity.
- Read the [operations guide](operations.md) before rollback or recovery.
- Read the [compatibility API guide](compatibility-apis.md) when configuring a reader client.

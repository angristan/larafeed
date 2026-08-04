# Deployment

Larafeed runs as one Cloudflare Worker with Static Assets, D1, three Queues, Cron, a rate-limit binding, and an optional Images binding.

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

Requirements: Node.js 24, npm, Bun, and an authenticated Wrangler session.

```bash
npm ci
npm run validate
npm run d1:validate:large
npm run deploy
```

`npm run deploy` builds the portable environment, applies remote D1 migrations, and deploys it. Set `AUTH_OPERATOR_SECRET` as a Worker secret before users enroll.

The `production` and `test` named environments in `wrangler.jsonc` belong to this repository's maintainer. A fork must replace every route and resource binding before using those environments.

## Create the first administrator

Run this from a checkout after deployment:

```bash
LARAFEED_OPERATOR_SECRET='your-secret' npm run auth:access-link -- \
  --url https://reader.example.com/api/auth/operator/access-link \
  --mode initial-admin \
  --username admin \
  --email admin@example.com \
  --display-name Admin
```

Replace `reader.example.com` with the deployment hostname. Open the returned URL and register a passkey. The one-time token is stored in the URL fragment and expires after 30 minutes.

If every administrator loses access, recover an existing enabled administrator:

```bash
LARAFEED_OPERATOR_SECRET='your-secret' npm run auth:access-link -- \
  --url https://reader.example.com/api/auth/operator/access-link \
  --mode recover-admin \
  --user-id USER_ID
```

Administrators can invite and recover other users from `/admin/users`.

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

Set `IMAGES_ENABLED=true` to enable ownership-checked article image transforms. Also set `FAVICON_REFRESH_ENABLED=true` to discover and normalize favicons. Favicons are stored in D1; Larafeed does not require R2.

### AI summaries

AI summaries are disabled by default. Create an AI Gateway with provider budgets and rate limits, then set these Worker secrets:

```bash
npm exec -- wrangler secret put AI_GATEWAY_ACCOUNT_ID --config wrangler.jsonc
npm exec -- wrangler secret put GEMINI_API_KEY --config wrangler.jsonc
```

Set `AI_GATEWAY_NAME`, `AI_MODEL`, and `AI_SUMMARY_ENABLED=true`, then deploy again. Prompt and response logging is disabled by the application.

## Next steps

- Check `GET /up` and `GET /api/health`.
- Import subscriptions through OPML.
- Review Queue failures before increasing refresh capacity.
- Read the [operations guide](operations.md) before rollback or recovery.
- Read the [compatibility API guide](compatibility-apis.md) when configuring a reader client.

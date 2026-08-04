# Larafeed

Larafeed is a private feed reader built on Cloudflare Workers.

![Larafeed reader](.github/readme/reader.png)

## Features

- Original Larafeed React and Mantine interface preserved with resizable panes, theme control, shortcuts, feed/category scopes, and stable pagination
- Read watermarks, sparse read exceptions, favorites, archives, and filtered-state preservation
- RSS, Atom, RDF, and JSON Feed ingestion with secure bounded fetching and sanitization
- Durable feed refresh, OPML, and favicon jobs with one feed per Queue invocation, bounded retries, and authoritative D1 failure history
- Passkey-only authentication with mandatory rate limits, optional Turnstile, passkey management, private enrollment, recovery, and opaque sessions
- Profile, account-data, and administrator access management with a D1 security-event audit
- Revocable app tokens for Google Reader and Fever clients
- Direct feed or website discovery, category management, subscription editing, sparse regex filters, refresh audit, and unsubscribe
- Bounded UTC charts for entry cohorts, real reader transitions, and refresh health
- OPML import, progress, retry, and export
- Ownership-bound Cloudflare Images transformations
- Cached Gemini summaries through Cloudflare AI Gateway
- Fresh D1 bootstrap with OPML subscription import

See [the feature inventory](docs/cloudflare-feature-inventory.md) for implemented, replaced, and intentionally removed legacy behavior.

## Architecture

```text
React + Mantine + React Router + TanStack Query
                       |
                 typed JSON APIs
                       |
             Hono + Effect Worker
              /       |        \
            D1     Queues/Cron  Images
             \          |       /
              durable jobs/outbox
                       |
                  AI Gateway
```

- `worker/` contains the Worker routes, services, repositories, and host handlers.
- `resources/js/cloudflare/` contains the browser application.
- `shared/` contains Effect Schema wire contracts.
- `migrations/` contains D1 migrations.

The application does not use Inertia, Ziggy, passwords, TOTP, River, or a PostgreSQL production runtime.

## Local development

Requirements: Node.js 24, npm, and Bun.

```bash
npm ci
npx playwright install chromium
cp .dev.vars.local.example .dev.vars
npm run types:check:cloudflare
npm run d1:migrate:local
npm run dev
```

The development server uses Cloudflare's local Worker runtime and Vite HMR. `.dev.vars` is local-only. Browser-exposed variables belong in `cloudflare-env/.env.local`.

## Validation

Run the complete local validation path:

```bash
npm run validate
```

This runs formatting, types, generated-binding checks, unit and Workerd tests, browser tests, representative D1 validation, and portable/production/test deployment dry runs. Use `npm run d1:validate:large` before production provisioning. Deployment checks are dry runs. They do not deploy.

## Deploy to Cloudflare

The default Wrangler environment is portable and provisions D1 and the three Queues. The deployment command applies every D1 migration before deploying the Worker.

During setup:

1. Set `AUTH_RP_ID` to the final public hostname only.
2. Set `AUTH_ORIGIN` to its exact HTTPS origin without a trailing slash.
3. Keep the three Queue-name variables synchronized with their Queue resource names.
4. Generate and save a strong `AUTH_OPERATOR_SECRET`.

The RP ID and origin hostname must match. Larafeed never derives authentication trust from the request `Host` header. After deployment, create the first administrator enrollment link with `npm run auth:access-link` and the same operator secret.

The README button will be published after the Cloudflare branch becomes the default branch and a disposable-account installation passes.

## Operations

- [Rebuild architecture and decisions](docs/cloudflare-rebuild-plan.md)
- [Operations, provisioning, alerts, and incidents](docs/cloudflare-operations.md)
- [Capacity and cost model](docs/cloudflare-cost-model.md)
- [Refresh jobs](docs/cloudflare-refresh-jobs.md)
- [OPML](docs/cloudflare-opml.md)
- [Google Reader and Fever](docs/cloudflare-compatibility-apis.md)
- [Images and AI](docs/cloudflare-images-ai.md)

Production uses `larafeed.stanislas.cloud`. The isolated test deployment uses `larafeedcf.stanislas.cloud` with its own WebAuthn RP ID, passkeys, D1 database, queues, and rate-limit namespace. Turnstile is optional and disabled by default.

No command should create resources, import production data, set secrets, or deploy without explicit operator approval.

## License

Larafeed is licensed under the [MIT license](LICENSE).

# Larafeed

Larafeed is a private feed reader built on Cloudflare Workers.

![Larafeed reader](.github/readme/reader.png)

## Features

- Responsive React and Mantine reader with feed/category scopes and stable pagination
- Read watermarks, sparse read exceptions, favorites, archives, and filtered-state preservation
- RSS, Atom, RDF, and JSON Feed ingestion with secure bounded fetching and sanitization
- Durable refresh and OPML jobs with D1, Queues, Cron, outbox recovery, retries, and DLQs
- Passkey-only authentication with Turnstile, passkey management, private enrollment, recovery, and opaque sessions
- Profile, account-data, and administrator access management with a D1 security-event audit
- Revocable app tokens for Google Reader and Fever clients
- Direct feed or website discovery, category management, subscription editing, sparse regex filters, refresh audit, and unsubscribe
- Bounded UTC charts for entry cohorts, real reader transitions, and refresh health
- OPML import, progress, retry, and export
- Ownership-bound Cloudflare Images transformations
- Cached Gemini summaries through Cloudflare AI Gateway
- Deterministic PostgreSQL-to-D1 migration tooling

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
- `cmd/cloudflare-export/` is the read-only legacy PostgreSQL exporter. It is the only Go runtime.

The application does not use Inertia, Ziggy, passwords, TOTP, River, or a PostgreSQL production runtime.

## Local development

Requirements: Node.js 24, npm, Go, and Bun.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run types:check:cloudflare
npm run d1:migrate:local
npm run dev
```

The development server uses Cloudflare's local Worker runtime and Vite HMR. `.dev.vars` is local-only. Browser-exposed variables belong in `cloudflare-env/.env.local`.

## Validation

```bash
npm run lint-check
npm run typecheck
npm run types:check:cloudflare
npm test
go test -race ./...
npm run d1:validate
npm run build
npm run deploy:check
```

Use `npm run d1:validate:large` before a migration rehearsal or cutover. Deployment checks are dry runs. They do not deploy.

## Operations and migration

- [Rebuild architecture and decisions](docs/cloudflare-rebuild-plan.md)
- [Operations, provisioning, alerts, and incidents](docs/cloudflare-operations.md)
- [PostgreSQL-to-D1 migration](docs/cloudflare-migration.md)
- [Refresh jobs](docs/cloudflare-refresh-jobs.md)
- [OPML](docs/cloudflare-opml.md)
- [Google Reader and Fever](docs/cloudflare-compatibility-apis.md)
- [Images and AI](docs/cloudflare-images-ai.md)
- [D1 baseline and validation](docs/cloudflare-baseline.md)

Production uses `larafeed.stanislas.cloud`. The test deployment uses a different hostname, WebAuthn RP ID, Turnstile keys, passkeys, D1 database, queues, and rate-limit namespace.

No command should create resources, import production data, set secrets, or deploy without explicit operator approval.

## License

Larafeed is licensed under the [MIT license](LICENSE).

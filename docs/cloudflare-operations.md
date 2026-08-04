# Cloudflare operations

This runbook covers the private production deployment at `larafeed.stanislas.cloud` and the isolated test deployment at `larafeedcf.stanislas.cloud`. It does not authorize a deployment or resource write.

## Topology

```text
Browser / Reader client
          |
          v
Worker + Static Assets
  |       |        |
  v       v        v
 D1    Queues    Images
  ^       |
  |       v
 Cron   feed/OPML/favicon consumers
  |
  +---- AI Gateway ---- Gemini
```

D1 is authoritative for users, sessions, reader data, normalized favicon assets, durable jobs, outbox commands, imports, and summaries. Queue messages contain operation identifiers only. Production and test use separate D1 databases, queues, rate-limit namespaces, origins, RP IDs, and passkeys. Optional Turnstile keys are environment-specific when enabled.

### Perimeter decision

Cloudflare Access is not placed in front of the whole hostname. Whole-host Access would break Google Reader/Fever clients and public liveness checks, while the application already enforces passkeys, mandatory rate limits, scoped app tokens, CSRF, and ownership at its boundaries. Optional Turnstile can add defense in depth to passkey ceremonies. A future path-scoped Access policy may protect `/admin/*`, but it must preserve `/up`, authentication ceremonies, and machine APIs. Any such durable account/zone policy belongs in `cloudflare-tf` and requires a separate reviewed rollout.

## Declared resources

`wrangler.jsonc` declares:

- Worker names and exact authentication origins/RP IDs.
- Static Assets with SPA fallback and Worker-first `/api/*` routing.
- `DB`, `IMAGES`, and `AUTH_RATE_LIMITER` bindings.
- Same-origin public content-addressed favicon delivery backed by D1 and Cache API.
- Dedicated feed refresh, OPML import, and favicon refresh Queues with one-message consumer batches, bounded concurrency, retries, and authoritative D1 failure history.
- Five-minute production Cron and ten-minute test Cron.
- Exact production and test custom domains with `workers_dev=false`.
- Refresh and AI rollout variables. Production starts with refresh scheduling,
  Queue dispatch, favicon refresh, Images, and AI summaries disabled.
- Native traces at 10% in production and 100% in test. Persisted and invocation
  logs remain disabled in both environments.

The top-level Wrangler environment is the portable Deploy-to-Cloudflare template. It uses placeholder D1 identifiers that the installer replaces and exposes a `workers.dev` hostname. Owner production and test settings are isolated under `env.production` and `env.test`; both explicitly disable `workers.dev` and preview URLs. The test environment uses the checked-in D1 ID and rate-limit namespace. Owner production identifiers remain placeholders until an operator provisions production.

## Secrets

Set these separately for production and test with Wrangler or the Cloudflare dashboard:

- `AUTH_OPERATOR_SECRET` — strong random operator credential.
- Optional `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` — required only
  when `TURNSTILE_ENABLED=true`; both keys must match the environment hostname.
- `AI_GATEWAY_ACCOUNT_ID` — Cloudflare account identifier used in the exact Gateway URL.
- `GEMINI_API_KEY` — provider credential.

Do not put production secrets in `wrangler.jsonc`, `.dev.vars`, shell history, or build output. `TURNSTILE_ENABLED=false` keeps passkey ceremonies independent of Turnstile while mandatory Worker rate limits, origin checks, and single-use challenges remain active. `AI_SUMMARY_ENABLED=false` keeps provider calls disabled even when credentials exist.

## Pre-deployment validation

```bash
npm ci
npm run validate
npm run d1:validate:large
npm run d1:migrations:list:test
npm audit
```

Review [the capacity and cost model](cloudflare-cost-model.md) before changing a rollout limit, sampling rate, retention period, or metered feature.

The Vite plugin selects named Cloudflare environments at build time. `npm run build` creates the portable artifact, `npm run build:production` sets `CLOUDFLARE_ENV=production`, and `npm run build:test` sets `CLOUDFLARE_ENV=test`. The following config-less Wrangler deploy command uses the generated flattened configuration. Never add `--env` after the build.

The Vite large-chunk warning is advisory. Review bundle composition before accepting a material increase.

## Test deployment state

The isolated test environment is provisioned:

- Worker and custom domain: `larafeed-test` at `larafeedcf.stanislas.cloud`.
- D1: `larafeed-test` in Western Europe.
- Dedicated feed refresh and OPML import Queues. The favicon Queue is declared but must be provisioned before deploying this revision.
- Turnstile is disabled by default; previously configured widget keys are not used while `TURNSTILE_ENABLED=false`.
- Refresh scheduling, Queue dispatch, OPML imports, favicon refresh, and Images are enabled for the current isolated test rollout. AI summaries remain disabled until dedicated test Gateway credentials and provider cost controls are configured.

Wrangler owns the Worker custom domain and its DNS record. Deploy the test environment only after explicit approval:

```bash
npm run deploy:test
```

`deploy:test` first applies pending remote test D1 migrations, then builds the
flattened test configuration and deploys it. Migration application creates a D1
backup and each migration is atomic. List pending migrations without changing
remote data with `npm run d1:migrations:list:test`.

## Production provisioning order

Do not run these actions until the operator approves production writes.

1. Create the isolated production D1 database.
2. Replace the production placeholder D1 ID in `wrangler.jsonc`.
3. Create the production feed refresh, OPML import, and favicon refresh Queues.
4. Replace the production placeholder rate-limit namespace ID.
5. Declare the exact production Worker custom domain in Wrangler.
6. Configure the AI Gateway and provider budget/rate limits.
7. Set production Worker secrets.
8. Apply production D1 migrations.
9. Deploy and complete smoke tests before traffic cutover.
10. Optionally configure hostname-bound Turnstile keys and enable the feature in a later reviewed deployment.

After steps 1–7 are reviewed and complete, use the pinned project tools from a clean signed revision:

```bash
npm run d1:migrations:list:production
npm run d1:migrate:production
npm run build:production
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
  npm exec -- wrangler deploy --dry-run
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
  npm exec -- wrangler deploy
```

The migration list must be empty after application. The production build must immediately precede each config-less Wrangler command so `.wrangler/deploy/config.json` cannot point at a stale environment. The dry run must name only owner production resources and keep every initial rollout control disabled. The final command is a production write and requires explicit approval. Wrangler declarations remain the source of truth after identifiers are known.

## Deploy-to-Cloudflare template

The portable top-level environment is separate from owner production. During installation, the user must provide an exact HTTPS `AUTH_ORIGIN` and `AUTH_OPERATOR_SECRET`. The Worker derives the WebAuthn RP ID from the configured origin hostname. D1 and Queues are provisioned automatically. If Queue resources are renamed, the three `*_QUEUE_NAME` variables must be changed to the same exact names; duplicate or unknown names fail closed.

Workers Builds runs `npm run build` and then `npm run deploy`. The deploy script deliberately rebuilds the portable artifact to replace any stale named-environment redirect, applies D1 migrations by binding name, and then follows the fresh Vite-generated deployment redirect. Disabled Turnstile and AI credentials are not requested.

## Fresh database bootstrap

Production starts from an empty D1 database. Legacy PostgreSQL data is not imported.

Before the first deployment, keep costly background work disabled:

```text
REFRESH_SCHEDULER_ENABLED=false
REFRESH_DISPATCH_ENABLED=false
AI_SUMMARY_ENABLED=false
```

Apply every D1 migration, deploy, and enroll the first administrator. Keep `OPML_IMPORT_ENABLED=false` until the operator approves a bounded bootstrap window. In a reviewed revision, enable only OPML import, deploy, import the subscription file, then restore `false` and deploy before enabling Queue dispatch. Inspect initial refresh jobs before enabling scheduled refreshes. Enable AI summaries only after provider credentials and cost controls are verified.

## Initial and recovery access

The operator endpoint is the only zero-admin bootstrap path. The secret stays in an environment variable:

```bash
LARAFEED_OPERATOR_SECRET='...' npm run auth:access-link -- \
  --url https://larafeed.stanislas.cloud/api/auth/operator/access-link \
  --mode initial-admin \
  --username admin \
  --email admin@example.com \
  --display-name Admin
```

Use `--mode recover-admin --user-id ID` only for an existing enabled administrator. One-time tokens are returned in URL fragments and expire after 30 minutes.

Enabled administrators use `/admin/users` for ordinary operations:

- Create one-time enrollment links and copy each plaintext URL once.
- Create recovery links for existing enabled users.
- Revoke outstanding links.
- Disable or reactivate accounts. Disabling revokes active sessions and outstanding links.
- Review recent D1 security events. The final active administrator and the current administrator's own account are protected from dashboard disablement.

Users use `/settings/security` to edit profile fields, add or remove passkeys, clear reader data, or delete their account. Destructive operations require a server-verified session created by a passkey ceremony within five minutes and exact username confirmation. Account deletion clears session cookies, preserves shared feeds, removes orphan feeds, and refuses to remove the final active administrator.

Authentication maintenance removes expired or revoked sessions after 30 days, consumed or expired challenges after one day, consumed/expired/revoked access links after 30 days, and security events after 365 days. Every cleanup query is index-backed and limited to 100 rows; live credentials, links, sessions, and challenges are excluded.

## Rollout controls

| Control | Safe response |
| --- | --- |
| `REFRESH_SCHEDULER_ENABLED=false` | Stop creating scheduled refresh commands. Existing durable work remains. |
| `REFRESH_DISPATCH_ENABLED=false` | Stop every feed-refresh Queue send, including new subscriptions and OPML-created feeds, while retaining outbox commands. |
| `OPML_IMPORT_ENABLED=false` | Reject new OPML imports before creating durable jobs. Existing jobs remain inspectable. |
| `FAVICON_REFRESH_ENABLED=false` | Stop new post-refresh/Cron favicon jobs, orphan cleanup, and manual favicon refresh. Pause the favicon consumer separately if already accepted jobs must stop. Existing D1 assets and durable work remain. |
| `IMAGES_ENABLED=false` | Stop favicon normalization and reject ownership-bound article image transforms before using Images. |
| Lower `REFRESH_DUE_LIMIT` | Reduce each Cron reservation burst. |
| Queue consumer pause/concurrency | Stop or reduce feed, OPML, or favicon consumers without losing D1 state. |
| `AI_SUMMARY_ENABLED=false` | Reject new summary generation without deleting cached summaries. |
| AI Gateway budget/rate limit | Bound provider spend independently of application limits. |

There is no telemetry SDK kill switch because the application relies on native Workers logs and traces. Sampling is configured at the Cloudflare environment level. Every Queue batch contains one message, so the Worker creates one privacy-safe custom span per feed operation: `app.refresh.queue.consume`, `app.opml.queue.consume`, and `app.favicon.queue.consume`. Scheduled spans remain `app.refresh.cron`, `app.opml.cron`, and `app.favicon.cron`. Failures emit one bounded `app.operation.failed` event without raw errors, URLs, identifiers, or payloads. Persisted logs remain disabled until their volume and cost are separately approved.

## Health checks

The unauthenticated `GET /up` endpoint returns `200 OK` with a plain-text `OK` body for process and routing liveness. `GET /api/health` performs a D1 readiness query and returns `503 service_unavailable` without internal details when D1 cannot be reached.

## Dashboards and alerts

Create production and test views separately. Do not include article text, tokens, cookies, passkey payloads, URLs with credentials, or migration content in logs.

Monitor:

- Worker request rate, status classes, exceptions, CPU time, and tail latency.
- Authentication failures, access-link use, disabled users, session errors, and Turnstile failures when the optional feature is enabled.
- D1 database size, query latency, rows read/written, errors, and overloads.
- Queue backlog, oldest message age, retries, and consumer errors for feed refresh, OPML, and favicon work.
- D1 outbox pending age, leased rows past expiry, dead-lettered jobs, oldest due feed, and refresh failure classes.
- OPML active age, failed items, stalled imports, and `queue_redrive_exhausted` terminal state.
- External feed/image failure classes, timeouts, redirect/policy rejection, and response-size rejection.
- Images transformations and unique-transform growth.
- D1 favicon job/outbox age, terminal failures, asset row count and bytes, public route errors, and Cache API cold-miss behavior.
- AI Gateway requests, errors, latency, token/cost budget, rate limiting, and cache hit behavior.

Initial alert policy:

- Page on sustained Worker 5xx/errors, D1 overload, authentication outage, or a growing Queue backlog with no successful consumers.
- Urgent notification on any new D1 `dead_lettered` job, outbox age above 15 minutes, oldest due feed above 60 minutes, or stalled OPML import above 30 minutes.
- Budget alert at 50%, 80%, and 100% for AI Gateway and Images usage; alert on unexpected D1 growth.
- Review security-event spikes and, when enabled, repeated Turnstile failures without logging submitted credentials.

Tune thresholds with real private-deployment traffic. Do not use local Workerd elapsed times as production SLO evidence.

## Worker rollback

D1 migrations are forward-only. Before deployment, confirm that the previous
Worker remains compatible with every migration being applied. If application
code must be rolled back, build the flattened environment configuration, inspect
the recent versions, and select an explicit known-good version:

```bash
npm run build:test
npm exec -- wrangler deployments list
npm exec -- wrangler rollback VERSION_ID \
  --message "rollback test deployment"
```

For production, use the production build/config only after its resource
identifiers are provisioned. Never use a test version ID for production. A code
rollback does not reverse D1 migrations or Queue deliveries. If a migration
needs repair, ship a new forward migration and keep background rollout controls
disabled until it is verified.

## D1 data recovery

The private-service recovery objective is **RPO ≤ 1 hour** and **RTO ≤ 2 hours**. These are operator targets until a production recovery drill proves them. D1 Time Travel supports a timestamp or bookmark within its platform retention window; confirm the current window before relying on it.

An in-place restore is destructive and requires explicit approval:

1. Set every background rollout control to `false` and pause Queue consumers.
2. Record the current Worker version, D1 Time Travel bookmark, Queue backlog, and incident timestamp.
3. Inspect the target without changing data:

   ```bash
   npm exec -- wrangler d1 time-travel info DB --timestamp RFC3339_TIMESTAMP --config wrangler.jsonc --env production
   ```

4. After approval, restore the exact reviewed bookmark or timestamp:

   ```bash
   npm exec -- wrangler d1 time-travel restore DB --bookmark BOOKMARK --config wrangler.jsonc --env production
   ```

Use `--env test` instead for an isolated test recovery drill. Never omit the explicit source config and environment.

5. Reapply only migrations newer than the restored point, deploy a schema-compatible Worker version, and verify `/up`, `/api/health`, migration state, foreign keys, account access, and sampled reader data.
6. Reconcile D1 jobs/outbox with the main Queue backlog before resuming dispatch. Resume low-concurrency dispatch before scheduling.

Time Travel does not undo external feed requests, Queue deliveries, Images transformations, Cache API entries, or AI provider calls. If recovery cannot meet the target without losing accepted user mutations, keep traffic disabled and escalate instead of guessing.

## Incident procedures

### Feed refresh incident

1. Set scheduler and dispatch controls false.
2. Inspect Queue and D1 outbox/job age and failure classes.
3. Fix policy/provider/application cause.
4. Recover stale leases through the scheduled recovery path.
5. Resume dispatch with low concurrency, then resume the scheduler.
6. Inspect terminal D1 jobs and redrive only reviewed operations with the same stable operation ID.

### OPML incident

Pause the OPML consumer. Keep import and item rows. Inspect bounded item errors and stale leases. Resume at low concurrency. Never replay an item by creating an unrelated operation ID.

### Authentication incident

Confirm the exact hostname, RP ID, and origin. If Turnstile is enabled, also confirm its hostname, action, and environment-specific keys. Revoke affected sessions or app tokens. Use operator recovery only when no enabled administrator can act.

### AI or Images cost incident

Set `AI_SUMMARY_ENABLED=false` immediately or enforce a Gateway budget. Set `FAVICON_REFRESH_ENABLED=false` to stop new D1 favicon writes, and set `IMAGES_ENABLED=false` to stop all application image transformations. Cached summaries, immutable D1 favicon rows, and stored upstream sources remain intact.

## Acceptance checklist

- Test and production passkeys cannot cross environments.
- Security headers and SPA deep links work.
- Passkey login/logout/recovery, user passkey management, fresh-auth account deletion, admin enrollment/recovery, and CSRF rejection work.
- Reader lists, detail, state mutations, and read-through work on migrated data.
- Manual/Cron feed refresh and stale favicon refresh use one feed operation per Queue invocation, with independent retry, outbox recovery, and durable terminal D1 state.
- Normal subscription add and OPML import both immediately fetch posts and enqueue an unknown or stale favicon; OPML progress/export work.
- Google Reader and Fever token auth, scope, and revocation work.
- Content-addressed D1 favicons use the public same-origin route, Cache API, immutable browser headers, and no-store errors; the legacy feed-image route is used only during backfill.
- Ownership-bound article Images routes enforce fixed presets, one-day private success caching, and no-store failures.
- AI summaries respect cache, limits, privacy, and kill switch.
- Migration counts, sampled content, and foreign keys match.
- Dashboards, alerts, budgets, and rollout controls are active before traffic cutover.

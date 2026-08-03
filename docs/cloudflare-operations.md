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
 Cron   feed/OPML consumers
  |
  +---- AI Gateway ---- Gemini
```

D1 is authoritative for users, sessions, reader data, durable jobs, outbox commands, imports, and summaries. Queue messages contain operation identifiers only. Production and test use separate D1 databases, queues, rate-limit namespaces, origins, RP IDs, Turnstile keys, and passkeys.

### Perimeter decision

Cloudflare Access is not placed in front of the whole hostname. Whole-host Access would break Google Reader/Fever clients and public liveness checks, while the application already enforces passkeys, Turnstile, scoped app tokens, CSRF, and ownership at its boundaries. A future path-scoped Access policy may add defense in depth for `/admin/*`, but it must preserve `/up`, authentication ceremonies, and machine APIs. Any such durable account/zone policy belongs in `cloudflare-tf` and requires a separate reviewed rollout.

## Declared resources

`wrangler.jsonc` declares:

- Worker names and exact authentication origins/RP IDs.
- Static Assets with SPA fallback and Worker-first `/api/*` routing.
- `DB`, `IMAGES`, and `AUTH_RATE_LIMITER` bindings.
- Feed refresh and OPML import queues, consumers, bounded batches, concurrency, retries, and DLQs.
- Five-minute production Cron and ten-minute test Cron.
- Exact production and test custom domains with `workers_dev=false`.
- Refresh and AI rollout variables. Production starts with refresh scheduling,
  Queue dispatch, favicon refresh, Images, and AI summaries disabled.
- Native traces at 10% in production and 100% in test. Persisted and invocation
  logs remain disabled in both environments.

The test environment uses the checked-in D1 ID and rate-limit namespace. Production identifiers remain placeholders until an operator provisions production. Resource creation is an explicit one-time operator action.

## Secrets

Set these separately for production and test with Wrangler or the Cloudflare dashboard:

- `AUTH_OPERATOR_SECRET` — strong random operator credential.
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` — keys for the environment hostname.
- `AI_GATEWAY_ACCOUNT_ID` — Cloudflare account identifier used in the exact Gateway URL.
- `GEMINI_API_KEY` — provider credential.

Do not put production secrets in `wrangler.jsonc`, `.dev.vars`, shell history, or build output. `AI_SUMMARY_ENABLED=false` keeps provider calls disabled even when credentials exist.

## Pre-deployment validation

```bash
npm ci
npm run validate
npm run d1:validate:large
npm run d1:migrations:list:test
npm audit
```

Review [the capacity and cost model](cloudflare-cost-model.md) before changing a rollout limit, sampling rate, retention period, or metered feature.

The Vite plugin selects named Cloudflare environments at build time. `npm run build:test` sets `CLOUDFLARE_ENV=test`; the following Wrangler command then uses the generated flattened test configuration. Do not add `--env test` to the post-build deploy command.

The Vite large-chunk warning is advisory. Review bundle composition before accepting a material increase.

## Test deployment state

The isolated test environment is provisioned:

- Worker and custom domain: `larafeed-test` at `larafeedcf.stanislas.cloud`.
- D1: `larafeed-test` in Western Europe.
- Dedicated feed refresh, feed DLQ, OPML import, and OPML DLQ queues.
- A hostname-bound managed Turnstile widget and separate Worker secrets.
- AI summaries, refresh scheduling, Queue dispatch, OPML imports, favicon refresh,
  and Images disabled for the initial rollout.

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
3. Create the production feed refresh, feed DLQ, OPML import, and OPML DLQ queues.
4. Replace the production placeholder rate-limit namespace ID.
5. Declare the exact production custom domain in Wrangler.
6. Configure the production Turnstile widget.
7. Configure the AI Gateway and provider budget/rate limits.
8. Set production Worker secrets.
9. Apply production D1 migrations.
10. Deploy and complete smoke tests before traffic cutover.

After steps 1–8 are reviewed and complete, use the pinned project tools from a clean signed revision:

```bash
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
  npm exec -- wrangler d1 migrations list DB --remote
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
  npm exec -- wrangler d1 migrations apply DB --remote
npm run build
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
  npm exec -- wrangler deploy --dry-run --config dist/larafeed/wrangler.json
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
  npm exec -- wrangler deploy --config dist/larafeed/wrangler.json
```

The migration list must be empty after application. The dry run must name only production resources and keep every initial rollout control disabled. The final command is a production write and requires explicit approval. Wrangler declarations remain the source of truth after identifiers are known.

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
| `FAVICON_REFRESH_ENABLED=false` | Stop both stale-favicon Cron reservation and manual favicon refresh. |
| `IMAGES_ENABLED=false` | Reject feed-favicon and ownership-bound article image transforms before using Images. |
| Lower `REFRESH_DUE_LIMIT` | Reduce each Cron reservation burst. |
| Queue consumer pause/concurrency | Stop or reduce feed/OPML consumers without losing D1 state. |
| `AI_SUMMARY_ENABLED=false` | Reject new summary generation without deleting cached summaries. |
| AI Gateway budget/rate limit | Bound provider spend independently of application limits. |

There is no telemetry SDK kill switch because the application relies on native Workers logs and traces. Sampling is configured at the Cloudflare environment level. The Worker creates one privacy-safe custom span at each Queue-batch and scheduled-subsystem boundary: `app.refresh.queue.consume`, `app.opml.queue.consume`, `app.opml.queue.dead_letter`, `app.refresh.cron`, `app.opml.cron`, and `app.favicon.cron`. Failures emit one bounded `app.operation.failed` event without raw errors, URLs, identifiers, or payloads. Persisted logs remain disabled until their volume and cost are separately approved.

## Health checks

The unauthenticated `GET /up` endpoint returns `200 OK` with a plain-text `OK` body for process and routing liveness. `GET /api/health` performs a D1 readiness query and returns `503 service_unavailable` without internal details when D1 cannot be reached.

## Dashboards and alerts

Create production and test views separately. Do not include article text, tokens, cookies, passkey payloads, URLs with credentials, or migration content in logs.

Monitor:

- Worker request rate, status classes, exceptions, CPU time, and tail latency.
- Authentication failures, Turnstile failures, access-link use, disabled users, and session errors.
- D1 database size, query latency, rows read/written, errors, and overloads.
- Queue backlog, oldest message age, retries, consumer errors, and DLQ growth for both domains.
- D1 outbox pending age, leased rows past expiry, dead-lettered jobs, oldest due feed, and refresh failure classes.
- OPML active age, failed items, stalled imports, and DLQ growth.
- External feed/image failure classes, timeouts, redirect/policy rejection, and response-size rejection.
- Images transformations and unique-transform growth.
- AI Gateway requests, errors, latency, token/cost budget, rate limiting, and cache hit behavior.

Initial alert policy:

- Page on sustained Worker 5xx/errors, D1 overload, authentication outage, or a growing Queue backlog with no successful consumers.
- Urgent notification on any DLQ growth, outbox age above 15 minutes, oldest due feed above 60 minutes, or stalled OPML import above 30 minutes.
- Budget alert at 50%, 80%, and 100% for AI Gateway and Images usage.
- Review security-event spikes and repeated Turnstile failures without logging submitted credentials.

Tune thresholds with real private-deployment traffic. Do not use local Workerd elapsed times as production SLO evidence.

## Worker rollback

D1 migrations are forward-only. Before deployment, confirm that the previous
Worker remains compatible with every migration being applied. If application
code must be rolled back, build the flattened environment configuration, inspect
the recent versions, and select an explicit known-good version:

```bash
npm run build:test
npm exec -- wrangler deployments list --config dist/larafeed/wrangler.json
npm exec -- wrangler rollback VERSION_ID --config dist/larafeed/wrangler.json \
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
   npm exec -- wrangler d1 time-travel info DB --timestamp RFC3339_TIMESTAMP
   ```

4. After approval, restore the exact reviewed bookmark or timestamp:

   ```bash
   npm exec -- wrangler d1 time-travel restore DB --bookmark BOOKMARK
   ```

5. Reapply only migrations newer than the restored point, deploy a schema-compatible Worker version, and verify `/up`, `/api/health`, migration state, foreign keys, account access, and sampled reader data.
6. Reconcile D1 jobs/outbox with Queue and DLQ state before resuming dispatch. Resume low-concurrency dispatch before scheduling.

Time Travel does not undo external feed requests, Queue deliveries, Images transformations, or AI provider calls. If recovery cannot meet the target without losing accepted user mutations, keep traffic disabled and escalate instead of guessing.

## Incident procedures

### Feed refresh incident

1. Set scheduler and dispatch controls false.
2. Inspect Queue and D1 outbox/job age and failure classes.
3. Fix policy/provider/application cause.
4. Recover stale leases through the scheduled recovery path.
5. Resume dispatch with low concurrency, then resume the scheduler.
6. Reconcile DLQ items only after their authoritative D1 state is understood.

### OPML incident

Pause the OPML consumer. Keep import and item rows. Inspect bounded item errors and stale leases. Resume at low concurrency. Never replay an item by creating an unrelated operation ID.

### Authentication incident

Confirm exact hostname, RP ID, origin, Turnstile hostname/action, and environment-specific keys. Revoke affected sessions or app tokens. Use operator recovery only when no enabled administrator can act.

### AI or Images cost incident

Set `AI_SUMMARY_ENABLED=false` immediately or enforce a Gateway budget. Set `IMAGES_ENABLED=false` to stop all application image transformations. Cached summaries and stored favicon/article sources remain intact.

## Acceptance checklist

- Test and production passkeys cannot cross environments.
- Security headers and SPA deep links work.
- Passkey login/logout/recovery, user passkey management, fresh-auth account deletion, admin enrollment/recovery, and CSRF rejection work.
- Reader lists, detail, state mutations, and read-through work on migrated data.
- Manual/Cron feed refresh, manual/stale favicon refresh, Queue retry, outbox recovery, and DLQ state work.
- OPML import/progress/export work.
- Google Reader and Fever token auth, scope, and revocation work.
- Opaque Images routes enforce ownership and fixed presets.
- AI summaries respect cache, limits, privacy, and kill switch.
- Migration counts, sampled content, and foreign keys match.
- Dashboards, alerts, budgets, and rollout controls are active before traffic cutover.

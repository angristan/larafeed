# Cloudflare operations

This runbook covers the private production deployment at `larafeed.stanislas.cloud` and the isolated test deployment at `larafeed-test.stanislas.cloud`. It does not authorize a deployment or resource write.

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

## Declared resources

`wrangler.jsonc` declares:

- Worker names and exact authentication origins/RP IDs.
- Static Assets with SPA fallback and Worker-first `/api/*` routing.
- `DB`, `IMAGES`, and `AUTH_RATE_LIMITER` bindings.
- Feed refresh and OPML import queues, consumers, bounded batches, concurrency, retries, and DLQs.
- Five-minute production Cron and ten-minute test Cron.
- Refresh and AI rollout variables.

The checked-in D1 IDs and rate-limit namespace IDs are placeholders until an operator provisions the environments. Resource creation is an explicit one-time operator action.

## Secrets

Set these separately for production and test with Wrangler or the Cloudflare dashboard:

- `AUTH_OPERATOR_SECRET` — strong random operator credential.
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` — keys for the environment hostname.
- `AI_GATEWAY_ACCOUNT_ID` — Cloudflare account identifier used in the exact Gateway URL.
- `GEMINI_API_KEY` — provider credential.

Do not put production secrets in `wrangler.jsonc`, `.dev.vars`, shell history, build output, or migration artifacts. `AI_SUMMARY_ENABLED=false` keeps provider calls disabled even when credentials exist.

## Pre-deployment validation

```bash
npm ci
npm run lint-check
npm run typecheck
npm run types:check:cloudflare
npm test
go test -race ./...
npm run d1:validate:large
npm run deploy:check
npm audit
```

The Vite large-chunk warning is advisory. Review bundle composition before accepting a material increase.

## Provisioning order

Do not run these actions until the operator approves external writes.

1. Create isolated production and test D1 databases.
2. Replace placeholder D1 IDs in `wrangler.jsonc`.
3. Create feed refresh, feed DLQ, OPML import, and OPML DLQ queues for each environment.
4. Replace placeholder rate-limit namespace IDs.
5. Configure both DNS hostnames and exact custom domains/routes.
6. Configure separate Turnstile widgets for both hostnames.
7. Configure the AI Gateway and provider budget/rate limits.
8. Set Worker secrets separately in both environments.
9. Apply D1 migrations to test, then production.
10. Deploy test and complete smoke tests before production cutover.

Wrangler declarations should remain the source of truth after IDs are known.

## Migrations and cutover

Follow [PostgreSQL-to-D1 migration](cloudflare-migration.md). The accepted strategy uses a maintenance window and has no automated rollback.

Before migration:

```text
REFRESH_SCHEDULER_ENABLED=false
REFRESH_DISPATCH_ENABLED=false
AI_SUMMARY_ENABLED=false
```

Pause legacy writes and workers, export one read-only PostgreSQL snapshot, validate/render locally, import in filename order, and run `PRAGMA foreign_key_check` plus row-count checks. Enroll the selected administrator after migration. Re-enable dispatch first, inspect the backlog, then re-enable scheduling.

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

Use `--mode recover-admin --user-id ID` only for an existing enabled administrator. One-time tokens are returned in URL fragments and expire after 30 minutes. Admins use the protected enrollment/recovery APIs for ordinary user provisioning.

## Rollout controls

| Control | Safe response |
| --- | --- |
| `REFRESH_SCHEDULER_ENABLED=false` | Stop creating scheduled refresh commands. Existing durable work remains. |
| `REFRESH_DISPATCH_ENABLED=false` | Stop new Queue sends while retaining outbox commands. |
| Lower `REFRESH_DUE_LIMIT` | Reduce each Cron reservation burst. |
| Queue consumer pause/concurrency | Stop or reduce feed/OPML consumers without losing D1 state. |
| `AI_SUMMARY_ENABLED=false` | Reject new summary generation without deleting cached summaries. |
| AI Gateway budget/rate limit | Bound provider spend independently of application limits. |
| Images route rate limit / binding disable | Bound transforms; the UI falls back safely. |

There is no telemetry SDK kill switch because the application relies on native Workers logs and traces. Sampling is configured at the Cloudflare environment level.

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

Disable AI generation immediately or enforce a Gateway budget. Pause/limit image transformations at the binding/account layer. Cached summaries and stored favicon sources remain intact.

## Acceptance checklist

- Test and production passkeys cannot cross environments.
- Security headers and SPA deep links work.
- Passkey login/logout/recovery and CSRF rejection work.
- Reader lists, detail, state mutations, and read-through work on migrated data.
- Manual/Cron refresh, Queue retry, outbox recovery, and DLQ state work.
- OPML import/progress/export work.
- Google Reader and Fever token auth, scope, and revocation work.
- Opaque Images routes enforce ownership and fixed presets.
- AI summaries respect cache, limits, privacy, and kill switch.
- Migration counts, sampled content, and foreign keys match.
- Dashboards, alerts, budgets, and rollout controls are active before traffic cutover.

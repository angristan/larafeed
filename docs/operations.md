# Operations

D1 is authoritative for users, reader data, sessions, imports, summaries, durable jobs, and outbox messages. Queue messages contain only stable operation IDs. Cloudflare Queues provide delivery, not durable job history.

## Routine commands

```bash
npm run validate          # full local validation and deployment dry runs
npm run validate:release  # canonical gate, including production-shaped D1 validation
npm run deploy:check      # portable deployment dry run
npm run deploy            # checked migration and deployment of the portable environment
```

The named maintainer environment uses the matching `:production` scripts. Each deployment script runs this fixed sequence:

```text
build -> deployment dry run -> remote D1 migration -> deploy the same build output
```

The Vite build selects the environment and writes the flattened deployment configuration. The dry run and final config-less Wrangler command use that generated artifact. Nothing rebuilds between the dry run and deployment.

Cloudflare Workers Builds watches `main` and deploys production automatically. Its deploy command must be `npm run release:production`, not a dashboard-defined sequence of validation, migration, and deployment commands. This versioned script runs `npm run validate:release`, then the checked production deployment sequence above. The build image must have the Chromium runtime required by `npm run test:browser`. Use the same `npm run release:production` command for an approved manual production release. Use `npm run deploy:production` only when validation already passed for the exact checkout.

D1 migrations are forward-only. Apply a corrective migration instead of editing an applied migration. Use expand/contract changes: deploy a backward-compatible schema expansion before code depends on it, and remove old columns or behavior only after all live Worker versions no longer use them.

## Health checks

- `GET /up` returns plain-text `OK` when routing and the Worker are alive.
- `GET /api/health` checks D1 and returns a sanitized `503` when it is unavailable.

## Rollout controls

| Variable | Effect when disabled |
| --- | --- |
| `REFRESH_SCHEDULER_ENABLED` | Stops creation of scheduled refresh jobs. |
| `REFRESH_DISPATCH_ENABLED` | Keeps commands in D1 but stops new Queue sends. |
| `OPML_IMPORT_ENABLED` | Rejects new imports. Existing imports remain durable. |
| `FAVICON_REFRESH_ENABLED` | Stops new favicon work and asset cleanup. |
| `IMAGES_ENABLED` | Rejects article and favicon transformations. |
| `AI_SUMMARY_ENABLED` | Stops provider calls. Cached summaries remain readable. |

`REFRESH_DUE_LIMIT` controls how many due feeds each Cron run reserves and must stay between 1 and 100. Pausing a Queue consumer is separate from disabling its producer.

## Background jobs

Feed refresh, OPML discovery, and favicon refresh each use a dedicated Queue. Every message contains one operation ID, and every consumer batch contains one message.

```text
request or Cron
  -> D1 job + outbox row
  -> Queue { operationId }
  -> consumer claims D1 lease
  -> bounded external work
  -> atomic D1 completion
```

Duplicate delivery is safe. Cron reclaims stale leases and redrives lost delivery with the same operation ID. D1 records bounded attempts, failure classes, and terminal state. Larafeed does not use Queue DLQs.

Successful feed refreshes use an adaptive interval. A refresh that creates entries resets the interval to 15 minutes. Consecutive unchanged responses use 30 minutes, 1 hour, 2 hours, 6 hours, and then 24 hours. RSS `ttl`, HTTP `Cache-Control: max-age`, and HTTP `Expires` can increase that interval up to 24 hours. A 200 response replaces or clears the stored publisher hint; a 304 without a hint preserves it. Feed documents with more than the retained entry window stay at 15 minutes so adaptive scheduling cannot increase their ingestion-loss risk.

## Application limits

These are application bounds, not Cloudflare platform limits.

| Area | Important bounds |
| --- | --- |
| Feed refresh | 15-second deadline, 5 redirects, 10 MiB response, newest 20 valid entries, 15-minute to 24-hour adaptive interval, 8 processing attempts, 10 outbox attempts, 5-minute manual cooldown. The 20-entry window keeps the worst-case D1 commit below the 50-query Free-plan invocation limit. |
| OPML | 2 MB, 500 unique feeds, 50 outline levels, one concurrent discovery consumer. |
| Favicons | 1 MiB site HTML head, 256 KiB manifest or inline image, 2 MiB remote image, 3 redirects, bounded ICO decoding, fixed 32×32 PNG or strictly sanitized SVG, 64 KiB stored output, 30-day refresh interval. |
| Article images | At most 100 sources per entry, 2 MiB source, fixed 1600 px scale-down, ownership required. |
| AI summaries | 50 KiB input, 15-second deadline, one retry, 512 output tokens, 32 KiB stored HTML. |

Feed refresh details are retained for 90 days. Daily chart aggregates are retained for 365 days. Terminal jobs and outbox rows are retained for 7 days. Authentication cleanup is bounded and preserves live sessions, credentials, links, and challenges.

## Security rules

- Web authentication uses passkeys only.
- Unsafe web requests require an authenticated session, exact-origin checks, and CSRF validation.
- Mandatory Worker rate limits remain active when Turnstile is disabled.
- Enrollment links, recovery links, and app tokens are shown once; D1 stores hashes.
- Feed and image URLs reject credentials, fragments, unsafe ports, and local or private targets.
- Do not log article text, tokens, cookies, passkey payloads, or credential-bearing URLs.
- Do not place whole-host Cloudflare Access in front of Larafeed. It would break public health checks and compatibility clients.

## Monitoring

Logs, invocation logs, and traces are persisted at 100% sampling in every environment. Handled retries, discarded Queue messages, degraded Cron passes, HTTP failures, and favicon pipeline stages emit bounded structured fields. Use the parent trace to correlate detailed child failures with the Queue or scheduled invocation. Custom telemetry must never contain payloads, article text, credentials, raw URLs, or raw error messages.

Watch these signals separately for each environment:

- Worker errors, CPU time, and latency.
- Authentication failures and security events.
- D1 size, latency, rows read and written, errors, overload, and primary-versus-replica traffic by region.
- Queue backlog, oldest message age, retries, and consumer errors.
- D1 outbox age, stale leases, terminal jobs, and oldest due feed.
- Stalled OPML imports and external fetch failure classes.
- Images transformations and AI Gateway usage, errors, and cost.

Investigate outbox age above 15 minutes, oldest due feeds above 60 minutes, or OPML imports stalled above 30 minutes. Configure provider budget alerts before enabling Images or AI.

## Incident response

1. Disable the producer with the relevant rollout control.
2. Pause its Queue consumer if accepted work must also stop.
3. Inspect the complete trace and its structured logs for the failed stage and safe error class. Use D1 only for authoritative job and outbox state.
4. Fix the cause. Do not create a new operation ID to replay existing work.
5. Resume the consumer at low concurrency.
6. Resume dispatch before scheduling.

For an authentication incident, revoke affected sessions and app tokens. Use operator recovery only when no enabled administrator can act.

## Worker rollback

Build the correct environment, inspect recent deployments, then select a known-good version:

```bash
npm run build
npm exec -- wrangler deployments list
npm exec -- wrangler rollback VERSION_ID --message "rollback"
```

Use `build:production` for the named production environment. A Worker rollback does not reverse D1 migrations, data changes, Queue deliveries, Images transformations, or AI calls.

## D1 recovery

An in-place Time Travel restore is destructive. Disable background producers, pause consumers, and record the current Worker version, bookmark, Queue backlog, and incident time before proceeding.

Inspect a recovery point without changing data:

```bash
npm exec -- wrangler d1 time-travel info DB \
  --timestamp RFC3339_TIMESTAMP \
  --config wrangler.jsonc
```

After explicit approval, restore the reviewed bookmark:

```bash
npm exec -- wrangler d1 time-travel restore DB \
  --bookmark BOOKMARK \
  --config wrangler.jsonc
```

Add `--env production` only for the named production environment. Confirm Cloudflare's current Time Travel retention before relying on a recovery point.

After restore:

1. Reapply migrations newer than the restored point.
2. Deploy schema-compatible Worker code.
3. Verify health, foreign keys, administrator access, and sampled reader data.
4. Reconcile D1 jobs and outbox rows with the Queue backlog.
5. Resume consumers and dispatch at low concurrency before scheduling.

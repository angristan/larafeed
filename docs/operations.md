# Operations

D1 is authoritative for users, reader data, sessions, imports, summaries, durable jobs, and outbox messages. Queue messages contain only stable operation IDs. Cloudflare Queues provide delivery, not durable job history.

## Routine commands

```bash
npm run validate          # full local validation and deployment dry runs
npm run d1:validate:large # production-shaped D1 validation
npm run deploy:check      # portable deployment dry run
npm run deploy            # migrate and deploy the portable environment
```

Named maintainer environments use the matching `:production` or `:test` scripts. Build immediately before a config-less Wrangler command because the Vite build selects the flattened deployment configuration.

D1 migrations are forward-only. Apply a corrective migration instead of editing an applied migration.

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

## Application limits

These are application bounds, not Cloudflare platform limits.

| Area | Important bounds |
| --- | --- |
| Feed refresh | 15-second deadline, 5 redirects, 10 MiB response, newest 20 valid entries, 8 processing attempts, 10 outbox attempts, 5-minute manual cooldown. |
| OPML | 2 MB, 500 unique feeds, 50 outline levels, one concurrent discovery consumer. |
| Favicons | 1 MiB site HTML, 2 MiB image, 3 image redirects, fixed 32×32 PNG, 64 KiB stored output, 30-day refresh interval. |
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
3. Inspect the D1 job, outbox, and failure class. D1 is authoritative.
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

Use `build:production` or `build:test` for a named environment. A Worker rollback does not reverse D1 migrations, data changes, Queue deliveries, Images transformations, or AI calls.

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

Add `--env production` or `--env test` only for the matching named environment. Confirm Cloudflare's current Time Travel retention before relying on a recovery point.

After restore:

1. Reapply migrations newer than the restored point.
2. Deploy schema-compatible Worker code.
3. Verify health, foreign keys, administrator access, and sampled reader data.
4. Reconcile D1 jobs and outbox rows with the Queue backlog.
5. Resume consumers and dispatch at low concurrency before scheduling.

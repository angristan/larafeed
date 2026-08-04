# Cloudflare capacity and cost model

This model defines the units and hard bounds that must be reviewed before a rollout control is enabled. Prices and account allowances can change; check the Cloudflare dashboard and current official pricing before each production enablement.

## Launch assumptions

Use these planning values until production measurements replace them:

- 1–4 active users.
- 200 subscriptions after OPML bootstrap.
- 2,000 browser and compatibility API requests per day.
- Production Cron every 5 minutes.
- No AI or Images traffic until its separate rollout is approved.

These are capacity assumptions, not permission to enable a metered feature.

## Feed refresh

With `REFRESH_DUE_LIMIT=10`, Cron can reserve at most:

```text
10 jobs/run × 12 runs/hour × 24 hours = 2,880 jobs/day
```

At the 15-minute target interval, that capacity keeps at most 30 continuously due feeds exactly on schedule. With 200 continuously due feeds, the theoretical average interval is about 100 minutes. Increase the limit only after Queue, D1, publisher load, and cost evidence is reviewed; the code hard-caps each run at 100 feeds.

Each accepted job creates one D1 job and one outbox row. Normal delivery produces one Queue message and one consumer execution. Consumers use `max_batch_size=1`, so the checked-in scheduled ceiling is also 2,880 refresh consumer invocations per day, or 86,400 in a 30-day month, before manual work and retries. Retry amplification is bounded by 8 processing attempts, 10 outbox attempts, the main Queue retry setting, and fixed concurrency. Duplicate deliveries converge on the operation ID.

Cloudflare bills Queue operations per message rather than per producer or consumer batch, so changing consumer batch size from five or ten to one does not multiply Queue write/read/delete operations. It does increase Worker consumer invocations and native trace count. Recheck the current [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) and Workers allowance before production enablement.

Detailed refresh rows are retained for 90 days, while daily aggregates remain. Terminal jobs and outbox rows are retained for 7 days and then removed in batches of at most 500 per Cron invocation. Let `S`, `M`, `O`, and `A` be accepted scheduled refresh, manual refresh, OPML-item, and AI-summary jobs per day. The terminal-job steady-state ceiling is approximately `7 × (S + M + O + A)` plus active/retry work. At the checked-in scheduled cap, `S ≤ 2,880`; manual, OPML, and AI work must be added from measured admission counts rather than hidden in the scheduled estimate.

Rollback: set both refresh controls to `false`, then pause consumers if in-flight processing must also stop.

## Favicons and Images

Favicon maintenance reserves at most five stale feeds per Cron invocation. A successful feed refresh also reserves that exact feed when its favicon check is missing or older than 30 days; this covers normal adds and OPML imports without waiting for Cron. Both paths share the per-feed active-job fence and `favicon_updated_at`, so they converge instead of repeating work. One Queue message and one consumer invocation process each feed. A selected favicon performs one fixed 32 × 32 PNG Images transformation. Darkness analysis, hashing, and D1 persistence reuse that output. The theoretical production Cron reservation ceiling is `5 × 12 × 24 × 30 = 43,200` jobs in a 30-day month, while a stable set of `F` subscribed feeds normally contributes at most about `F` checks, Queue executions, and transformations per 30 days. Six processing attempts, ten outbox attempts, and the main Queue retry setting bound retry amplification.

Each unique normalized icon inserts one content-addressed D1 row. With the hard 64 KiB output cap and `F=200`, one unique current asset per feed is bounded by 12.5 MiB before shared-content deduplication. Real 32 × 32 PNGs should be much smaller, but monitoring uses measured D1 bytes. Cron removes at most 100 unreferenced rows older than 30 days per invocation.

The public asset route performs one Worker invocation. It reads D1 only when the per-colo Cache API entry is cold or evicted. Successful responses allow immutable one-year browser caching, so repeat rendering normally creates no request. Cache API is an optimization rather than a durability or budget boundary.

Manual favicon refresh uses the shared 20-per-minute limiter with a key per user and feed. Each accepted command creates at most one active D1 job/outbox row and one Queue consumer invocation. For `U` users and `F` feeds, its application-side ceiling is `20 × 60 × 24 × 30 × U × F = 864,000 × U × F` attempts per month. This deliberately conservative maximum is too high to treat the switch as a budget control. Keep favicon and Images switches disabled until D1, Queue, and Images usage alerts are approved.

Article image routes keep one fixed preset with ownership checks. They cannot accept arbitrary source URLs or transform parameters. If `Ar` unique article-image sources are requested in a month, the source/preset ceiling is `Ar`; negotiated output formats and edge misses can multiply actual transformations. A six-hour Worker Cache API entry and a one-day private browser cache reduce duplicate requests, but neither is a budget boundary.

Rollback: set `FAVICON_REFRESH_ENABLED=false` to stop favicon discovery and new D1 assets. Set `IMAGES_ENABLED=false` to stop favicon normalization and article transformations. Existing immutable D1 favicon assets remain readable.

## AI summaries

Generation is disabled by default. When enabled, one unexpired D1 lease exists per entry/content/model/prompt combination. Requests are limited per user, provider output is limited to 512 tokens, response bodies to 64 KB, and stored summary HTML to 32 KB. Empty content does not call the provider.

Before enablement, configure the AI Gateway/provider budget and calculate expected input/output tokens from a representative private sample. Include retries and uncached regenerations.

Rollback: set `AI_SUMMARY_ENABLED=false`. Cached summaries remain readable.

## Observability

Production traces sample 10%; test traces sample 100%. The application adds one custom span per Queue invocation and one per scheduled subsystem. Because every consumer batch contains one message, this is also one custom Queue span per delivered feed operation. It does not create per-entry or extra per-query custom spans. Persisted and invocation logs remain disabled until their event volume and retention cost are approved.

At 2,000 HTTP requests per day, the platform creates about 200 sampled HTTP traces per day before Queue and Cron spans. A five-minute schedule invokes Cron 288 times per day and emits at most four scheduled subsystem spans per invocation, or 1,152 additional spans per day before trace sampling. Queue span volume equals delivered messages because `max_batch_size=1`; production sampling reduces stored refresh spans to about 288 per day at the 2,880-job ceiling before retries. Review actual trace storage after the bounded test rollout before changing sampling.

## D1 validation gates

Before production provisioning or a material limit increase:

1. Run `npm run d1:validate:large`.
2. Confirm every representative query uses its intended index.
3. Confirm statement and row bounds remain within the documented fixture limits.
4. Run the same profile against isolated remote test D1 and record latency, rows read/written, database size, and the date.
5. Reject rollout if any operation exceeds its explicit application bound, if oldest-due work grows continuously, or if remote p95 latency exceeds 500 ms during the bounded test.

Local Workerd timing is not production latency evidence.

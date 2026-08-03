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

Each accepted job creates one D1 job and one outbox row. Normal delivery produces one Queue message and one consumer execution. Retry amplification is bounded by 8 processing attempts, 10 outbox attempts, Queue/DLQ retry settings, and fixed concurrency. Duplicate deliveries converge on the operation ID.

Detailed refresh rows are retained for 90 days, while daily aggregates remain. Terminal jobs and outbox rows are retained for 7 days and then removed in batches of at most 500 per Cron invocation. Let `S`, `M`, `O`, and `A` be accepted scheduled refresh, manual refresh, OPML-item, and AI-summary jobs per day. The terminal-job steady-state ceiling is approximately `7 × (S + M + O + A)` plus active/retry work. At the checked-in scheduled cap, `S ≤ 2,880`; manual, OPML, and AI work must be added from measured admission counts rather than hidden in the scheduled estimate.

Rollback: set both refresh controls to `false`, then pause consumers if in-flight processing must also stop.

## Favicons and Images

Favicon maintenance refreshes at most five stale feeds per Cron invocation. A successful feed refresh also analyzes that exact feed when its favicon check is missing or older than 30 days; this covers normal adds and OPML imports without waiting for Cron. Both paths share `favicon_updated_at`, so they converge instead of repeating work. Darkness analysis performs one fixed 10×10 Images transformation for a selected favicon only when both favicon refresh and Images are enabled. The theoretical production Cron ceiling is `5 × 12 × 24 × 30 = 43,200` attempts in a 30-day month, while a stable set of `F` subscribed feeds normally contributes at most about `F` automatic or scheduled checks per 30 days.

Manual favicon refresh uses the shared 20-per-minute limiter with a key per user and feed. For `U` users and `F` feeds, its application-side ceiling is `20 × 60 × 24 × 30 × U × F = 864,000 × U × F` attempts per month. This deliberately conservative maximum is too high to treat the switch as a budget control. Keep both favicon and Images switches disabled until account-level Images limits/alerts are approved; unique-transform caching can reduce billed units but is not a safety boundary.

Reader image routes use only two fixed feed presets and one fixed article preset with ownership checks. They cannot accept arbitrary source URLs or transform parameters. If `Fi` unique favicon sources and `Ar` unique article-image sources are requested in a month, the format-independent source/preset ceiling is `2 × Fi + Ar`; negotiated output formats and cache misses can multiply actual transformations, so confirm the Images dashboard during the bounded test.

Rollback: set `FAVICON_REFRESH_ENABLED=false` to stop discovery and `IMAGES_ENABLED=false` to stop every transformation.

## AI summaries

Generation is disabled by default. When enabled, one unexpired D1 lease exists per entry/content/model/prompt combination. Requests are limited per user, provider output is limited to 512 tokens, response bodies to 64 KB, and stored summary HTML to 32 KB. Empty content does not call the provider.

Before enablement, configure the AI Gateway/provider budget and calculate expected input/output tokens from a representative private sample. Include retries and uncached regenerations.

Rollback: set `AI_SUMMARY_ENABLED=false`. Cached summaries remain readable.

## Observability

Production traces sample 10%; test traces sample 100%. The application adds one custom span per Queue batch and one per scheduled subsystem. It does not create per-entry, per-query, or per-message custom spans. Persisted and invocation logs remain disabled until their event volume and retention cost are approved.

At 2,000 HTTP requests per day, the platform creates about 200 sampled HTTP traces per day before Queue and Cron spans. A five-minute schedule invokes Cron 288 times per day and emits at most four scheduled subsystem spans per invocation, or 1,152 additional spans per day before trace sampling. Queue span volume is at most the number of delivered batches and depends on configured batch sizes and refresh throughput. Review actual trace storage after the bounded test rollout before changing sampling.

## D1 validation gates

Before production provisioning or a material limit increase:

1. Run `npm run d1:validate:large`.
2. Confirm every representative query uses its intended index.
3. Confirm statement and row bounds remain within the documented fixture limits.
4. Run the same profile against isolated remote test D1 and record latency, rows read/written, database size, and the date.
5. Reject rollout if any operation exceeds its explicit application bound, if oldest-due work grows continuously, or if remote p95 latency exceeds 500 ms during the bounded test.

Local Workerd timing is not production latency evidence.

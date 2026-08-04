# Cloudflare feed refresh jobs

Feed refreshes use D1 as authoritative state and Cloudflare Queues only for delivery.

```text
Cron/manual command
  -> D1 job + outbox row
  -> dispatcher lease
  -> Queue { operationId }
  -> consumer claim
  -> bounded fetch + parse + sanitize
  -> atomic feed/entries/history/job commit

Cron reconciliation
  -> find old queued/failed jobs with a sent outbox row
  -> reopen that same outbox row and stable { operationId }
  -> dispatch a safe duplicate, or end the exhausted job
```

## Runtime limits

- Cron runs every five minutes in production and every ten minutes in the test environment.
- Production reserves at most 10 due feeds per Cron run. The test environment reserves 5.
- Every Queue message represents one feed operation, and `max_batch_size=1` guarantees one consumer invocation per feed. Production consumer concurrency is capped at 3; test concurrency is capped at 2.
- A feed fetch has one 15-second deadline, at most 5 manually validated redirects, and a 5 MiB response limit.
- A refresh commits at most the newest 20 unique, valid, non-future entries, even when the source contains more than 1,000 items. Sanitized article HTML is stored only below 1.8 MB.
- Parser source IDs remain canonical. On the first post-migration refresh, an exact source-less legacy URL identity is promoted in place so entry IDs and interactions remain stable.
- Jobs use leased, conditional state transitions and at most 8 processing attempts.
- One non-terminal refresh job (`pending`, `queued`, `running`, or `failed`) is admitted per feed. Manual and scheduled commands share this D1-atomic guard, even when their idempotency keys differ.
- Manual API refreshes are rejected for five minutes after the last successful refresh. Reusing the same idempotency key still returns its original command. Gone feeds are excluded from scheduled admission, while an explicit manual refresh remains available as the bounded recovery path.
- Queue messages contain only an operation ID. Retries and redrives reload feed and job state from D1.
- Refresh processing snapshots subscription filter revisions. The atomic refresh
  commit aborts every feed, entry, interaction, history, and job mutation if the
  rule-bearing subscriber set or any revision changed, so a retry evaluates new
  entries with current rules instead of publishing stale filter state.
- Cron checks at most the configured due-feed limit for stranded deliveries per run. A queued or failed job must be available and unchanged for at least 15 minutes before redrive.
- Queue-send failures and lost-delivery redrives share the existing 10-attempt outbox recovery budget.
- Detailed refresh history older than 90 days is deleted in bounded batches, and the newest row for each feed is always retained. Daily refresh aggregates preserve complete 365-day charts without retaining every attempt row.
- Terminal jobs older than 7 days and their outbox rows are deleted in bounded Cron batches. Refresh history, OPML items, and summary audit rows remain intact; their nullable job reference is cleared by the database. Active jobs, leased outbox rows, and newer terminal state are never selected.

## Failure behavior

Queue sends and D1 writes do not share a transaction. The dispatcher therefore leaves ambiguous sends leased. Lease expiry can send the same operation again; consumer claims and unique constraints make that safe.

The main Queue can exhaust delivery retries while D1 is unavailable. Cloudflare then discards the message, but the authoritative D1 job and outbox row remain unfinished. Scheduled reconciliation detects only old, available `queued` or `failed` jobs whose outbox row is still `sent`. It reopens that row without changing its payload, so the same operation ID is dispatched again. Duplicate original and redriven deliveries converge through the conditional claim. Succeeded, canceled, and dead-lettered jobs are never reopened.

Each reconciliation is age-gated, batch-limited, and charged to the outbox attempt budget. Budget exhaustion dead-letters both the job and outbox. A terminal scheduled job advances the feed generation by at least the normal refresh interval, so it cannot reserve the same operation forever. Manual jobs do not change the scheduled feed time.

Retryable network, timeout, HTTP 408/425/429, and 5xx failures use bounded exponential backoff. Valid `Retry-After` guidance can extend that delay within the persisted six-hour cap. Terminal policy, parse, size, and other 4xx failures end the job. A terminal feed that is not gone is reconsidered no sooner than the normal refresh interval, rather than the short queue-retry delay. HTTP 404 and 410 also mark the feed gone. Processing exhaustion records feed-refresh failure history. Processing, lease, and redrive exhaustion record terminal job/outbox state and a bounded failure class directly in D1.

Feed URLs and every redirect must use standard-port HTTP or HTTPS. Credentials, fragments, local names, private/special IP literals, and obvious binary responses are rejected. Worker fetch cannot DNS-pin arbitrary hostnames, so URL validation is defense in depth alongside the Workers network boundary.

## Controls

These non-secret Worker variables bound or stop new work:

- `REFRESH_SCHEDULER_ENABLED` — reserve due feeds during Cron.
- `REFRESH_DISPATCH_ENABLED` — send leased outbox messages.
- `REFRESH_DUE_LIMIT` — maximum due feeds reserved per run, from 1 to 100.

Disabling scheduling stops new scheduled jobs. Reconciliation and bounded retention still run because they protect accepted commands and keep durable state bounded. Disabling dispatch keeps both new and reopened commands durable in the outbox. Subscription creation still creates its refresh command but does not send it to the Queue. Existing Queue deliveries continue so already accepted work can reach an authoritative terminal state.

## Provisioning

Wrangler declares these resources but does not create them during a dry run. The consumer uses `max_batch_size=1`:

- `larafeed-feed-refresh`
- test equivalent `larafeed-test-feed-refresh`

The test queues and ten-minute Cron are provisioned and attached to the isolated test Worker. Production queues and Cron remain unprovisioned; create the queues before the first approved production deployment.

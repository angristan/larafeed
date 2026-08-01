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
```

## Runtime limits

- Cron runs every five minutes in production and every ten minutes in the test environment.
- Production reserves at most 10 due feeds per Cron run. The test environment reserves 5.
- Queue batches contain at most 5 messages. Production consumer concurrency is capped at 3.
- A feed fetch has one 15-second deadline, at most 5 manually validated redirects, and a 5 MiB response limit.
- A refresh keeps at most 50 entries. Sanitized article HTML is stored only below 1.8 MB.
- Jobs use leased, conditional state transitions and at most 8 processing attempts.
- Queue messages contain only an operation ID. Retries reload feed and job state from D1.
- Refresh history older than 90 days is deleted in bounded batches. The newest row for each feed is retained.

## Failure behavior

Queue sends and D1 writes do not share a transaction. The dispatcher therefore leaves ambiguous sends leased. Lease expiry can send the same operation again; consumer claims and unique constraints make that safe.

Retryable network, timeout, HTTP 408/425/429, and 5xx failures use bounded exponential backoff. Valid `Retry-After` guidance can extend that delay within the persisted six-hour cap. Terminal policy, parse, size, and other 4xx failures end the job. HTTP 404 and 410 also mark the feed gone. The DLQ consumer records terminal D1 state before acknowledging.

Feed URLs and every redirect must use standard-port HTTP or HTTPS. Credentials, fragments, local names, private/special IP literals, and obvious binary responses are rejected. Worker fetch cannot DNS-pin arbitrary hostnames, so URL validation is defense in depth alongside the Workers network boundary.

## Controls

These non-secret Worker variables bound or stop new work:

- `REFRESH_SCHEDULER_ENABLED` — reserve due feeds during Cron.
- `REFRESH_DISPATCH_ENABLED` — send leased outbox messages.
- `REFRESH_DUE_LIMIT` — maximum due feeds reserved per run, from 1 to 100.

Disabling scheduling stops new scheduled jobs. Disabling dispatch keeps commands durable in the outbox. Existing Queue deliveries continue so already accepted work can reach an authoritative terminal state.

## Provisioning

Wrangler declares these resources but does not create them during a dry run:

- `larafeed-feed-refresh`
- `larafeed-feed-refresh-dlq`
- test equivalents prefixed with `larafeed-test-`

Create the queues before the first explicit deployment. No queue or Cron configuration has been written to Cloudflare from this branch.

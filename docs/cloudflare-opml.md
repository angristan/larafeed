# Cloudflare OPML import and export

Larafeed imports OPML asynchronously. D1 owns import progress and command state. Cloudflare Queues only delivers operation IDs.

```text
Authenticated JSON upload
  -> parse and deduplicate at most 500 feeds
  -> D1 import + item + job + outbox rows
  -> immediately enqueue all operation IDs in batches of at most 50
  -> one OPML Queue invocation discovers one feed
  -> create or reuse feed/category/subscription
  -> atomically create initial feed-refresh job + outbox work when needed
  -> immediately hand that operation to the feed-refresh Queue
  -> fetch and persist posts through the standard refresh consumer
  -> enqueue one durable favicon operation after post persistence
  -> exact D1 progress counters
```

## HTTP API

- `POST /api/opml/imports` accepts `{ opml, filename? }`, requires session CSRF checks, and returns `202` with durable progress.
- `GET /api/opml/imports` lists the authenticated user's 20 newest imports.
- `GET /api/opml/imports/:id` returns ownership-scoped progress.
- `GET /api/opml/export` downloads the user's current subscriptions as OPML 2.0.

The settings page polls every five seconds only while an import is pending or processing.

## Import policy

- The upload UI limits files to 2 MB. The contract also limits the XML text to 2,000,000 characters.
- Imports contain at most 500 unique feed URLs and at most 50 nested outline levels.
- DTD and entity declarations are rejected.
- The first canonical duplicate URL wins, including its title, `customTitle`, and category path.
- Legacy Go `customTitle` values are stored as the subscription's custom name. Export keeps the canonical feed title in `text` and `title`, and emits the custom name separately as `customTitle`.
- Nested category names are stored as one deterministic `Parent / Child` category capped at 255 characters. Flat feeds use `Uncategorized`.
- Feed URLs use the same SSRF-oriented URL policy as feed refreshes. Invalid or private targets become terminal, visible item failures.
- Site metadata URLs reject credentials, fragments, nonstandard ports, and non-HTTP protocols.

An OPML consumer does not ingest discovered entries from memory. In the same D1 transaction that completes the item, it creates a standard feed-refresh job and outbox row unless that canonical feed already has active refresh work. This applies to new and previously populated shared feeds, so every accepted import refreshes available posts. After the commit, the consumer immediately leases and sends that exact operation to the feed-refresh Queue when refresh dispatch is enabled. The operation identity is stable for the OPML item. Successful refreshes persist posts before reserving a separate durable favicon job when the icon is stale or unknown. Active work remains deduplicated. Existing subscriptions are counted as skipped.

## Delivery and recovery

Each feed has one D1 job and one outbox row with topic `opml_import_feed`. Queue messages contain only `{ operationId }`; user IDs, URLs, and category data remain in D1.

- The producer immediately sends all accepted items with `sendBatch` calls of at most 50. Each item remains a separate Cloudflare Queue message and carries one operation ID.
- The main consumer uses `max_batch_size=1`. One consumer invocation discovers or terminalizes exactly one feed item, and concurrency remains capped at one.
- OPML cron remains a recovery path for failed or ambiguous Queue sends; normal imports do not wait for Cron dispatch.
- Item jobs have five attempts, conditional leases, exponential backoff, and a six-hour delay cap.
- Outbox dispatch and lost-delivery redrive share a ten-attempt budget. Ambiguous sends remain leased and can safely produce duplicate delivery after expiry.
- Processing exhaustion and redrive-budget exhaustion record authoritative item, import, job, and outbox terminal state in D1.
- A failed or ambiguous immediate refresh handoff leaves recoverable D1 outbox state. Duplicate delivery is safe because the refresh operation ID is stable.
- OPML cron recovers stale leases, incomplete import creation, and accepted import commands whose Queue delivery was lost. Standard refresh cron remains bounded recovery for initial feed-refresh work; normal imports do not wait for it.
- Partial import creation stays in `pending` and cannot dispatch. Cron eventually marks it failed.

The production Queue name is `larafeed-opml-import`; the test name is `larafeed-test-opml-import`. The isolated test Queue is provisioned and attached to the test Worker. The production Queue remains unprovisioned.

# Cloudflare OPML import and export

Larafeed imports OPML asynchronously. D1 owns import progress and command state. Cloudflare Queues only delivers operation IDs.

```text
Authenticated JSON upload
  -> parse and deduplicate at most 500 feeds
  -> D1 import + item + job + outbox rows
  -> OPML Queue { operationId }
  -> create or reuse feed/category/subscription
  -> mark feed due for the normal refresh Queue
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
- The first canonical duplicate URL wins, including its title and category path.
- Nested category names are stored as one deterministic `Parent / Child` category capped at 255 characters. Flat feeds use `Uncategorized`.
- Feed URLs use the same SSRF-oriented URL policy as feed refreshes. Invalid or private targets become terminal, visible item failures.
- Site metadata URLs reject credentials, fragments, nonstandard ports, and non-HTTP protocols.

An OPML consumer does not fetch remote content. It creates or reuses the feed and subscription, then sets the feed due for the existing bounded refresh scheduler. Existing subscriptions are counted as skipped.

## Delivery and recovery

Each feed has one D1 job and one outbox row with topic `opml_import_feed`. Queue messages contain only `{ operationId }`; user IDs, URLs, and category data remain in D1.

- Queue batches contain at most 10 items with consumer concurrency capped at 2.
- Item jobs have five attempts, conditional leases, exponential backoff, and a six-hour delay cap.
- Outbox dispatch has ten attempts. Ambiguous sends remain leased and can safely produce duplicate delivery after expiry.
- The DLQ records authoritative item and import terminal state before acknowledging.
- Cron recovers stale leases, incomplete import creation, and accepted commands whose Queue delivery was lost.
- Partial import creation stays in `pending` and cannot dispatch. Cron eventually marks it failed.

Production queue names are `larafeed-opml-import` and `larafeed-opml-import-dlq`. Test names use the `larafeed-test-` prefix. Wrangler declares these resources but this branch has not created, deployed, or configured them in Cloudflare.

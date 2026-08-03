# Cloudflare OPML import and export

Larafeed imports OPML asynchronously. D1 owns import progress and command state. Cloudflare Queues only delivers operation IDs.

```text
Authenticated JSON upload
  -> parse and deduplicate at most 500 feeds
  -> D1 import + item + job + outbox rows
  -> OPML Queue { operationId }
  -> create or reuse feed/category/subscription
  -> atomically create initial feed-refresh job + outbox work when needed
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

An OPML consumer does not ingest discovered entries from memory. In the same D1 transaction that completes the item, it creates a standard feed-refresh job and outbox row when the canonical feed has never refreshed and has no active refresh job. The operation identity is stable for the OPML item. Fresh and shared empty feeds therefore populate when refresh dispatch is enabled, even if refresh reservation is disabled. Populated feeds and feeds with active refresh work do not get duplicate jobs. Existing subscriptions are counted as skipped.

## Delivery and recovery

Each feed has one D1 job and one outbox row with topic `opml_import_feed`. Queue messages contain only `{ operationId }`; user IDs, URLs, and category data remain in D1.

- Queue batches contain at most 10 items with consumer concurrency capped at 2.
- Item jobs have five attempts, conditional leases, exponential backoff, and a six-hour delay cap.
- Outbox dispatch has ten attempts. Ambiguous sends remain leased and can safely produce duplicate delivery after expiry.
- The DLQ records authoritative item and import terminal state before acknowledging.
- OPML cron recovers stale leases, incomplete import creation, and accepted import commands whose Queue delivery was lost. Standard refresh cron performs bounded recovery for initial feed-refresh work.
- Partial import creation stays in `pending` and cannot dispatch. Cron eventually marks it failed.

Production queue names are `larafeed-opml-import` and `larafeed-opml-import-dlq`. Test names use the `larafeed-test-` prefix. The isolated test queues are provisioned and attached to the test Worker. Production queues remain unprovisioned.

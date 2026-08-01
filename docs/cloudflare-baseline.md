# Cloudflare migration baseline

## Scope

This document records the verified behavior and migration constraints of the Go application before the Cloudflare rewrite. The Go application remains the behavioral reference only where this document marks the behavior as implemented and supported.

## Validation baseline

| Check | Result |
| --- | --- |
| `npm run lint-check` | Pass |
| `npm run typecheck` | Pass |
| Container-free Go packages | Pass |
| `go test -short ./...` before baseline fix | Failed: DB and handler `TestMain` started Testcontainers before checking `testing.Short()` |
| Google Reader/Fever contract tests | Missing |

The DB and handler test harnesses now skip container startup in short mode so the documented unit-test command is genuinely container-free.

## Product behavior inventory

| Area | Baseline status | Cloudflare disposition |
| --- | --- | --- |
| Reader | Implemented: sidebar, categories, counts, 30-item numbered pages, filters, ordering, detail, read/star, keyboard navigation | Preserve, but separate safe detail reads from explicit state mutations |
| Feed ingestion | Implemented: discovery, RSS/Atom, conditional requests, refresh state, backoff, favicon discovery | Rewrite for Worker fetch/parser, classified size limits, D1 batches, and Queue jobs |
| Subscriptions/categories | Implemented with ownership and category constraints | Preserve invariants; add deterministic conditional writes |
| Entry filtering | Implemented, but writes empty interaction rows for non-matches | Replace with sparse filtered-state writes |
| Mark all read | Implemented with per-entry writes in two statements | Replace with per-subscription read-through watermark |
| OPML export | Implemented | Preserve with deterministic ordering and fixtures |
| OPML import | Partial: per-feed River jobs, no durable progress or partial-failure report | D1 import/item state plus Queues and frontend polling |
| Charts | Partial: several frontend filters are ignored and query errors become empty series | Preserve supported metrics only after defining correct contracts |
| Google Reader | Partial and untested | Preserve supported routes with app-token authentication and contract fixtures |
| Fever | Partial and untested | Preserve supported routes with app-token authentication and contract fixtures |
| AI summaries | Implemented through direct Gemini calls and process-local limits | Gemini through AI Gateway, global limits, safe caching, and explicit summary endpoint |
| Telegram | Minimal and unreliable fire-and-forget calls | Keep only through bounded `waitUntil()` or durable Queue delivery |
| Jobs | River jobs exist, but several failures are acknowledged without retries | Replace with D1 job/outbox state, Queues, Cron, leases, and durable failure state |
| Authentication | Password/cookie/TOTP behavior is partial and several routes are stubbed or unsafe | Do not preserve; replace with passkeys, Turnstile, D1 sessions, invitations, and recovery links |

## Known security and contract defects not to port

- Password-reset email and verification email are not implemented.
- Email verification ignores route identity/hash parameters and mutates through GET.
- Password-reset expiry is not enforced.
- TOTP management UI calls routes that do not exist.
- No CSRF or Origin middleware is registered.
- Cookie sessions have no server-side revocation or login rotation.
- The global River job UI is available to any authenticated user.
- Google Reader accepts the account password and does not enforce token expiry.
- Fever uses a deterministic plaintext MD5 API key.
- Telegram calls have no timeout, status check, durable retry, or tracked lifecycle.

## Migration-critical invariants

- Feeds are shared globally and identified by unique `feed_url`.
- Subscriptions are unique by `(user_id, feed_id)`.
- Subscription categories belong to the same user through a composite ownership constraint.
- Entry access and interaction writes require an active subscription.
- Filtered entries are excluded from reader lists and counts.
- Feed refresh state includes ETag, Last-Modified, gone state, failure count, and retry-after.
- Existing timestamps were normalized from a prior Laravel schema to UTC.
- Integer IDs can be preserved only after production ranges are confirmed JavaScript-safe.
- Existing password hashes and TOTP secrets will not migrate.
- Existing Google Reader/Fever credentials require replacement with app-specific tokens.

## PostgreSQL measurements

Run [`scripts/postgres-baseline.sql`](../scripts/postgres-baseline.sql) against a read replica or during an off-peak period:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/postgres-baseline.sql
```

The script runs in a read-only transaction with lock and statement timeouts. It measures:

- database, table, and index sizes;
- exact row counts and ID ranges;
- article-content size distribution and D1 row-limit risk;
- twelve-month entry/content/refresh growth;
- subscription fanout and interaction density;
- empty interaction-row amplification;
- duplicate URLs, nullable timestamps, and precision loss;
- expired cache rows.

Production measurements have not been run from this worktree.

## D1 redesign requirements

- Store article metadata and content separately so list queries do not read HTML.
- Enforce an encoded article-content limit below D1's maximum row/value size.
- Use application-generated epoch-millisecond timestamps and deterministic ID tie-breakers.
- Use an application-owned native D1 Effect adapter that preserves `batch()`, Sessions/bookmarks, and result metadata.
- Replace PostgreSQL interactive transactions with guarded native batches and inspect every affected-row count.
- Replace River with D1 job/outbox state, Queues, and Cron.
- Store explicit `next_refresh_at`, `last_attempt_at`, and `latest_entry_at` values.
- Keep numbered pagination initially and benchmark count scans and deep offsets.
- Verify candidate indexes with `EXPLAIN QUERY PLAN` and D1 rows-read metadata before adding them.

## Representative D1 benchmarks

At minimum, test:

1. Current production shape and projected twelve-month growth.
2. Reader list/count combinations for all, unread, read, favorites, feed, category, and both orderings.
3. Sidebar aggregation across the largest subscription set.
4. A shared feed refresh with filtered subscribers.
5. Five concurrent deliveries of the same refresh operation.
6. Mark-all-read on a feed with 50,000 entries; the target writes one watermark row.
7. Overlapping Cron reservations against a scheduler backlog.
8. A 1,000-feed OPML import with duplicates, partial failures, and replayed messages.
9. Content around the accepted cap and above the rejection threshold.
10. Read/star mutations racing with unsubscribe and account deletion.

The checked-in Workerd validator now covers this matrix with deterministic CI and large profiles. The large profile validated:

- 4 users, 60 feeds, 12,000 entries, and 48,000 logical user-entry states;
- about 115 MB estimated D1 storage and 9,588 estimated bytes per entry;
- foreign keys, ownership, safe IDs, content splitting/caps, summary hashes, filtered visibility, equal timestamps, late old publications, and sparse watermark exceptions;
- reader global/feed/category/unread/favorites/detail results and required indexes;
- due-refresh, outbox lease, and refresh-history cleanup plans;
- a 2.5% sparse-interaction amplification ratio;
- bounded operation counts for reader list/count, read-through, and ingestion batches.

Run it with:

```bash
npm run d1:validate:large
```

The emitted JSON and Markdown reports contain elapsed metadata but no flaky latency threshold. Local Workerd validation is evidence for schema semantics, query plans, operation bounds, and approximate capacity. Remote D1 latency, overload, billing, production PostgreSQL measurements, and twelve-month growth remain operator acceptance checks before provisioning and traffic cutover.

# Cloudflare rebuild plan

## Status

Implemented locally on the `cloudflare` branch. The Worker, React frontend, D1 schema, durable jobs, OPML, compatibility APIs, Images, and AI Gateway integration are complete and validated. The legacy Go/Inertia runtime and PostgreSQL data-migration path have been removed. Cloudflare provisioning, remote D1 validation, and production deployment require explicit operator approval.

## Goals

- Rebuild Larafeed on Cloudflare-managed compute, storage, and background processing.
- Preserve the current reader experience and Google Reader/Fever compatibility.
- Reuse the React and Mantine UI where practical.
- Start from an empty D1 database and restore subscriptions through OPML.
- Validate D1 with production-shaped data before committing to it as the system of record.

## Non-goals

- A line-for-line port of the Go backend.
- Preserving Gonertia, Inertia, Ziggy, River, pgx, sqlc, or Goose.
- Introducing Cap'n Web without a concrete capability-RPC or bidirectional use case.
- Moving article HTML to R2 by default.
- Replacing external integrations such as Telegram solely for platform uniformity.
- Retaining password, password-reset, email-verification, or TOTP authentication for the web application.

## Current versus Cloudflare

| Concern | Current application | Cloudflare rebuild |
| --- | --- | --- |
| Runtime | Long-running Go process | Event-driven TypeScript Worker |
| HTTP routing | Chi | Hono adapter around Effect programs |
| Business logic | Go services | Effect services and layers |
| Frontend | React, Mantine, Vite | Reuse React, Mantine, Vite, and CSS where practical |
| Navigation/data bridge | Gonertia, Inertia, Ziggy | React Router, TanStack Query, typed path builders, REST |
| Browser server state | Inertia page props and partial reloads | Domain query factories, cache invalidation, safe prefetching |
| Database | PostgreSQL | D1 if Phase 0 gates pass; PostgreSQL/Hyperdrive is a separate fallback branch |
| Database access | pgx, sqlc | Application-owned native D1 Effect adapter and repositories |
| Migrations | Goose | Wrangler D1 SQL migrations |
| Transactions | Interactive PostgreSQL transactions | Guarded native D1 atomic batches with affected-row inspection |
| Background jobs | River on PostgreSQL | D1 job/outbox state, Queues consumers, Cron producers |
| Authentication | Password, cookie session, optional TOTP | WebAuthn passkeys, D1-backed opaque sessions, mandatory rate limits, and optional Turnstile protection |
| User provisioning/recovery | Public registration and password flows | Private admin invitation/recovery links plus operator bootstrap |
| Google Reader/Fever auth | Username and password | Username and revocable app-specific token in the password field |
| Rate limiting | Process-local Go memory | Workers Rate Limiting bindings |
| Feed fetching/parsing | Go `net/http` and `gofeed` | Worker `fetch`, Worker-compatible feed parser, explicit SSRF and size policy |
| HTML sanitization | `bluemonday` and Go HTML parser | Worker-compatible sanitizer and parser with equivalent fixtures |
| Image proxy | Self-hosted imgproxy | Cloudflare Images transformations behind fixed signed/opaque presets |
| Article storage | PostgreSQL `entries.content` | D1 `entry_contents` initially; R2 only if measurements require it |
| AI summaries | Gemini SDK called directly | Gemini through AI Gateway with budgets, limits, safe caching, and kill switch |
| Application cache | PostgreSQL cache table | D1, Cache API, or KV according to consistency and durability needs |
| Secrets | Environment variables | Worker secrets in production; explicit local development secrets |
| Notifications | Direct Telegram API calls | Telegram retained through durable Queue delivery or bounded `waitUntil()` work |
| Observability | OpenTelemetry export and process logs | Workers Observability, native spans, structured logs; Analytics Engine only if needed |
| Static assets | Go file server and Vite manifest | Worker Static Assets with SPA fallback and selective Worker-first routing |
| Testing | Legacy server integration tests | Effect test layers, Vitest, Workerd integration tests, browser tests, protocol fixtures |
| Deployment | Container/server with PostgreSQL | Wrangler-deployed Worker and Cloudflare bindings |

### Reuse boundary

Reuse the Mantine components, visual design, CSS, product behavior, feed/API fixtures, and compatibility expectations. Rewrite the Go backend, database layer, job system, authentication, Inertia integration, and browser data-loading plumbing.

## Target architecture

```text
React + Mantine
├── React Router
├── TanStack Query
└── Effect API client + shared schemas
             │ REST
             ▼
Cloudflare Worker
├── Hono HTTP adapter
├── Effect services and business logic
├── native D1 Effect adapter + repositories
├── D1-backed opaque sessions
├── optional Turnstile + mandatory Rate Limiting bindings
└── Queue/outbox dispatchers
             │
       Cron → Queues
             │
       feed, favicon, and import consumers
```

### Responsibilities

- **React Router** owns browser routes and URL state.
- **TanStack Query** owns browser-side server-state caching, refetching, invalidation, and optimistic updates.
- **Effect** owns boundary decoding, typed errors, service composition, cancellation, and business orchestration.
- **Effect Schema** defines wire contracts and serializable protocol errors. Repository-owned schemas decode D1 rows and persistence representations.
- **Hono** remains a thin HTTP adapter. It decodes `unknown`, maps tagged application errors to HTTP responses, and does not own business logic or a second validation model.
- **D1** stores relational application data, including article HTML initially. An application-owned Effect adapter preserves native batches, Sessions/bookmarks, result metadata, and prepared statements.
- **Queues** execute feed refresh, favicon refresh, and OPML import work. D1 remains the durable authority for job lifecycle state.
- **Cron Triggers** find due work and enqueue bounded jobs.
- **KV** is reserved for disposable cache data when D1 or the Cache API is not appropriate.
- **Cloudflare Images** replaces imgproxy for remote image transformations.
- **Turnstile** optionally adds bot protection to passkey ceremonies. When enabled, server-side token, hostname, and action validation is mandatory.
- **Workers Rate Limiting bindings** protect authentication, manual refresh, AI-summary, import, and image-proxy operations with route-appropriate keys and limits.
- **AI Gateway** fronts Gemini for provider observability, budgets, rate limiting, caching where semantically safe, and controlled retries/fallbacks.
- **Analytics Engine** is reserved for intentional custom time-series events when native Workers Observability cannot answer an operational question.
- **R2** is reserved for measured overflow or archival requirements, not one object per article by default.

TanStack Query is the frontend cache and ordinary browser-read retry owner. Effect operations used by query functions perform one decoded request and do not add a second cache or overlapping retry policy. Query functions pass TanStack Query's `AbortSignal` through `Effect.runPromise` to the underlying fetch. Mutations do not retry unless the operation has an explicit idempotency guarantee.

## Authentication

- The web application uses WebAuthn passkeys only. It has no password login, password reset, email verification, or TOTP second factor.
- Production uses the exact relying-party ID `larafeed.stanislas.cloud` and origin `https://larafeed.stanislas.cloud` unless a broader RP scope is deliberately approved before implementation.
- Each preview/test hostname uses its own exact RP ID and allowed origin. Test and production passkeys are separate and do not transfer between domains.
- Mandatory Worker rate limits protect passkey ceremony endpoints. Optional Turnstile verifies a token before issuing or accepting a WebAuthn challenge when enabled.
- An authenticated administrator creates short-lived, single-use enrollment links for new users and recovery links for existing users. An explicit operator command creates the first administrator enrollment link and can recover the final administrator when no authenticated admin remains. Store only hashed link tokens, bind them to one user and purpose, and consume them atomically.
- Users can register multiple passkeys. Successful WebAuthn authentication creates the D1-backed opaque session described below.
- Google Reader and Fever clients use revocable app-specific tokens in the protocol's password field. Store only token hashes and expose each plaintext token once at creation.
- The intended deployment is private and small, initially the owner and a few invited users. There is no public self-registration.

## API shape

Use ordinary JSON REST endpoints for the Larafeed web application. Keep the existing Google Reader and Fever APIs as protocol-specific HTTP routes.

Initial endpoint groups:

```text
/api/auth/*
/api/feeds/*
/api/entries/*
/api/categories/*
/api/subscriptions/*
/api/imports/*
/api/charts/*
/api/profile/*
/api/reader/*       existing Google Reader protocol
/api/fever/*        existing Fever protocol
```

Use consistent structured errors:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request is invalid.",
    "fields": { "feed_url": "A feed URL is required." }
  }
}
```

Downloads, static assets, image transformations, and compatibility APIs remain regular HTTP responses rather than RPC methods.

Safe reads and commands remain separate. In particular, `GET /api/entries/:id` never marks an entry as read; read state changes through an explicit idempotent mutation. Prefetching must never cause a write.

## Frontend migration

Replace Inertia incrementally while preserving page components and Mantine UI.

TanStack Query is the only remote-data authority. React Router loaders may parse and canonicalize URL state, guard authentication, and call shared `queryClient.ensureQueryData` or `prefetchQuery` option factories. They must not maintain separate loader-owned copies of server data. API writes use TanStack mutations rather than router actions. Migrate a complete feature domain at a time instead of mirroring Inertia props into Query state.

| Current | Target |
| --- | --- |
| `createInertiaApp` | React Router application root |
| Inertia `Link` | React Router `Link` |
| `router.visit/get` | navigation plus TanStack queries |
| `router.post/patch/delete` | TanStack mutations |
| `useForm` | focused form state with API validation errors |
| `usePage` shared props | auth query and application context |
| partial reloads | independent query keys and selective invalidation |
| deferred props | disabled/lazy queries with skeleton states |
| Inertia prefetch | `queryClient.prefetchQuery` |
| Ziggy `route()` | typed path builders |

Define hierarchical domain key factories and colocated `queryOptions` rather than ad hoc arrays:

```text
authKeys.status()
feedKeys.lists()
categoryKeys.lists()
entryKeys.list({ feed, category, filter, order, page, pageSize })
entryKeys.detail(entryId)
entryKeys.summary(entryId)
readerKeys.counts()
```

Include every query-function input in the key. Keep finite and infinite list namespaces distinct. Clear protected query data and disable protected queries when the session expires or the user logs out.

Preserve URL-addressable reader state such as selected feed, category, filter, page, and entry. Retain numbered finite pagination during the initial migration because the current interface exposes first, previous, numbered, next, and last-page navigation. Use intentional placeholder data between pages. Reconsider cursor/infinite pagination only as a separate UX change, with defined URL, back-button, keyboard-navigation, and retained-page behavior.

## Data model

### Initial D1 mapping

- Use `INTEGER PRIMARY KEY` for identifiers. Assert imported and generated IDs remain safe at the JavaScript boundary; otherwise encode IDs as strings in wire contracts.
- Store timestamps as epoch-millisecond `INTEGER` values in UTC.
- Store booleans as constrained `INTEGER` values.
- Store filter rules as validated JSON text.
- Define foreign keys and cascades in initial table definitions.
- Keep article HTML in D1 until measurements justify another tier.
- Put article content in a separate `entry_contents` table so list queries read metadata only.
- Define and enforce a maximum encoded article-content size so an oversized entry becomes a classified ingestion outcome rather than a poison job.

### D1 access and atomicity

- Use Wrangler SQL migrations at explicit deployment or administration boundaries. Never run migrations during module initialization or request handling.
- Wrap the native `D1Database` binding in one invocation-provided Effect service. Do not assume a generic SQL adapter exposes atomic `batch()`, Sessions/bookmarks, `D1Result.meta`, or the required transaction semantics.
- Decode returned rows with repository-owned Effect Schemas and map storage failures to typed operational errors.
- Model atomic operations as prepared native batches. Apply equivalent ownership and liveness predicates to every statement and inspect every result's `meta.changes`; all-zero results map to stable domain races, while mixed results are invariant violations.
- Create D1 Sessions for one logical consistency flow. Do not retain Sessions across invocations. Do not enable read replication until read-after-write behavior is designed and tested with bookmarks or primary-backed sessions.

### Required redesigns

1. **Sparse interactions**
   - Avoid creating interaction rows for non-matching filters.
   - Store only meaningful read, unread, starred, archived, or filtered state.

2. **Mark-all-read watermark**
   - Add a per-subscription read-through entry identifier so marking a feed read is one update rather than one write per entry.
   - Base the watermark on ingestion identity rather than publication time so late-arriving old articles remain unread.
   - Keep explicit interaction rows for manual unread/read exceptions.

3. **Refresh scheduling fields**
   - Store `last_attempt_at`, `latest_entry_at`, and `next_refresh_at` explicitly.
   - Select due feeds with a simple indexed query rather than correlated interval calculations.

4. **Counts**
   - Begin with indexed queries.
   - Add maintained per-subscription counters only if production-shaped benchmarks show that aggregation is too costly.

5. **Retention**
   - Define retention for `feed_refreshes` before production launch.
   - Measure article-content growth before deciding whether to truncate, compress, expire, or archive old content.

### Candidate indexes

```sql
CREATE INDEX entries_feed_published
  ON entries(feed_id, published_at DESC, id DESC);

CREATE INDEX entries_feed_created
  ON entries(feed_id, created_at DESC, id DESC);

CREATE INDEX subscriptions_feed
  ON feed_subscriptions(feed_id, user_id);

CREATE INDEX subscriptions_user_category
  ON feed_subscriptions(user_id, category_id, feed_id);

CREATE INDEX refreshes_feed_time
  ON feed_refreshes(feed_id, refreshed_at DESC);
```

Treat these as starting candidates, not guaranteed minimums. Define the final indexes from actual repository queries, verify them with `EXPLAIN QUERY PLAN`, and include interaction-side indexes needed by reader counts and joins. Retain bounded `OFFSET` pagination for the initial numbered-page UI; establish a measured depth threshold before changing the product to cursor pagination.

## Background processing

```text
Cron or HTTP command
  → reserve bounded due work / commit command + outbox row in D1
  → dispatcher leases pending outbox rows
  → enqueue a stable operation ID
  → Queue consumer loads authoritative D1 state
  → fetch and parse the feed
  → atomic D1 batch commits entries and job/refresh state
  → acknowledge the message
```

Requirements:

- Every job has a stable application-generated operation ID. Consumers are idempotent because Queues provide at-least-once, unordered delivery.
- Use conditional scheduling and dispatch leases so overlapping Cron invocations converge safely.
- D1 writes and Queue sends do not share a transaction. Use a D1 outbox for authoritative manual refresh, import, notification, or other commands whose loss would violate product behavior. Recover ambiguous sends and stale dispatch leases.
- Unique database constraints remain the final duplicate defense.
- Configure explicit Queue batch size, consumer concurrency, and bounded in-batch parallelism from upstream politeness, D1 capacity, and cost measurements.
- Process and acknowledge messages individually unless replaying the complete batch is demonstrably safe. Acknowledge only after authoritative D1 completion commits.
- Queue delivery owns job retries. Effect retries are limited to short, bounded, idempotent sub-operations with typed classification, jitter, and `Retry-After` handling.
- Persist backoff beyond Queue's supported delay window in `next_refresh_at` rather than keeping a message alive indefinitely.
- D1 is the durable job ledger. Processing and lost-delivery redrive have bounded attempt budgets, record a terminal job/outbox state and failure class in D1, and never depend on a Queue DLQ.
- External fetches are bounded by response size, redirect count, timeout, and subrequest count. URL and redirect policy receive a dedicated SSRF review because the current Go DNS-pinning behavior cannot be copied directly to Worker `fetch()`.
- Await response-critical work. Use `ctx.waitUntil()` only for optional bounded HTTP post-response work whose failure does not require durable Queue semantics; Queue and scheduled handlers await their authoritative processing.
- Queue messages contain operation identifiers and small metadata, not feed or OPML payloads.

## Delivery phases

### Phase 0: validate the foundations

- Define production-shaped entry counts, identifier ranges, article-content sizes, database size, and growth assumptions.
- Produce a representative benchmark dataset, including oversized entries and dense interaction histories.
- Spike Worker + Hono + Effect request handling and an application-owned native D1 Effect adapter.
- Verify native batch semantics, affected-row inspection, Sessions/bookmarks, result metadata, D1 migration application, and read-after-write behavior.
- Benchmark the reader list, sidebar counts, mark-all-read, feed ingestion, bounded batch sizes, and concurrent reads/writes. Record overload frequency as well as latency.
- Project per-database storage with headroom and define classified behavior for rows or imports approaching current platform limits.
- Confirm the chosen Effect v4 packages and Cloudflare runtime compatibility. Pin the resolved Effect v4 beta and aligned `@effect/*` packages exactly; treat upgrades as migrations.
- Run security spikes for arbitrary feed/image fetching, redirect validation, CSRF, WebAuthn RP/origin validation, invite/recovery token consumption, session revocation, optional Turnstile verification, and mandatory Workers Rate Limiting bindings.
- Build an expected and plausible worst-case cost model from real traffic assumptions. Include Workers CPU/invocations, D1 rows read/written and storage, Queue sends/retries, Images transformations, telemetry, AI, and external providers.
- Define kill switches and rollout bounds for Cron producers, Queue concurrency, imports, Images, AI, and telemetry sampling.

**Gate:** D1 must meet quantitative storage, identifier-safety, latency, concurrency, batch, and cost thresholds. Otherwise choose a separate PostgreSQL/Hyperdrive persistence branch with PostgreSQL-specific repositories and migrations. Hyperdrive is not a transparent D1 fallback; authentication and read-after-write paths must use explicitly safe cache behavior.

### Phase 1: application shell

- Add the Worker, Vite, React Router, TanStack Query, and Effect runtime boundaries.
- Keep only pure configuration, logger configuration, and other isolate-safe services in an optional module-level `ManagedRuntime`. Provide the current `env`, `Request`, `ExecutionContext`, cancellation signal, D1 adapter/session, and invocation identifiers for every HTTP, Queue, and scheduled event.
- Run one Effect program at each host boundary. Preserve defects and interruption until the outer adapter records them and emits a safe response or retry decision.
- Serve the React application through Worker Static Assets with SPA fallback and selective Worker-first routing for API, authentication, image, and compatibility paths. Add security headers without routing hashed assets through Worker unnecessarily.
- Establish separate wire schemas, persistence-row schemas, tagged errors, configuration, privacy-safe logging, and tests.
- Implement WebAuthn passkey registration and authentication with environment-specific RP IDs and exact allowed origins. Production targets `larafeed.stanislas.cloud`; the test deployment uses separate credentials bound to its own hostname.
- Implement admin-generated, short-lived, one-time enrollment and recovery links with atomic consumption and audit events. Add an explicit operator command for initial administrator enrollment and last-admin recovery.
- Implement D1-backed sessions using an opaque random session identifier in a `Secure`, `HttpOnly`, `SameSite=Lax` cookie. Define expiry, rotation, revocation, key rotation, Origin/CSRF validation for unsafe methods, and Workers Rate Limiting bindings for authentication and expensive commands.
- Keep Turnstile optional for passkey ceremonies. When enabled, require server-side token validation; when disabled, omit the widget and tokens while retaining mandatory Worker rate limits. Do not challenge ordinary authenticated traffic by default.
- Implement hashed, revocable app-specific tokens for Google Reader and Fever authentication.
- Store production credentials as Worker secrets and keep local-development secret handling explicit and separate.
- Keep one stable browser QueryClient. Choose and pin the React Router, TanStack Query, and form packages; keep all Mantine packages aligned.

**Gate:** admin invitation, passkey enrollment/login/logout, recovery, multiple-passkey management, app-token authentication/revocation, test/production RP isolation, disabled and enabled Turnstile modes, mandatory ceremony rate limiting, session expiry/revocation, CSRF rejection, protected-cache clearing, protected navigation, SPA deep links, security headers, and asset deployment work in local and preview environments.

### Phase 2: reader vertical slice

- Implement feed/category sidebar data with domain query-key and `queryOptions` factories.
- Implement the numbered finite entry list first, including complete filter/order/page inputs and intentional placeholder data during page changes.
- Implement side-effect-free entry detail prefetching plus explicit desired-state mutations for read, unread, starred, and filtered state. Avoid toggle-only APIs so overlapping mutations converge.
- Define mutation reconciliation for detail data, every affected retained list page, feed/sidebar counts, and global counts. Prefer authoritative responses and targeted invalidation; use optimistic updates only where rollback and overlapping-mutation behavior are tested.
- Replace the corresponding Inertia navigation and forms one complete feature domain at a time.
- Preserve pane-specific initial, empty, stale/background-fetch, recoverable-error, terminal-error, and mutation-pending states.
- Define desktop split panes and a URL-driven single list/detail pane on narrow screens, including back navigation, focus restoration, scoped keyboard shortcuts, semantic links, accessible icon names, landmarks, splitter behavior, and constrained article media.

**Gate:** the core reader works end to end against D1, matches current behavior, never writes during prefetch, and passes desktop/mobile, keyboard, accessibility, cache-concurrency, and navigation-history checks.

### Phase 3: ingestion and jobs

- Implement feed discovery, parsing, sanitization, conditional requests, classified oversized-content handling, and backoff.
- Add Cron, durable D1 job/outbox state, and Queues for scheduled/manual refreshes.
- Add favicon refresh and Cloudflare Images transformations, not Images-hosted storage. Expose fixed transformation presets through signed or opaque application URLs tied to stored source records; do not enable unrestricted arbitrary-origin transformation. Bound source validation, redirects, bytes, dimensions, time, unique transformations, and fallback behavior.
- Implement OPML imports with D1 import/item rows and Queues only: validate and parse the upload, reject DTD/external entities, deduplicate URLs, preserve categories, enqueue one small item identifier per feed, process with bounded concurrency, record partial failures and progress in D1, allow retrying failed items, and let the frontend poll import status.
- Add operational controls for Queue pause/concurrency, producer disablement, backlog age, oldest due feed, retry classes, and terminal D1 job reconciliation.

**Gate:** duplicate and reordered delivery are safe, ambiguous sends recover, failed jobs have durable state, image transformation cannot be used as an open proxy, and refresh scheduling remains polite and bounded under backlog.

### Phase 4: remaining product surface

- Profile, passkey and app-token management, admin invitations/recovery, categories, subscription settings, charts, and OPML export.
- Inventory each current feature as implemented, stubbed, insecure, intentionally removed, or newly completed. Remove password login/reset, email verification, and TOTP UI/routes rather than migrating their incomplete behavior.
- Route Gemini summaries through AI Gateway with bounded input, per-user application rate limiting, Gateway budgets/rate limits, semantically safe caching, controlled provider retries/fallbacks, and a feature kill switch.
- Telegram notifications through durable queued delivery when loss matters, or bounded `waitUntil()` work when it does not.
- Google Reader and Fever compatibility routes.
- Keep form fields in their form owner and mutation lifecycle in TanStack Query. Preserve nested field errors, first-error focus, multipart OPML handling, and one-time display of new app tokens or recovery links.

**Gate:** focused contract tests pass for web, Google Reader, and Fever clients, and the feature inventory has an explicit disposition for every existing route and UI surface.

### Phase 5: production bootstrap

- Provision an empty production D1 database and apply every Wrangler migration.
- Keep refresh scheduling, Queue dispatch, and AI summaries disabled for the first deployment.
- Enroll the first administrator and import subscriptions through OPML.
- Enable Queue dispatch, inspect initial refresh outcomes, and then enable scheduled refreshes.
- Monitor errors, queue and outbox backlog, oldest due feed, D1 latency and overload, image and AI usage, and authentication failures.

**Gate:** the empty-database bootstrap and OPML import are repeatable, validated, and operationally bounded.

## Validation strategy

- Unit-test Effect services with `@effect/vitest`, explicit test layers, and deterministic time. Cover typed failures, interruption, retry exhaustion, layer construction/release, and invariant defects.
- Contract-test every wire schema and stable tagged protocol error at the HTTP boundary. Test persistence schemas separately.
- Integration-test Wrangler D1 migrations, native batches, affected-row races, Sessions/bookmarks, foreign keys, repositories, outbox recovery, and idempotent Queue consumers.
- Separate runtime-neutral tests from Workerd integration tests. Use Cloudflare's Vitest pool with deployment-matching compatibility settings and await execution-context work before asserting `waitUntil()` outcomes.
- Test TanStack Query cancellation reaching Effect and the underlying fetch, one retry owner, domain key factories, targeted invalidation, protected-cache clearing, and overlapping mutations with an isolated real QueryClient.
- Browser-test authentication, reader navigation, safe prefetching, numbered pagination, stale/background states, entry interactions, forms, desktop/mobile layouts, keyboard flow, focus restoration, reduced motion, and both color schemes.
- Maintain compatibility fixtures for Google Reader, Fever, RSS, Atom, and OPML.
- Load-test with production-shaped entry and interaction counts, not empty databases. Use `EXPLAIN QUERY PLAN` and D1 result metadata to verify row-scan and index assumptions.
- Use native Workers spans at coarse HTTP, Queue, scheduled, and meaningful business boundaries. Effect spans do not automatically appear in Workers Observability; do not add an Effect OpenTelemetry SDK merely to duplicate native platform traces.
- Emit structured privacy-safe logs once at the owning boundary. Track D1 rows read/written, query latency, database size/overload, Worker CPU, outbox/Queue age, retries, durable dead-letter state, feed-fetch failures, Images usage, AI usage, and telemetry volume.

## Decisions to revisit only with evidence

- **Cap'n Web:** adopt only for a concrete stateful, pipelined, or bidirectional workflow that REST handles poorly.
- **R2 article storage:** adopt only when measured D1 size, row-size, or latency requires it.
- **Maintained counters:** add only when indexed aggregation misses latency or cost targets.
- **Analytics Engine:** add only when a defined custom metric or time-series query cannot be served by native Workers Observability.
- **D1 sharding:** avoid initially because feeds are shared while interactions are user-specific.
- **External PostgreSQL:** use a separately designed PostgreSQL/Hyperdrive persistence branch if D1 fails the Phase 0 gate. Hyperdrive does not make PostgreSQL Cloudflare-hosted, does not replace PostgreSQL migrations/repositories, and requires explicit cache policy for authentication and read-after-write paths.

## Completion criteria

- All current user-facing features have an explicit implemented, replaced, or intentionally removed status.
- Core behavior and compatibility tests pass.
- Production-shaped D1 capacity, consistency, cost, and security gates pass or the PostgreSQL/Hyperdrive branch is selected explicitly.
- Empty-database provisioning, administrator enrollment, and OPML bootstrap are rehearsed.
- Operational dashboards, alerts, and kill switches cover HTTP errors, D1, outbox/Queues, external feed and image fetches, Images, AI, and authentication.
- No legacy server runtime or PostgreSQL data-migration dependency remains.

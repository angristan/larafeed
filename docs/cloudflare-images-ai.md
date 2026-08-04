# Cloudflare Images and AI Gateway

## Feed images

Larafeed stores normalized favicon PNGs in D1 by their SHA-256 content hash. Reader payloads contain a same-origin public URL and never expose the publisher URL:

```text
/api/public/favicons/v1/{sha256}.png
```

Users can request an ownership-checked refresh with `POST /api/feeds/{ownedFeedId}/favicon/refresh`. The CSRF- and rate-limit-protected endpoint returns `202`, creates or reuses one forced durable job, and immediately dispatches its operation ID. The Queue consumer fetches at most 1 MiB of site HTML, ranks at most four non-SVG icon links, probes three same-origin fallback paths, and validates every URL and redirect with the feed SSRF policy. Image probes allow at most three redirects, five seconds, and 2 MiB, require a non-SVG image MIME type, and reject empty bodies.

A selected image is transformed once through the Images binding to a fixed 32 × 32 PNG with animation disabled. Larafeed analyzes darkness from those normalized bytes, hashes them with SHA-256, and inserts at most 64 KiB into D1. Identical normalized bytes reuse one row. The asset insert completes before D1 switches the feed's `favicon_asset_hash`; a fetch, transform, or persistence failure leaves the previous asset and darkness intact. A feed-update race can leave a harmless content-addressed orphan.

The public route requires no session, rate limit, ownership query, upstream fetch, or Images transform. It checks the per-colo Worker Cache API first and reads D1 only on a cold or evicted cache entry. Successful responses use `Content-Type: image/png`, a hash ETag, and `Cache-Control: public, max-age=31536000, immutable`. Errors use `no-store`. The immutable browser cache normally avoids every repeat request. D1 remains authoritative because Cache API entries are non-durable and may be evicted.

Cron reserves at most five actively subscribed stale or missing favicons per tick as D1 jobs with outbox rows. Successful feed refreshes reserve that exact feed when needed, so normal adds and OPML imports do not wait for Cron. Each Queue message contains one stable operation ID, and `max_batch_size=1` gives each feed an independent consumer invocation, lease, retry policy, and terminal D1 transition. One failed publisher cannot block another feed.

A successful check, including a bounded permanent no-icon result, advances `favicon_updated_at`; the same feed is not retried until its 30-day refresh interval passes. Transient transport, timeout, `408`/`425`/`429`/`5xx`, Images, and storage failures retry with bounded backoff. Exhausted work records durable terminal state and applies the same cooldown without deleting a previous asset. Cron recovers expired leases and old sent-but-incomplete messages using the original operation ID. It also deletes at most 100 unreferenced favicon rows older than 30 days. Migration `0015` marks existing favicon sources stale for bounded D1 backfill; migration `0016` enforces one active favicon job per feed.

The old authenticated `/api/images/feeds/{feedId}/small` route remains only as a migration fallback while a feed has an upstream source but no normalized asset hash.

Wrangler declares the `IMAGES` transformation binding plus one dedicated favicon Queue. D1 records terminal failures; no Queue DLQ, R2, or hosted Cloudflare Images storage is required.

## Article images

Reader entry responses rewrite at most 100 safe article `<img>` sources to ownership-bound paths:

```text
/api/images/entries/{ownedEntryId}/{imageIndex}
```

The source URL remains server-side. Each image request authenticates the session, verifies that the entry is visible through an active subscription, resolves only the indexed source from the stored sanitized article, and applies one fixed 1600 px scale-down transform. Source fetches reuse the redirect, timeout, MIME, SVG, credential, private-network, and 2 MiB protections used for favicons. The application CSP permits only controlled image origins, so a missed remote URL cannot contact a publisher from the browser.

Successful article images use `Cache-Control: private, max-age=86400` to prevent repeated requests during rerenders or a short revisit. Authentication, ownership, rate-limit, missing-source, and transformation failures remain `private, no-store`. The Worker Cache API still retains successful transformed article bytes for six hours under an opaque source digest. Article images are not persisted in R2 because most posts are read once.

`IMAGES_ENABLED` is the fail-closed rollout control for favicon normalization and article transformations.

## AI summaries

`GET /api/entries/{id}/summary` is side-effect-free. `POST` requires the web session, exact CSRF checks, and per-user rate limiting.

The Worker:

1. Checks entry ownership and filtered state.
2. Reuses a D1 summary keyed by entry content hash, model, and prompt version.
3. Claims a 60-second D1 generation lease for that complete cache key. Concurrent
   misses in other isolates return a retryable conflict instead of making another
   paid provider call. Saving is atomically fenced by the current content hash,
   unexpired lease, and lease token, so changed articles and expired owners cannot
   publish stale output. Failed or interrupted requests release the lease, and its
   expiry recovers abandoned ownership.
4. Sanitizes article HTML and sends at most 50 KiB of article text.
5. Calls Gemini only through the configured AI Gateway.
6. Uses a 15-second total deadline and at most one retry for transport, `429`, or `5xx` failures.
7. Bounds the provider body and sanitized summary HTML.
8. Inserts idempotently and reloads the winner on a unique race.

The request disables AI Gateway response caching because D1 owns the semantic cache key. It also disables prompt/response log collection so article content is not stored in Gateway logs. Gateway request counts and provider metrics remain available.

### Configuration

Selecting the summary view keeps `summarize=true` in reader URL state. A cache miss automatically submits the CSRF-protected generation command once and shows the legacy loading skeleton; there is no second generate step.

AI summaries are disabled by default:

```json
"AI_SUMMARY_ENABLED": "false"
```

Required production secrets:

```bash
npm exec -- wrangler secret put AI_GATEWAY_ACCOUNT_ID --config wrangler.jsonc --env production
npm exec -- wrangler secret put GEMINI_API_KEY --config wrangler.jsonc --env production
```

Non-secret variables select the gateway and model:

```text
AI_GATEWAY_NAME=larafeed
AI_MODEL=gemini-2.5-flash
```

Before enabling summaries, create and authenticate the `larafeed` AI Gateway outside this repository. Configure provider budgets and Gateway rate limits, then change the kill switch in a reviewed deployment. This branch has not created a Gateway, written secrets, deployed, or enabled AI calls.

The application rate limiter is a second cost boundary. Cached D1 summaries avoid provider calls until article content, model, or prompt version changes.

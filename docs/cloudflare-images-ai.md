# Cloudflare Images and AI Gateway

## Feed images

Larafeed does not expose an arbitrary-origin image proxy. Reader payloads contain only opaque application URLs:

```text
/api/images/feeds/{ownedFeedId}/small
/api/images/feeds/{ownedFeedId}/medium
```

The route authenticates the web session, checks subscription ownership, and loads the source from the feed row. Feed refresh stores explicit feed icon metadata when valid. Otherwise it derives only the stored site origin's `/favicon.ico` URL.

Users can request an ownership-checked refresh with `POST /api/feeds/{ownedFeedId}/favicon/refresh`. The command is CSRF- and rate-limit-protected. It fetches at most 1 MiB of site HTML, ranks at most four non-SVG icon links, probes three same-origin fallback paths, and validates every URL and redirect with the feed SSRF policy. Image probes allow at most three redirects, five seconds, and 2 MiB, require a non-SVG image MIME type, and reject empty bodies. The API returns only the opaque Larafeed image URL.

Cron checks one actively subscribed stale or missing favicon per tick. A successful check, including a bounded no-icon result, advances `favicon_updated_at`; the same feed is not retried until its 30-day refresh interval passes. Favicon maintenance failures do not block feed refresh or OPML Cron work.

Two fixed Cloudflare Images presets exist:

| Preset | Transform |
| --- | --- |
| `small` | 32 × 32, cover, quality 80 |
| `medium` | 64 × 64, cover, quality 80 |

Each fetch validates the source and every redirect with the feed SSRF policy. It permits at most three redirects, five seconds, and 2 MiB. It rejects non-image responses and SVG. Missing or failed sources return a fixed transparent PNG without source details.

Every image request authenticates first. Feed and article routes then share one `image:{userId}` rate-limit key, so changing feed IDs, presets, entry IDs, or image indexes cannot multiply the user's transformation budget. Ownership is still checked for the requested feed or entry before any cached bytes or origin source are used.

Successful transforms use Cloudflare's Cache API for six hours. The internal key contains only the application origin, fixed preset and output format, and a SHA-256 digest of the server-owned source URL. It never contains the source origin, path, query, or credentials. Cache lookup happens only after authentication, ownership, and server-side source resolution. Client responses remain `private, no-store`, and internal cache headers are not forwarded, so authenticated images do not enter a public browser or shared HTTP cache. A source URL or preset change selects a new internal entry; expiration bounds staleness when bytes change at the same URL.

Wrangler declares the `IMAGES` binding. It stores no images in Cloudflare Images and creates no variants or hosted assets.

## Article images

Reader entry responses rewrite at most 100 safe article `<img>` sources to ownership-bound paths:

```text
/api/images/entries/{ownedEntryId}/{imageIndex}
```

The source URL remains server-side. Each image request authenticates the session, verifies that the entry is visible through an active subscription, resolves only the indexed source from the stored sanitized article, and applies one fixed 1600 px scale-down transform. Source fetches reuse the redirect, timeout, MIME, SVG, credential, private-network, and 2 MiB protections used for favicons. The application CSP permits only same-origin and data images, so a missed remote URL cannot contact a publisher from the browser.

`IMAGES_ENABLED` is the fail-closed rollout control for both feed and article transformations.

## AI summaries

`GET /api/entries/{id}/summary` is side-effect-free. `POST` requires the web session, exact CSRF checks, and per-user rate limiting.

The Worker:

1. Checks entry ownership and filtered state.
2. Reuses a D1 summary keyed by entry content hash, model, and prompt version.
3. Sanitizes article HTML and sends at most 50 KiB of article text.
4. Calls Gemini only through the configured AI Gateway.
5. Uses a 15-second total deadline and at most one retry for transport, `429`, or `5xx` failures.
6. Bounds the provider body and sanitized summary HTML.
7. Inserts idempotently and reloads the winner on a unique race.

The request disables AI Gateway response caching because D1 owns the semantic cache key. It also disables prompt/response log collection so article content is not stored in Gateway logs. Gateway request counts and provider metrics remain available.

### Configuration

Selecting the summary view keeps `summarize=true` in reader URL state. A cache miss automatically submits the CSRF-protected generation command once and shows the legacy loading skeleton; there is no second generate step.

AI summaries are disabled by default:

```json
"AI_SUMMARY_ENABLED": "false"
```

Required production secrets:

```bash
wrangler secret put AI_GATEWAY_ACCOUNT_ID
wrangler secret put GEMINI_API_KEY
```

Non-secret variables select the gateway and model:

```text
AI_GATEWAY_NAME=larafeed
AI_MODEL=gemini-2.5-flash
```

Before enabling summaries, create and authenticate the `larafeed` AI Gateway outside this repository. Configure provider budgets and Gateway rate limits, then change the kill switch in a reviewed deployment. This branch has not created a Gateway, written secrets, deployed, or enabled AI calls.

The application rate limiter is a second cost boundary. Cached D1 summaries avoid provider calls until article content, model, or prompt version changes.

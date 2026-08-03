# Cloudflare feature inventory

This inventory is the deployment contract. “Implemented” means the Cloudflare application owns the behavior. “Removed” means the legacy route or UI must not remain reachable.

## Implemented or replaced

| Legacy surface | Cloudflare disposition |
| --- | --- |
| Reader sidebar, feed/category scopes, unread/read/favorites filters | Implemented with D1-backed typed APIs and React Router URL state. |
| Original product interface and reader conveniences | Preserved with the original Larafeed logo, 56px icon navigation, compact feed hierarchy, card-based entry list, article toolbar, shared settings shell, subscriptions table, persistent system/light/dark themes, keyboard-accessible resizable desktop panes, J/K and search shortcuts, Shift+? help, Unicode-aware reading-time estimates, and friendly route/error recovery pages. |
| Entry list/detail, numbered pagination, read/unread, star/unstar, archive state | Implemented with sparse interactions and ingestion-ID read watermarks. Detail prefetch is side-effect-free. |
| Mark feed as read | Implemented as an atomic read-through watermark update without user-by-entry writes. |
| RSS, Atom, RDF, and JSON Feed refresh | Implemented with bounded secure fetch, parsing, sanitization, conditional requests, JSON Feed 1.0/1.1 discovery, Queues, Cron, durable jobs, outbox, retries, and DLQs. |
| Manual refresh | Implemented as an authenticated, CSRF-protected durable command with per-feed active-job deduplication and the legacy five-minute post-success cooldown. |
| OPML import and progress | Implemented with bounded parsing, verified feed discovery before success, one durable item per feed, partial failure reporting, retries, and progress polling. |
| OPML export | Implemented as an authenticated download. |
| Individual feed and website discovery | Implemented with bounded direct-feed parsing, HTML alternate discovery, safe redirects, common-path probes, one-step first-feed category creation, shared-feed reuse, an immediate durable refresh command, and the original draggable bookmarklet URL prefill flow. |
| Category and subscription management | Implemented with category create/rename/delete, nullable custom names, category moves, durable all-time last-failure metadata, searchable refresh audit, contextual feed actions, manual refresh, and ownership-safe unsubscribe with route/cache cleanup. The final subscriber removes the shared feed. |
| Per-subscription title/content/author filters | Implemented with the original title/content/author editor, bounded safe regex evaluation, literal fallback for invalid regex, sparse matches only, existing-entry rebuilds, and refresh-time evaluation. Read/star/archive state is preserved. |
| Product charts | Implemented with bounded UTC windows and feed/category ownership checks. Entry cohorts report their current read/saved state, sparse daily aggregates record real user transitions without user-by-entry amplification, and daily refresh aggregates preserve complete 365-day attempt charts while detailed history remains bounded. Pre-aggregate user activity is shown as unavailable rather than zero. |
| Login and account bootstrap | Replaced by passkeys, Turnstile, opaque D1 sessions, admin-generated one-time links, and the operator recovery command. |
| Multiple passkeys | Implemented end to end. Users can list, add, and remove passkeys from account settings. The final passkey is protected. |
| Profile and account lifecycle | Implemented with normalized unique email/display-name editing, server-enforced five-minute fresh-passkey sessions and username confirmation for reader-data clearing or account deletion, shared-feed preservation, orphan cleanup, and final-active-administrator protection. |
| Administrator invitations and recovery | Implemented with a role-guarded dashboard for bounded user/link listings, one-time enrollment and recovery URLs, link revocation, account disable/reactivation, session revocation, and recent security events. |
| Security notifications and audit | Password-login failure and public-registration Telegram triggers no longer exist. Passkey-era account, credential, access-link, token, and authentication events are stored in D1 and visible in the administrator security ledger; rate-limit and infrastructure alerts remain in Cloudflare observability. |
| Google Reader and Fever | Implemented with scoped, revocable app tokens, chronological monotonic item IDs, and no upstream favicon URL disclosure. Password authentication is removed. |
| API token settings | Implemented with one-time plaintext display and revocation. |
| Favicons and article image privacy | Replaced by ownership-bound opaque routes and fixed Cloudflare Images transforms. Manual and bounded monthly stale refreshes discover ranked HTML icons, probe safe same-origin fallbacks, validate every redirect/MIME/size, and restore bounded 10×10 luminance classification before storing source metadata. The application is not an arbitrary image proxy. |
| Gemini summaries | Replaced by bounded, cached AI Gateway requests with a kill switch and application rate limits. |
| Initial subscriptions | Start from an empty D1 database, enroll users with passkeys, and import subscription outlines through OPML. Legacy entries, interactions, tokens, and refresh history are not imported. |

## Intentionally removed

| Legacy surface | Reason or replacement |
| --- | --- |
| Password registration/login/reset/confirmation | Passkey-only authentication. Password hashes are not migrated. |
| Email verification | Private admin-controlled enrollment replaces public registration. |
| TOTP/two-factor challenge and settings | Passkeys are the only web credential. TOTP secrets are not migrated. |
| Public registration | Users are provisioned through short-lived admin enrollment links. |
| Server-rendered Inertia pages, Ziggy routes, and Laravel-style form helpers | Replaced by React Router, TanStack Query, and typed JSON HTTP APIs. |
| Go HTTP server, River workers, PostgreSQL runtime, Docker image deployment | Replaced by Workers, D1, Queues, Cron, Static Assets, Images, and AI Gateway. |

## Operator-only surfaces

- Initial administrator enrollment and last-administrator recovery use `scripts/auth-access-link.ts` with `AUTH_OPERATOR_SECRET`.
- Ordinary administrators use `/admin/users` for invitations, recovery, link revocation, account state, and the security ledger.
- Cloudflare resource provisioning, secret writes, D1 migration application, deployment, and traffic activation remain explicit operator actions. Nothing in normal tests performs them.

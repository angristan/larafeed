# Cloudflare feature inventory

This inventory is the cutover contract. “Implemented” means the Cloudflare application owns the behavior. “Removed” means the legacy route or UI must not remain reachable after cutover.

## Implemented or replaced

| Legacy surface | Cloudflare disposition |
| --- | --- |
| Reader sidebar, feed/category scopes, unread/read/favorites filters | Implemented with D1-backed typed APIs and React Router URL state. |
| Entry list/detail, numbered pagination, read/unread, star/unstar, archive state | Implemented with sparse interactions and ingestion-ID read watermarks. Detail prefetch is side-effect-free. |
| Mark feed as read | Implemented as an atomic read-through watermark update without user-by-entry writes. |
| RSS, Atom, RDF, and JSON Feed refresh | Implemented with bounded secure fetch, parsing, sanitization, conditional requests, JSON Feed 1.0/1.1 discovery, Queues, Cron, durable jobs, outbox, retries, and DLQs. |
| Manual refresh | Implemented as an authenticated, CSRF-protected durable command. |
| OPML import and progress | Implemented with bounded parsing, one durable item per feed, partial failure reporting, retries, and progress polling. |
| OPML export | Implemented as an authenticated download. |
| Individual feed and website discovery | Implemented with bounded direct-feed parsing, HTML alternate discovery, safe redirects, common-path probes, category selection, shared-feed reuse, and an immediate durable refresh command. |
| Category and subscription management | Implemented with category create/rename/delete, custom names, category moves, searchable refresh audit, manual refresh, and ownership-safe unsubscribe. The final subscriber removes the shared feed. |
| Per-subscription title/content/author filters | Implemented with bounded safe regex evaluation, literal fallback for invalid regex, sparse matches only, existing-entry rebuilds, and refresh-time evaluation. Read/star/archive state is preserved. |
| Product charts | Implemented with bounded UTC windows and feed/category ownership checks. Entry cohorts report their current read/saved state, sparse daily aggregates record real user transitions without user-by-entry amplification, and refresh charts use durable refresh history. Pre-aggregate activity is shown as unavailable rather than zero. |
| Login and account bootstrap | Replaced by passkeys, Turnstile, opaque D1 sessions, admin-generated one-time links, and the operator recovery command. |
| Multiple passkeys | Implemented end to end. Users can list, add, and remove passkeys from account settings. The final passkey is protected. |
| Profile and account lifecycle | Implemented with normalized unique email/display-name editing, fresh-passkey and username confirmation for reader-data clearing or account deletion, shared-feed preservation, orphan cleanup, and final-active-administrator protection. |
| Administrator invitations and recovery | Implemented with a role-guarded dashboard for bounded user/link listings, one-time enrollment and recovery URLs, link revocation, account disable/reactivation, session revocation, and recent security events. |
| Security notifications and audit | Password-login failure and public-registration Telegram triggers no longer exist. Passkey-era account, credential, access-link, token, and authentication events are stored in D1 and visible in the administrator security ledger; rate-limit and infrastructure alerts remain in Cloudflare observability. |
| Google Reader and Fever | Implemented with scoped, revocable app tokens. Password authentication is removed. |
| API token settings | Implemented with one-time plaintext display and revocation. |
| Favicons and article image privacy | Replaced by ownership-bound opaque routes and fixed Cloudflare Images transforms. The application is not an arbitrary image proxy. |
| Gemini summaries | Replaced by bounded, cached AI Gateway requests with a kill switch and application rate limits. |
| Existing users, feeds, entries, categories, subscriptions, interactions, compatible tokens, and refresh history | Migrated by the deterministic PostgreSQL exporter. Existing users enroll new passkeys after cutover. |

## Intentionally removed

| Legacy surface | Reason or replacement |
| --- | --- |
| Password registration/login/reset/confirmation | Passkey-only authentication. Password hashes are not migrated. |
| Email verification | Private admin-controlled enrollment replaces public registration. |
| TOTP/two-factor challenge and settings | Passkeys are the only web credential. TOTP secrets are not migrated. |
| Public registration | Users are provisioned through short-lived admin enrollment links. |
| Server-rendered Inertia pages, Ziggy routes, and Laravel-style form helpers | Replaced by React Router, TanStack Query, and typed JSON HTTP APIs. |
| Go HTTP server, River workers, PostgreSQL runtime, Docker image deployment | Replaced by Workers, D1, Queues, Cron, Static Assets, Images, and AI Gateway. Go remains only for the read-only migration exporter. |

## Operator-only surfaces

- Initial administrator enrollment and last-administrator recovery use `scripts/auth-access-link.ts` with `AUTH_OPERATOR_SECRET`.
- Ordinary administrators use `/admin/users` for invitations, recovery, link revocation, account state, and the security ledger.
- Cloudflare resource provisioning, secret writes, D1 imports, deployment, and traffic cutover remain explicit operator actions. Nothing in normal tests performs them.

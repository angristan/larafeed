# Cloudflare feature inventory

This inventory is the cutover contract. “Implemented” means the Cloudflare application owns the behavior. “Removed” means the legacy route or UI must not remain reachable after cutover.

## Implemented or replaced

| Legacy surface | Cloudflare disposition |
| --- | --- |
| Reader sidebar, feed/category scopes, unread/read/favorites filters | Implemented with D1-backed typed APIs and React Router URL state. |
| Entry list/detail, numbered pagination, read/unread, star/unstar, archive state | Implemented with sparse interactions and ingestion-ID read watermarks. Detail prefetch is side-effect-free. |
| Mark feed as read | Implemented as an atomic read-through watermark update without user-by-entry writes. |
| RSS, Atom, and RDF refresh | Implemented with bounded secure fetch, parsing, sanitization, conditional requests, Queues, Cron, durable jobs, outbox, retries, and DLQs. |
| Manual refresh | Implemented as an authenticated, CSRF-protected durable command. |
| OPML import and progress | Implemented with bounded parsing, one durable item per feed, partial failure reporting, retries, and progress polling. |
| OPML export | Implemented as an authenticated download. |
| Login and account bootstrap | Replaced by passkeys, Turnstile, opaque D1 sessions, admin-generated one-time links, and the operator recovery command. |
| Multiple passkeys | Backend list/add/delete behavior is implemented. Enrollment and recovery pages register passkeys. A separate passkey settings screen is intentionally omitted from the first private deployment. |
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
| Profile name/email editing and account deletion UI | Identity and access are admin-controlled for the private deployment. Changes require an operator/admin process. |
| Telegram login/registration notifications | Removed. Security events and Cloudflare observability are the operational record. |
| Charts page | Removed from the initial private deployment. Native observability covers operations; product charts had no required compatibility contract. |
| Individual feed creation/edit/delete screen | Removed initially. OPML import is the supported subscription-provisioning path. Migrated subscriptions remain readable. |
| Category and subscription-settings editor | Removed initially. Categories and names are preserved by migration/import and displayed by the reader. |
| Automatic per-subscription content filter rules for newly ingested entries | Removed because the legacy implementation amplified writes by user × entry. Existing filtered interaction state remains hidden. A future design must keep sparse storage. |
| Server-rendered Inertia pages, Ziggy routes, and Laravel-style form helpers | Replaced by React Router, TanStack Query, and typed JSON HTTP APIs. |
| Go HTTP server, River workers, PostgreSQL runtime, Docker image deployment | Replaced by Workers, D1, Queues, Cron, Static Assets, Images, and AI Gateway. Go remains only for the read-only migration exporter. |

## Operator-only surfaces

- Initial administrator enrollment and last-administrator recovery use `scripts/auth-access-link.ts` with `AUTH_OPERATOR_SECRET`.
- Admin enrollment/recovery APIs exist for private user provisioning. A dedicated admin dashboard is intentionally omitted.
- Cloudflare resource provisioning, secret writes, D1 imports, deployment, and traffic cutover remain explicit operator actions. Nothing in normal tests performs them.

# MCP server

Larafeed has a [Model Context Protocol](https://modelcontextprotocol.io/) server, so AI assistants can read your feeds and manage your reading. Each user turns it on in **Settings → MCP**. It is off by default.

## Connect a client

1. Open **Settings → MCP** and turn on **Allow MCP access**.
2. Copy the server URL, `https://<your Larafeed origin>/mcp`.
3. Add it to your MCP client as a remote server (Streamable HTTP).
4. The client opens Larafeed in your browser. Sign in with your passkey if needed, review the request, and choose **Allow**.

There is no token to copy. The client gets OAuth tokens and refreshes them on its own.

Apps get read-only access unless you tick write access on the consent page. To change an app's access later, connect it again; the new grant replaces the old one. If it later calls a write tool, it gets a `403 insufficient_scope` response and can ask you to approve write access.

## Tools

| Tool | Access | What it does |
| --- | --- | --- |
| `list_subscriptions` | read | Categories, feeds, and unread counts |
| `list_entries` | read | Entries without content, filtered by feed, category, and read state, with pagination |
| `get_entry` | read | One entry with its content as plain text (default) or sanitized HTML. It does not mark the entry read |
| `update_entries` | write | Marks up to 50 entries read, starred, or archived (or the reverse) |
| `mark_feed_read` | write | Marks every entry in one feed as read |
| `subscribe` | write | Adds a feed by feed or website URL. Returns the choices when a site offers several feeds |
| `unsubscribe` | write | Removes a subscription with its read and starred state |

Images in `get_entry` HTML keep their publisher URLs. Proxied image URLs would need a Larafeed session.

## Turning it off and disconnecting apps

- **Disconnect** on one app revokes its grant and tokens.
- Turning **Allow MCP access** off blocks every MCP token right away, then revokes all grants. Turning it on again does not reconnect old apps.
- A grant expires after 30 days without a token refresh.
- Disabled and deleted accounts lose MCP access with their sessions.

The security log records `mcp.enabled`, `mcp.disabled`, `mcp.client.authorized`, and `mcp.client.revoked` events.

## How it works

```
MCP client                          Larafeed Worker
----------                          ---------------
POST /mcp (no token)  ────────────▶ 401, points to resource metadata
GET  /.well-known/oauth-protected-resource/mcp
GET  /.well-known/oauth-authorization-server
POST /oauth/register (DCR), or a Client ID Metadata Document URL
browser ─▶ GET /authorize ────────▶ passkey session + consent page
POST /oauth/token ────────────────▶ access + refresh tokens
POST /mcp (Bearer) ───────────────▶ token check, opt-in check, tool call
```

- [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) implements OAuth 2.1 with PKCE, dynamic client registration, Client ID Metadata Documents, and the discovery documents. It stores clients, grants, and token hashes in the `OAUTH_KV` namespace.
- Larafeed owns `/authorize`. The page reuses the passkey session and shows the client's name, its verified domain when it has one, and where tokens go.
- D1 decides who has access: the opt-in (`users.mcp_enabled_at`) and one `mcp_connections` row per authorized app. Each token carries its connection ID in its encrypted props, and every MCP request checks the row is active. Disconnect and turning MCP off write D1 first, so they take effect at once, for any number of grants, and even if a token refresh races the revocation. Deleting the KV grant is cleanup.
- The consent form records which account it was shown for. If the browser signs in to another account before **Allow**, the request is refused.
- `/mcp` is stateless. Each request builds a fresh MCP server from [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) and answers with JSON. The endpoint serves both the 2025 and 2026-07-28 protocol revisions.
- Tool calls create `app.mcp.tool.call` trace spans with the tool name and error class. Arguments and results are not logged.
- `POST /oauth/register` uses the `AUTH_RATE_LIMITER` binding, per client IP.

### Compatibility flag

Client ID Metadata Documents need the `global_fetch_strictly_public` compatibility flag. It makes every outbound `fetch` go to the public internet, even for hostnames on the Worker's own Cloudflare zone. Feed, favicon, and full-content fetches already target public publishers, so they behave the same.

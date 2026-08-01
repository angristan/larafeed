# Google Reader and Fever compatibility APIs

Larafeed keeps its protocol-specific APIs for compatible reader clients. These routes use revocable app tokens, not passkeys or web sessions.

## Create credentials

Open **Reader app tokens** at `/settings/app-tokens`.

1. Create a separate token for each client.
2. Select `Google Reader`, `Fever`, or both.
3. Copy the plaintext token immediately. Larafeed stores only one-way hashes and cannot show it again.
4. Revoke the token from the same page to stop client access immediately.

Use your exact Larafeed username with the token as the protocol password.

### Google Reader

- Endpoint base: `https://larafeed.stanislas.cloud/api/reader`
- Username: your Larafeed username
- Password: the app token

`ClientLogin` validates the existing token and returns it as the opaque `GoogleLogin` credential. It does not mint another credential.

### Fever

- Endpoint: `https://larafeed.stanislas.cloud/api/fever/`
- Username: your exact Larafeed username
- Password: the app token

Standard Fever clients send `api_key = MD5(username:app-token)`. Larafeed stores only `SHA-256(api_key)`, alongside the ordinary SHA-256 app-token hash. MD5 is used only to interoperate with the legacy Fever wire protocol; it is never used as a stored password hash.

## Supported behavior

Google Reader routes include user info, token echo, subscriptions, bounded stream item IDs, bounded item contents, and read/star tag edits.

Fever v3 routes include groups, feed-group mappings, feeds, recent or cursor-bounded items, unread IDs, saved IDs, and read/saved marks. `since_id` and `max_id` are mutually exclusive.

Both protocols use the same effective read state as the web reader:

```text
explicit sparse override
  else ingestion-ID read watermark
  else unread
```

Filtered entries are excluded. Mutations are ownership-scoped and preserve other sparse interaction fields.

## Safety and limits

- Google content requests accept at most 100 item IDs.
- Item-ID lists contain at most 10,000 IDs.
- Fever returns at most 50 item bodies per request.
- Form bodies are capped at 64 KiB and request URLs at 16 KiB.
- Compatibility responses use `Cache-Control: no-store`.
- App-token use is rate-limited and updates `last_used_at` with write throttling.
- Revoked, expired, wrong-scope, or disabled-user tokens fail authentication.
- Entry ID lists do not read article-content rows.

The implementation has focused protocol fixtures and Workerd tests for authentication, scope, revocation, ownership, sparse mutations, and response shapes.

# Google Reader and Fever APIs

Larafeed supports compatible reader clients with revocable app tokens. Passkeys and web sessions are not used for these APIs.

## Create a token

Open `/settings/app-tokens`:

1. Create a separate token for each client.
2. Select the Google Reader, Fever, or combined scope.
3. Copy the token immediately. Larafeed stores only its hash.
4. Revoke the token from the same page to stop access.

Use your exact Larafeed username and the app token as the protocol password.

## Google Reader

For a deployment at `https://reader.example.com`:

- Endpoint base: `https://reader.example.com/api/reader`
- Username: your Larafeed username
- Password: the app token

`ClientLogin` validates and returns the same token as the opaque `GoogleLogin` credential. It does not create another token.

Supported routes include user info, token echo, subscriptions, item IDs, item contents, and read or star tag edits.

## Fever

For the same deployment:

- Endpoint: `https://reader.example.com/api/fever/`
- Username: your Larafeed username
- Password: the app token

Fever clients send `api_key = MD5(username:app-token)`. Larafeed stores only `SHA-256(api_key)` and the normal SHA-256 app-token hash. MD5 is used only for the legacy Fever wire protocol.

Supported Fever v3 data includes groups, feeds, feed-group mappings, recent or cursor-bounded items, unread IDs, saved IDs, and read or saved marks. `since_id` and `max_id` cannot be used together.

## Reader state

Both protocols use the same effective state as the web reader:

```text
explicit read or unread override
  else subscription read watermark
  else unread
```

Filtered entries are excluded. Every read or saved mutation is ownership-scoped.

## Limits

- Google content requests accept at most 100 item IDs.
- Item-ID lists contain at most 10,000 IDs.
- Fever returns at most 50 item bodies per request.
- Form bodies are limited to 64 KiB.
- Request URLs are limited to 16 KiB.
- Responses use `Cache-Control: no-store`.
- Revoked, expired, wrong-scope, or disabled-user tokens fail authentication.

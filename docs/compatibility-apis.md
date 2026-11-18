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

Supported routes include user info, token echo, tag list, subscriptions, item IDs, item contents, and read or star tag edits.

`tag/list` returns the starred state tag and one `folder` tag per category. Label IDs match the category IDs in `subscription/list`, so clients can map feeds to folders:

```json
{
    "tags": [
        { "id": "user/1/state/com.google/starred" },
        { "id": "user/1/label/News", "label": "News", "type": "folder" }
    ]
}
```

Item contents carry the article HTML in both `content` and `summary`, since clients differ in which field they read.

Clients can also manage subscriptions:

- `POST subscription/quickadd` with `quickadd=<feed or site URL>` subscribes and returns `numResults`, `query`, `streamId`, and `streamName`. New subscriptions go to an `Uncategorized` folder.
- `POST subscription/edit` with `ac=subscribe`, `ac=unsubscribe`, or `ac=edit` and `s=feed/<url>` or `s=feed/<id>`. `t=<title>` sets a custom name; a title equal to the feed's own title clears it instead, so publisher renames still show. `a=user/-/label/<Folder>` files the feed in that folder, creating it when missing. A feed has exactly one folder: `r=` naming its current folder without an `a=` moves it to `Uncategorized`. Tags that are not folder labels are ignored.

Subscribing uses the same feed discovery and per-user feed-add rate limit as the web app. When a site advertises several feeds, the first is used. Subscribing to a feed you already follow creates no duplicate and no empty folder, and applies any `t=` and `a=` values. A feed URL is matched after the same normalization used when adding feeds; `unsubscribe` and `edit` return `404` for a feed you do not follow.

## Fever

For the same deployment:

- Endpoint: `https://reader.example.com/api/fever/`
- Username: your Larafeed username
- Password: the app token

Fever clients send `api_key = MD5(username:app-token)`. Larafeed stores only `SHA-256(api_key)` and the normal SHA-256 app-token hash. MD5 is used only for the legacy Fever wire protocol.

Larafeed accepts the unauthenticated `GET /api/fever/?api` discovery probe used by Reeder Classic. Authenticated Fever requests must use `POST` with `api_key` in an `application/x-www-form-urlencoded` body. Larafeed rejects `api_key` in the URL so it cannot enter request logs, browser history, or proxies.

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

- Google content requests accept at most 150 item IDs.
- Item-ID lists contain at most 10,000 IDs.
- Fever returns at most 50 item bodies per request.
- Form bodies are limited to 64 KiB.
- Request URLs are limited to 16 KiB.
- Responses use `Cache-Control: no-store`.
- Revoked, expired, wrong-scope, or disabled-user tokens fail authentication.

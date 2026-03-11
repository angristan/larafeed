-- name: FindFeedByID :one
SELECT id, name, feed_url, site_url, favicon_url, favicon_is_dark,
    favicon_updated_at, last_successful_refresh_at, last_failed_refresh_at,
    last_error_message, created_at, updated_at
FROM feeds WHERE id = $1;

-- name: FindFeedByURL :one
SELECT id, name, feed_url, site_url, favicon_url, favicon_is_dark,
    favicon_updated_at, last_successful_refresh_at, last_failed_refresh_at,
    last_error_message, created_at, updated_at
FROM feeds WHERE feed_url = $1;

-- name: CreateFeed :one
INSERT INTO feeds (name, feed_url, site_url, favicon_url, favicon_is_dark, favicon_updated_at, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
RETURNING id, name, feed_url, site_url, favicon_url, favicon_is_dark,
    favicon_updated_at, last_successful_refresh_at, last_failed_refresh_at,
    last_error_message, created_at, updated_at;

-- name: UpdateFeedRefreshSuccess :exec
UPDATE feeds SET last_successful_refresh_at = NOW(), last_error_message = NULL, updated_at = NOW()
WHERE id = $1;

-- name: UpdateFeedRefreshFailure :exec
UPDATE feeds SET last_failed_refresh_at = NOW(), last_error_message = $2, updated_at = NOW()
WHERE id = $1;

-- name: UpdateFeedFavicon :exec
UPDATE feeds SET favicon_url = $2, favicon_is_dark = $3, favicon_updated_at = NOW(), updated_at = NOW()
WHERE id = $1;

-- name: DeleteFeed :exec
DELETE FROM feeds WHERE id = $1;

-- name: CountFeedSubscribers :one
SELECT COUNT(*) FROM feed_subscriptions WHERE feed_id = $1;

-- name: FeedsMissingFavicons :many
SELECT id, name, feed_url, site_url, favicon_url, favicon_is_dark,
    favicon_updated_at, last_successful_refresh_at, last_failed_refresh_at,
    last_error_message, created_at, updated_at
FROM feeds WHERE favicon_url IS NULL;

-- name: FeedsWithOutdatedFavicons :many
SELECT id, name, feed_url, site_url, favicon_url, favicon_is_dark,
    favicon_updated_at, last_successful_refresh_at, last_failed_refresh_at,
    last_error_message, created_at, updated_at
FROM feeds
WHERE favicon_url IS NULL
    OR favicon_updated_at IS NULL
    OR favicon_updated_at < NOW() - @older_than::interval;

-- name: FeedsNeedingRefresh :many
SELECT f.id, f.name, f.feed_url, f.site_url, f.favicon_url, f.favicon_is_dark,
    f.favicon_updated_at, f.last_successful_refresh_at, f.last_failed_refresh_at,
    f.last_error_message, f.created_at, f.updated_at
FROM feeds f
JOIN feed_subscriptions fs ON fs.feed_id = f.id
WHERE f.last_successful_refresh_at IS NULL
    OR f.last_successful_refresh_at < NOW() - @stale_after::interval
GROUP BY f.id
ORDER BY
    CASE WHEN f.last_successful_refresh_at IS NULL THEN 0
    ELSE EXTRACT(EPOCH FROM NOW() - f.last_successful_refresh_at)
        / GREATEST(EXTRACT(EPOCH FROM NOW() - COALESCE(
            (SELECT MAX(e.published_at) FROM entries e WHERE e.feed_id = f.id),
            f.created_at - INTERVAL '3650 days'
        )), 1)
    END DESC
LIMIT @max_feeds;

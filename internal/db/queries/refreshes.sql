-- name: ListFeedRefreshes :many
SELECT id, feed_id, refreshed_at, was_successful, entries_created, error_message, created_at, updated_at
FROM feed_refreshes WHERE feed_id = $1
ORDER BY refreshed_at DESC LIMIT 20;

-- name: RecordRefresh :exec
INSERT INTO feed_refreshes (feed_id, refreshed_at, was_successful, entries_created, error_message, created_at, updated_at)
VALUES ($1, NOW(), $2, $3, $4, NOW(), NOW());

-- name: GetRefreshStats :one
SELECT
    COUNT(*) FILTER (WHERE fr.was_successful) AS successes,
    COUNT(*) FILTER (WHERE NOT fr.was_successful) AS failures,
    COALESCE(SUM(fr.entries_created) FILTER (WHERE fr.was_successful), 0)::bigint AS entries_created
FROM feed_refreshes fr
JOIN feed_subscriptions fs ON fr.feed_id = fs.feed_id AND fs.user_id = $1
WHERE fr.refreshed_at >= $2;

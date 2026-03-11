-- name: ListSubscriptionsForUser :many
SELECT f.id, f.name, f.feed_url, f.site_url, f.favicon_url, f.favicon_is_dark,
    f.favicon_updated_at, f.last_successful_refresh_at, f.last_failed_refresh_at,
    f.last_error_message, f.created_at, f.updated_at,
    fs.custom_feed_name, fs.category_id, sc.name as category_name, fs.filter_rules,
    COUNT(e.id)::bigint as entry_count,
    COUNT(e.id) FILTER (WHERE ei.read_at IS NULL AND ei.filtered_at IS NULL)::bigint as unread_count
FROM feeds f
JOIN feed_subscriptions fs ON f.id = fs.feed_id AND fs.user_id = $1
JOIN subscription_categories sc ON fs.category_id = sc.id
LEFT JOIN entries e ON f.id = e.feed_id
LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = $1
GROUP BY f.id, fs.custom_feed_name, fs.category_id, sc.name, fs.filter_rules
ORDER BY COALESCE(fs.custom_feed_name, f.name);

-- name: Subscribe :exec
INSERT INTO feed_subscriptions (user_id, feed_id, category_id, custom_feed_name, created_at, updated_at)
VALUES ($1, $2, $3, $4, NOW(), NOW())
ON CONFLICT (user_id, feed_id) DO NOTHING;

-- name: Unsubscribe :exec
DELETE FROM feed_subscriptions WHERE user_id = $1 AND feed_id = $2;

-- name: UpdateSubscription :exec
UPDATE feed_subscriptions
SET category_id = $3, custom_feed_name = $4, filter_rules = $5, updated_at = NOW()
WHERE user_id = $1 AND feed_id = $2;

-- name: GetSubscription :one
SELECT user_id, feed_id, category_id, custom_feed_name, filter_rules, created_at, updated_at
FROM feed_subscriptions WHERE user_id = $1 AND feed_id = $2;

-- name: SubscriptionsWithFilters :many
SELECT user_id, feed_id, category_id, custom_feed_name, filter_rules, created_at, updated_at
FROM feed_subscriptions WHERE feed_id = $1 AND filter_rules IS NOT NULL;

-- name: DeleteAllSubscriptionsForUser :exec
DELETE FROM feed_subscriptions WHERE user_id = $1;

-- name: ListFeedIDsForUser :many
SELECT feed_id FROM feed_subscriptions WHERE user_id = $1;

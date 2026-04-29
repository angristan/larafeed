-- name: MarkAsRead :execrows
INSERT INTO entry_interactions (user_id, entry_id, read_at, created_at, updated_at)
SELECT @user_id, e.id, NOW(), NOW(), NOW()
FROM entries e
JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = @user_id
WHERE e.id = @entry_id
ON CONFLICT (user_id, entry_id) DO UPDATE SET read_at = NOW(), updated_at = NOW();

-- name: MarkAsUnread :execrows
INSERT INTO entry_interactions (user_id, entry_id, read_at, created_at, updated_at)
SELECT @user_id, e.id, NULL, NOW(), NOW()
FROM entries e
JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = @user_id
WHERE e.id = @entry_id
ON CONFLICT (user_id, entry_id) DO UPDATE SET read_at = NULL, updated_at = NOW();

-- name: Favorite :execrows
INSERT INTO entry_interactions (user_id, entry_id, starred_at, created_at, updated_at)
SELECT @user_id, e.id, NOW(), NOW(), NOW()
FROM entries e
JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = @user_id
WHERE e.id = @entry_id
ON CONFLICT (user_id, entry_id) DO UPDATE SET starred_at = NOW(), updated_at = NOW();

-- name: Unfavorite :execrows
INSERT INTO entry_interactions (user_id, entry_id, starred_at, created_at, updated_at)
SELECT @user_id, e.id, NULL, NOW(), NOW()
FROM entries e
JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = @user_id
WHERE e.id = @entry_id
ON CONFLICT (user_id, entry_id) DO UPDATE SET starred_at = NULL, updated_at = NOW();

-- name: Archive :execrows
INSERT INTO entry_interactions (user_id, entry_id, archived_at, created_at, updated_at)
SELECT @user_id, e.id, NOW(), NOW(), NOW()
FROM entries e
JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = @user_id
WHERE e.id = @entry_id
ON CONFLICT (user_id, entry_id) DO UPDATE SET archived_at = NOW(), updated_at = NOW();

-- name: Unarchive :execrows
INSERT INTO entry_interactions (user_id, entry_id, archived_at, created_at, updated_at)
SELECT @user_id, e.id, NULL, NOW(), NOW()
FROM entries e
JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = @user_id
WHERE e.id = @entry_id
ON CONFLICT (user_id, entry_id) DO UPDATE SET archived_at = NULL, updated_at = NOW();

-- name: MarkFiltered :exec
INSERT INTO entry_interactions (user_id, entry_id, filtered_at, created_at, updated_at)
SELECT @user_id, e.id, NOW(), NOW(), NOW()
FROM entries e
JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = @user_id
WHERE e.id = @entry_id
ON CONFLICT (user_id, entry_id) DO UPDATE SET
    filtered_at = NOW(),
    read_at = NULL,
    starred_at = NULL,
    archived_at = NULL,
    updated_at = NOW();

-- name: ClearFiltered :exec
INSERT INTO entry_interactions (user_id, entry_id, filtered_at, created_at, updated_at)
SELECT @user_id, e.id, NULL, NOW(), NOW()
FROM entries e
JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = @user_id
WHERE e.id = @entry_id
ON CONFLICT (user_id, entry_id) DO UPDATE SET filtered_at = NULL, updated_at = NOW();

-- name: MarkAllAsReadExisting :exec
UPDATE entry_interactions AS ei SET read_at = NOW(), updated_at = NOW()
WHERE ei.user_id = $1 AND ei.entry_id IN (
    SELECT e.id
    FROM entries e
    JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = $1
    WHERE e.feed_id = $2
) AND ei.read_at IS NULL;

-- name: MarkAllAsReadNew :exec
INSERT INTO entry_interactions (user_id, entry_id, read_at, created_at, updated_at)
SELECT $1, e.id, NOW(), NOW(), NOW()
FROM entries e
JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = $1
WHERE e.feed_id = $2
    AND NOT EXISTS (
        SELECT 1 FROM entry_interactions ei WHERE ei.user_id = $1 AND ei.entry_id = e.id
    );

-- name: DeleteAllInteractionsForUser :exec
DELETE FROM entry_interactions WHERE user_id = $1;

-- name: DeleteInteractionsForFeed :exec
DELETE FROM entry_interactions
WHERE user_id = $1 AND entry_id IN (
    SELECT id FROM entries WHERE feed_id = $2
);

-- name: UnreadIDs :many
SELECT e.id FROM entries e
JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = $1
LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = $1
WHERE ei.read_at IS NULL AND (ei.filtered_at IS NULL);

-- name: StarredIDs :many
SELECT ei.entry_id FROM entry_interactions ei
JOIN feed_subscriptions fs ON ei.entry_id IN (
    SELECT id FROM entries WHERE feed_id = fs.feed_id
) AND fs.user_id = $1
WHERE ei.user_id = $1 AND ei.starred_at IS NOT NULL;

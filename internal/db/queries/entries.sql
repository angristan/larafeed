-- name: FindEntryByID :one
SELECT id, feed_id, title, url, author, content, published_at, created_at, updated_at
FROM entries WHERE id = $1;

-- name: FindReaderEntry :one
SELECT e.id, e.feed_id, e.title, e.url, e.author, e.content, e.published_at,
    ei.read_at, ei.starred_at, ei.archived_at, ei.filtered_at,
    f.name AS feed_name, fs.custom_feed_name, f.favicon_url, f.favicon_is_dark
FROM entries e
JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = @user_id
JOIN feeds f ON e.feed_id = f.id
LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = @user_id
WHERE e.id = @entry_id;

-- name: CountForReader :one
SELECT COUNT(*)
FROM entries e
JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = @user_id
LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = @user_id
WHERE (ei.filtered_at IS NULL)
    AND (sqlc.narg(feed_id)::bigint IS NULL OR e.feed_id = sqlc.narg(feed_id))
    AND (sqlc.narg(category_id)::bigint IS NULL OR fs.category_id = sqlc.narg(category_id))
    AND (
        CASE sqlc.arg(filter)::text
            WHEN 'unread' THEN ei.read_at IS NULL
            WHEN 'read' THEN ei.read_at IS NOT NULL
            WHEN 'favorites' THEN ei.starred_at IS NOT NULL
            ELSE TRUE
        END
    );

-- name: ListForReaderByPublished :many
SELECT e.id, e.feed_id, e.title, e.url, e.author, e.content, e.published_at,
    ei.read_at, ei.starred_at, ei.archived_at, ei.filtered_at,
    f.name AS feed_name, fs.custom_feed_name, f.favicon_url, f.favicon_is_dark
FROM entries e
JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = @user_id
JOIN feeds f ON e.feed_id = f.id
LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = @user_id
WHERE (ei.filtered_at IS NULL)
    AND (sqlc.narg(feed_id)::bigint IS NULL OR e.feed_id = sqlc.narg(feed_id))
    AND (sqlc.narg(category_id)::bigint IS NULL OR fs.category_id = sqlc.narg(category_id))
    AND (
        CASE sqlc.arg(filter)::text
            WHEN 'unread' THEN ei.read_at IS NULL
            WHEN 'read' THEN ei.read_at IS NOT NULL
            WHEN 'favorites' THEN ei.starred_at IS NOT NULL
            ELSE TRUE
        END
    )
ORDER BY e.published_at DESC
LIMIT @page_size OFFSET @page_offset;

-- name: ListForReaderByCreated :many
SELECT e.id, e.feed_id, e.title, e.url, e.author, e.content, e.published_at,
    ei.read_at, ei.starred_at, ei.archived_at, ei.filtered_at,
    f.name AS feed_name, fs.custom_feed_name, f.favicon_url, f.favicon_is_dark
FROM entries e
JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = @user_id
JOIN feeds f ON e.feed_id = f.id
LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = @user_id
WHERE (ei.filtered_at IS NULL)
    AND (sqlc.narg(feed_id)::bigint IS NULL OR e.feed_id = sqlc.narg(feed_id))
    AND (sqlc.narg(category_id)::bigint IS NULL OR fs.category_id = sqlc.narg(category_id))
    AND (
        CASE sqlc.arg(filter)::text
            WHEN 'unread' THEN ei.read_at IS NULL
            WHEN 'read' THEN ei.read_at IS NOT NULL
            WHEN 'favorites' THEN ei.starred_at IS NOT NULL
            ELSE TRUE
        END
    )
ORDER BY e.created_at DESC
LIMIT @page_size OFFSET @page_offset;

-- name: CountUnread :one
SELECT COUNT(*)
FROM entries e
JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = @user_id
LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = @user_id
WHERE (ei.filtered_at IS NULL) AND (ei.read_at IS NULL);

-- name: CountRead :one
SELECT COUNT(*)
FROM entries e
JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = @user_id
LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = @user_id
WHERE (ei.filtered_at IS NULL) AND (ei.read_at IS NOT NULL);

-- name: EntriesForFeed :many
SELECT id, feed_id, title, url, author, content, published_at, created_at, updated_at
FROM entries WHERE feed_id = $1;

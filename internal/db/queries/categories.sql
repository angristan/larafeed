-- name: ListCategoriesForUser :many
SELECT id, user_id, name, created_at, updated_at
FROM subscription_categories WHERE user_id = $1 ORDER BY name;

-- name: FindCategoryByID :one
SELECT id, user_id, name, created_at, updated_at
FROM subscription_categories WHERE id = $1;

-- name: FindOrCreateCategory :one
INSERT INTO subscription_categories (user_id, name, created_at, updated_at)
VALUES ($1, $2, NOW(), NOW())
ON CONFLICT (user_id, name) DO UPDATE SET updated_at = NOW()
RETURNING id, user_id, name, created_at, updated_at;

-- name: CreateCategory :one
INSERT INTO subscription_categories (user_id, name, created_at, updated_at)
VALUES ($1, $2, NOW(), NOW())
RETURNING id, user_id, name, created_at, updated_at;

-- name: DeleteCategory :exec
DELETE FROM subscription_categories WHERE id = $1;

-- name: CategoryHasSubscriptions :one
SELECT COUNT(*) FROM feed_subscriptions WHERE category_id = $1;

-- name: DeleteAllCategoriesForUser :exec
DELETE FROM subscription_categories WHERE user_id = $1;

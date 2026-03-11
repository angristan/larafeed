-- name: CreatePersonalAccessToken :exec
INSERT INTO personal_access_tokens (tokenable_type, tokenable_id, name, token, abilities, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW());

-- name: FindPersonalAccessToken :one
SELECT id, tokenable_type, tokenable_id, name, token, abilities,
    last_used_at, expires_at, created_at, updated_at
FROM personal_access_tokens WHERE token = $1;

-- name: TouchTokenLastUsed :exec
UPDATE personal_access_tokens SET last_used_at = NOW() WHERE id = $1;

-- name: DeleteUserTokens :exec
DELETE FROM personal_access_tokens
WHERE tokenable_type = $1 AND tokenable_id = $2;

-- name: CreatePasswordReset :exec
INSERT INTO password_reset_tokens (email, token, created_at)
VALUES ($1, $2, NOW())
ON CONFLICT (email) DO UPDATE SET token = $2, created_at = NOW();

-- name: FindPasswordReset :one
SELECT email, token, created_at FROM password_reset_tokens WHERE email = $1;

-- name: DeletePasswordReset :exec
DELETE FROM password_reset_tokens WHERE email = $1;

-- name: CacheGet :one
SELECT value, expiration FROM cache WHERE key = $1;

-- name: CacheSet :exec
INSERT INTO cache (key, value, expiration) VALUES ($1, $2, $3)
ON CONFLICT (key) DO UPDATE SET value = $2, expiration = $3;

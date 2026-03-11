-- name: FindUserByID :one
SELECT id, name, email, email_verified_at, password, remember_token,
    fever_api_key, two_factor_secret, two_factor_recovery_codes,
    two_factor_confirmed_at, created_at, updated_at
FROM users WHERE id = $1;

-- name: FindUserByEmail :one
SELECT id, name, email, email_verified_at, password, remember_token,
    fever_api_key, two_factor_secret, two_factor_recovery_codes,
    two_factor_confirmed_at, created_at, updated_at
FROM users WHERE email = $1;

-- name: FindUserByFeverApiKey :one
SELECT id, name, email, email_verified_at, password, remember_token,
    fever_api_key, two_factor_secret, two_factor_recovery_codes,
    two_factor_confirmed_at, created_at, updated_at
FROM users WHERE fever_api_key = $1;

-- name: CreateUser :one
INSERT INTO users (name, email, password, fever_api_key, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $5)
RETURNING id, name, email, email_verified_at, password, remember_token,
    fever_api_key, two_factor_secret, two_factor_recovery_codes,
    two_factor_confirmed_at, created_at, updated_at;

-- name: UpdateUserProfile :exec
UPDATE users SET name = $2, email = $3, updated_at = NOW()
WHERE id = $1;

-- name: UpdateUserPassword :exec
UPDATE users SET password = $2, updated_at = NOW()
WHERE id = $1;

-- name: UpdateUserPasswordAndFeverKey :exec
UPDATE users SET password = $2, fever_api_key = $3, remember_token = $4, updated_at = NOW()
WHERE id = $1;

-- name: VerifyUserEmail :exec
UPDATE users SET email_verified_at = NOW(), updated_at = NOW()
WHERE id = $1;

-- name: ClearUserEmailVerification :exec
UPDATE users SET email_verified_at = NULL, updated_at = NOW()
WHERE id = $1;

-- name: UpdateUserTwoFactor :exec
UPDATE users SET two_factor_secret = $2, two_factor_recovery_codes = $3,
    two_factor_confirmed_at = $4, updated_at = NOW()
WHERE id = $1;

-- name: DeleteUser :exec
DELETE FROM users WHERE id = $1;

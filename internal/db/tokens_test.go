package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCacheSetAndGet(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	expiration := int(time.Now().Add(time.Hour).Unix())
	err := q.CacheSet(ctx, db.CacheSetParams{
		Key:        "test_key",
		Value:      "test_value",
		Expiration: expiration,
	})
	require.NoError(t, err)

	row, err := q.CacheGet(ctx, "test_key")
	require.NoError(t, err)

	assert.Equal(t, "test_value", row.Value)
	assert.Equal(t, expiration, row.Expiration)
}

func TestCacheSet_Upsert(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	exp := int(time.Now().Add(time.Hour).Unix())
	err := q.CacheSet(ctx, db.CacheSetParams{Key: "upsert_key", Value: "first", Expiration: exp})
	require.NoError(t, err)

	err = q.CacheSet(ctx, db.CacheSetParams{Key: "upsert_key", Value: "second", Expiration: exp})
	require.NoError(t, err)

	row, err := q.CacheGet(ctx, "upsert_key")
	require.NoError(t, err)
	assert.Equal(t, "second", row.Value)
}

func TestCacheGet_NotFound(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	_, err := q.CacheGet(ctx, "nonexistent_key")
	assert.Error(t, err)
}

func TestCreatePasswordReset(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	user := createUser(t, pool, "reset user", "reset@example.com", "password123")

	err := q.CreatePasswordReset(ctx, db.CreatePasswordResetParams{
		Email: user.Email,
		Token: "reset-token-123",
	})
	require.NoError(t, err)

	found, err := q.FindPasswordReset(ctx, user.Email)
	require.NoError(t, err)

	assert.Equal(t, user.Email, found.Email)
	assert.Equal(t, "reset-token-123", found.Token)
	assert.NotNil(t, found.CreatedAt)
}

func TestCreatePasswordReset_Upsert(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	user := createUser(t, pool, "upsert reset", "upsertreset@example.com", "password123")

	err := q.CreatePasswordReset(ctx, db.CreatePasswordResetParams{
		Email: user.Email,
		Token: "first-token",
	})
	require.NoError(t, err)

	err = q.CreatePasswordReset(ctx, db.CreatePasswordResetParams{
		Email: user.Email,
		Token: "second-token",
	})
	require.NoError(t, err)

	found, err := q.FindPasswordReset(ctx, user.Email)
	require.NoError(t, err)
	assert.Equal(t, "second-token", found.Token)
}

func TestDeletePasswordReset(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	user := createUser(t, pool, "delete reset", "delreset@example.com", "password123")

	err := q.CreatePasswordReset(ctx, db.CreatePasswordResetParams{
		Email: user.Email,
		Token: "delete-me-token",
	})
	require.NoError(t, err)

	err = q.DeletePasswordReset(ctx, user.Email)
	require.NoError(t, err)

	_, err = q.FindPasswordReset(ctx, user.Email)
	assert.Error(t, err)
}

func TestCreatePersonalAccessToken(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	user := createUser(t, pool, "token user", "tokenuser@example.com", "password123")

	hashedToken := db.HashToken("plain-token")
	err := q.CreatePersonalAccessToken(ctx, db.CreatePersonalAccessTokenParams{
		TokenableType: "App\\Models\\User",
		TokenableID:   user.ID,
		Name:          "test-token",
		Token:         hashedToken,
		Abilities:     nil,
	})
	require.NoError(t, err)

	found, err := q.FindPersonalAccessToken(ctx, db.HashToken("plain-token"))
	require.NoError(t, err)

	assert.Equal(t, user.ID, found.TokenableID)
	assert.Equal(t, "App\\Models\\User", found.TokenableType)
	assert.Equal(t, "test-token", found.Name)
	assert.Equal(t, hashedToken, found.Token)
	assert.Nil(t, found.Abilities)
	assert.NotNil(t, found.CreatedAt)
	assert.NotNil(t, found.UpdatedAt)
}

func TestDeleteUserTokens(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	user := createUser(t, pool, "del tokens", "deltokens@example.com", "password123")

	err := q.CreatePersonalAccessToken(ctx, db.CreatePersonalAccessTokenParams{
		TokenableType: "App\\Models\\User",
		TokenableID:   user.ID,
		Name:          "token-1",
		Token:         db.HashToken("token-1"),
		Abilities:     nil,
	})
	require.NoError(t, err)

	err = q.CreatePersonalAccessToken(ctx, db.CreatePersonalAccessTokenParams{
		TokenableType: "App\\Models\\User",
		TokenableID:   user.ID,
		Name:          "token-2",
		Token:         db.HashToken("token-2"),
		Abilities:     nil,
	})
	require.NoError(t, err)

	err = q.DeleteUserTokens(ctx, db.DeleteUserTokensParams{
		TokenableType: "App\\Models\\User",
		TokenableID:   user.ID,
	})
	require.NoError(t, err)

	_, err = q.FindPersonalAccessToken(ctx, db.HashToken("token-1"))
	assert.Error(t, err)

	_, err = q.FindPersonalAccessToken(ctx, db.HashToken("token-2"))
	assert.Error(t, err)
}

func TestTouchTokenLastUsed(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	user := createUser(t, pool, "touch user", "touch@example.com", "password123")

	hashedToken := db.HashToken("touch-token")
	err := q.CreatePersonalAccessToken(ctx, db.CreatePersonalAccessTokenParams{
		TokenableType: "App\\Models\\User",
		TokenableID:   user.ID,
		Name:          "touch-test",
		Token:         hashedToken,
		Abilities:     nil,
	})
	require.NoError(t, err)

	token, err := q.FindPersonalAccessToken(ctx, hashedToken)
	require.NoError(t, err)
	assert.Nil(t, token.LastUsedAt)

	err = q.TouchTokenLastUsed(ctx, token.ID)
	require.NoError(t, err)

	updated, err := q.FindPersonalAccessToken(ctx, hashedToken)
	require.NoError(t, err)
	assert.NotNil(t, updated.LastUsedAt)
}

func TestGeneratePlainToken(t *testing.T) {
	token := db.GeneratePlainToken(32)

	assert.Len(t, token, 32)
	// Token should be hex-encoded (only hex characters)
	for _, c := range token {
		assert.True(t, (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'),
			"expected hex character, got %c", c)
	}
}

func TestHashToken(t *testing.T) {
	// Deterministic: same input produces same output
	hash1 := db.HashToken("same-input")
	hash2 := db.HashToken("same-input")
	assert.Equal(t, hash1, hash2)

	// Different input produces different output
	hash3 := db.HashToken("different-input")
	assert.NotEqual(t, hash1, hash3)
}

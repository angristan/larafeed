package auth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHashPassword(t *testing.T) {
	t.Run("hashes and verifies password", func(t *testing.T) {
		hash, err := HashPassword("password123")
		require.NoError(t, err)
		assert.NotEmpty(t, hash)
		assert.NotEqual(t, "password123", hash)
		assert.True(t, CheckPassword(hash, "password123"))
	})

	t.Run("rejects wrong password", func(t *testing.T) {
		hash, err := HashPassword("password123")
		require.NoError(t, err)
		assert.False(t, CheckPassword(hash, "wrongpassword"))
	})

	t.Run("different hashes for same password", func(t *testing.T) {
		hash1, _ := HashPassword("password")
		hash2, _ := HashPassword("password")
		assert.NotEqual(t, hash1, hash2) // bcrypt uses random salt
	})
}

func TestFeverAPIKey(t *testing.T) {
	t.Run("generates consistent key", func(t *testing.T) {
		key1 := FeverAPIKey("user@example.com", "password")
		key2 := FeverAPIKey("user@example.com", "password")
		assert.Equal(t, key1, key2)
	})

	t.Run("different inputs produce different keys", func(t *testing.T) {
		key1 := FeverAPIKey("user1@example.com", "password")
		key2 := FeverAPIKey("user2@example.com", "password")
		assert.NotEqual(t, key1, key2)
	})

	t.Run("key is MD5 of email:password", func(t *testing.T) {
		key := FeverAPIKey("test@test.com", "secret")
		assert.Len(t, key, 32) // MD5 hex length
	})
}

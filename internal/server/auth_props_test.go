package server

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAuthProp_NilUser(t *testing.T) {
	prop := authProp(nil)
	assert.Nil(t, prop["user"])
}

func TestAuthProp_DoesNotLeakSensitiveFields(t *testing.T) {
	secret := "super-secret"
	now := time.Now()
	user := &db.User{
		ID:                     1,
		Name:                   "Alice",
		Email:                  "alice@test.com",
		EmailVerifiedAt:        &now,
		Password:               "hashed-password",
		RememberToken:          &secret,
		FeverAPIKey:            &secret,
		TwoFactorSecret:        &secret,
		TwoFactorRecoveryCodes: &secret,
		TwoFactorConfirmedAt:   &now,
	}

	prop := authProp(user)
	data, err := json.Marshal(prop)
	require.NoError(t, err)

	raw := string(data)

	// Sensitive values must not appear
	assert.NotContains(t, raw, "hashed-password")
	assert.NotContains(t, raw, "super-secret")

	// Sensitive keys must not appear
	assert.NotContains(t, raw, "password")
	assert.NotContains(t, raw, "remember_token")
	assert.NotContains(t, raw, "fever_api_key")
	assert.NotContains(t, raw, "two_factor_secret")
	assert.NotContains(t, raw, "two_factor_recovery_codes")

	// Safe fields must be present
	assert.Contains(t, raw, "Alice")
	assert.Contains(t, raw, "alice@test.com")
}

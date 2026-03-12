package handler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- validateRequest tests ---

func TestValidateRequest_Required(t *testing.T) {
	type req struct {
		Name string `json:"name" validate:"required"`
	}

	errs := validateRequest(req{Name: ""})
	require.NotNil(t, errs)
	assert.Equal(t, "The name field is required.", errs["name"])

	errs = validateRequest(req{Name: "Alice"})
	assert.Nil(t, errs)
}

func TestValidateRequest_Min(t *testing.T) {
	type req struct {
		Password string `json:"password" validate:"required,min=8"`
	}

	errs := validateRequest(req{Password: "short"})
	require.NotNil(t, errs)
	assert.Equal(t, "The password must be at least 8 characters.", errs["password"])

	errs = validateRequest(req{Password: "longenough"})
	assert.Nil(t, errs)
}

func TestValidateRequest_Max(t *testing.T) {
	type req struct {
		CategoryName string `json:"categoryName" validate:"required,max=20" label:"category name"`
	}

	errs := validateRequest(req{CategoryName: "a very long category name!"})
	require.NotNil(t, errs)
	assert.Equal(t, "The category name must not exceed 20 characters.", errs["categoryName"])

	errs = validateRequest(req{CategoryName: "short"})
	assert.Nil(t, errs)
}

func TestValidateRequest_Eqfield(t *testing.T) {
	type req struct {
		Password             string `json:"password" validate:"required,min=8,eqfield=PasswordConfirmation"`
		PasswordConfirmation string `json:"password_confirmation"`
	}

	errs := validateRequest(req{Password: "secret123", PasswordConfirmation: "different1"})
	require.NotNil(t, errs)
	assert.Equal(t, "The password confirmation does not match.", errs["password"])

	errs = validateRequest(req{Password: "secret123", PasswordConfirmation: "secret123"})
	assert.Nil(t, errs)
}

func TestValidateRequest_MultipleFields(t *testing.T) {
	type req struct {
		Name     string `json:"name" validate:"required"`
		Email    string `json:"email" validate:"required"`
		Password string `json:"password" validate:"required,min=8"`
	}

	errs := validateRequest(req{})
	require.NotNil(t, errs)
	assert.Len(t, errs, 3)
	assert.Equal(t, "The name field is required.", errs["name"])
	assert.Equal(t, "The email field is required.", errs["email"])
	assert.Equal(t, "The password field is required.", errs["password"])
}

func TestValidateRequest_FirstErrorPerField(t *testing.T) {
	type req struct {
		Password string `json:"password" validate:"required,min=8"`
	}

	// Empty password: "required" fires first, not "min"
	errs := validateRequest(req{Password: ""})
	require.NotNil(t, errs)
	assert.Equal(t, "The password field is required.", errs["password"])
}

func TestValidateRequest_CustomLabel(t *testing.T) {
	type req struct {
		FeedURL string `json:"feed_url" validate:"required" label:"feed URL"`
	}

	errs := validateRequest(req{FeedURL: ""})
	require.NotNil(t, errs)
	assert.Equal(t, "The feed URL field is required.", errs["feed_url"])
}

func TestValidateRequest_DefaultLabelUnderscoreToSpace(t *testing.T) {
	type req struct {
		FeedURL string `json:"feed_url" validate:"required"`
	}

	errs := validateRequest(req{FeedURL: ""})
	require.NotNil(t, errs)
	assert.Equal(t, "The feed url field is required.", errs["feed_url"])
}

func TestValidateRequest_AllValid(t *testing.T) {
	type req struct {
		Name                 string `json:"name" validate:"required"`
		Email                string `json:"email" validate:"required"`
		Password             string `json:"password" validate:"required,min=8,eqfield=PasswordConfirmation"`
		PasswordConfirmation string `json:"password_confirmation"`
	}

	errs := validateRequest(req{
		Name:                 "Alice",
		Email:                "alice@example.com",
		Password:             "secret123",
		PasswordConfirmation: "secret123",
	})
	assert.Nil(t, errs)
}

// --- validationErrs tests ---

func TestValidationErrs_Add(t *testing.T) {
	v := newValidationErrs()
	v.Add("email", "The email has already been taken.")

	assert.True(t, v.HasErrors())
	assert.Equal(t, "The email has already been taken.", v.Map()["email"])
}

func TestValidationErrs_DoesNotOverwrite(t *testing.T) {
	v := newValidationErrs()
	v.Add("email", "first error")
	v.Add("email", "second error")

	assert.Equal(t, "first error", v.Map()["email"])
}

func TestValidationErrs_NoErrors(t *testing.T) {
	v := newValidationErrs()
	assert.False(t, v.HasErrors())
	assert.Nil(t, v.Map())
}

func TestValidationErrs_MultipleFields(t *testing.T) {
	v := newValidationErrs()
	v.Add("email", "taken")
	v.Add("password", "wrong")

	assert.Len(t, v.Map(), 2)
}

package apperr_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/angristan/larafeed-go/internal/apperr"
	"github.com/stretchr/testify/assert"
)

func TestNotFoundError(t *testing.T) {
	err := apperr.NewNotFound("category")
	assert.Equal(t, "category not found", err.Error())

	err = apperr.NewNotFound("")
	assert.Equal(t, "not found", err.Error())

	// errors.As through wrapping
	wrapped := fmt.Errorf("something failed: %w", apperr.NewNotFound("feed"))
	var target *apperr.NotFoundError
	assert.True(t, errors.As(wrapped, &target))
	assert.Equal(t, "feed", target.Resource)
}

func TestValidationError(t *testing.T) {
	err := apperr.NewValidation("email", "the email has already been taken")
	assert.Equal(t, "the email has already been taken", err.Error())
	assert.Equal(t, "email", err.Field)

	// errors.As through wrapping
	wrapped := fmt.Errorf("update profile: %w", err)
	var target *apperr.ValidationError
	assert.True(t, errors.As(wrapped, &target))
	assert.Equal(t, "email", target.Field)
}

func TestConflictError(t *testing.T) {
	err := apperr.NewConflict("category", "a category with this name already exists")
	assert.Equal(t, "a category with this name already exists", err.Error())

	err = apperr.NewConflict("feed", "")
	assert.Equal(t, "feed already exists", err.Error())

	// errors.As through wrapping
	wrapped := fmt.Errorf("create: %w", apperr.NewConflict("category", "duplicate"))
	var target *apperr.ConflictError
	assert.True(t, errors.As(wrapped, &target))
	assert.Equal(t, "category", target.Resource)
}

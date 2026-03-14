package service

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/angristan/larafeed-go/internal/apperr"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestUpdateProfile_SameEmail(t *testing.T) {
	q := &mockQuerier{}
	q.On("UpdateUserProfile", mock.Anything, db.UpdateUserProfileParams{
		ID: 1, Name: "Alice Updated", Email: "alice@test.com",
	}).Return(nil)

	svc := NewUserService(q, nil)
	err := svc.UpdateProfile(context.Background(), 1, "alice@test.com", "Alice Updated", "alice@test.com")

	require.NoError(t, err)
	q.AssertNotCalled(t, "FindUserByEmail", mock.Anything, mock.Anything)
	q.AssertNotCalled(t, "ClearUserEmailVerification", mock.Anything, mock.Anything)
}

func TestUpdateProfile_EmailChanged(t *testing.T) {
	q := &mockQuerier{}
	q.On("FindUserByEmail", mock.Anything, "new@test.com").
		Return(db.User{}, fmt.Errorf("no rows"))
	q.On("UpdateUserProfile", mock.Anything, db.UpdateUserProfileParams{
		ID: 1, Name: "Alice", Email: "new@test.com",
	}).Return(nil)
	q.On("ClearUserEmailVerification", mock.Anything, int64(1)).Return(nil)

	svc := NewUserService(q, nil)
	err := svc.UpdateProfile(context.Background(), 1, "alice@test.com", "Alice", "new@test.com")

	require.NoError(t, err)
	q.AssertCalled(t, "ClearUserEmailVerification", mock.Anything, int64(1))
}

func TestUpdateProfile_EmailTaken(t *testing.T) {
	q := &mockQuerier{}
	q.On("FindUserByEmail", mock.Anything, "taken@test.com").
		Return(db.User{ID: 2}, nil) // exists

	svc := NewUserService(q, nil)
	err := svc.UpdateProfile(context.Background(), 1, "alice@test.com", "Alice", "taken@test.com")

	assert.Error(t, err)
	var validErr *apperr.ValidationError
	assert.True(t, errors.As(err, &validErr))
	assert.Equal(t, "email", validErr.Field)
	q.AssertNotCalled(t, "UpdateUserProfile", mock.Anything, mock.Anything)
}

func TestDeleteAccount(t *testing.T) {
	q := &mockQuerier{}
	q.On("DeleteUser", mock.Anything, int64(1)).Return(nil)

	svc := NewUserService(q, nil)
	err := svc.DeleteAccount(context.Background(), 1)

	require.NoError(t, err)
	q.AssertExpectations(t)
}

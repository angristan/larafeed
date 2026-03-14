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

func TestCategoryCreate(t *testing.T) {
	q := &mockQuerier{}
	q.On("CreateCategory", mock.Anything, db.CreateCategoryParams{UserID: 1, Name: "Tech"}).
		Return(db.SubscriptionCategory{ID: 5, Name: "Tech"}, nil)

	svc := NewCategoryService(q)
	cat, err := svc.Create(context.Background(), 1, "Tech")

	require.NoError(t, err)
	assert.Equal(t, int64(5), cat.ID)
	assert.Equal(t, "Tech", cat.Name)
	q.AssertExpectations(t)
}

func TestCategoryDelete_Success(t *testing.T) {
	q := &mockQuerier{}
	q.On("FindCategoryByID", mock.Anything, int64(5)).
		Return(db.SubscriptionCategory{ID: 5, UserID: 1}, nil)
	q.On("CategoryHasSubscriptions", mock.Anything, int64(5)).Return(int64(0), nil)
	q.On("DeleteCategory", mock.Anything, int64(5)).Return(nil)

	svc := NewCategoryService(q)
	err := svc.Delete(context.Background(), 1, 5)

	require.NoError(t, err)
	q.AssertExpectations(t)
}

func TestCategoryDelete_NotOwned(t *testing.T) {
	q := &mockQuerier{}
	q.On("FindCategoryByID", mock.Anything, int64(5)).
		Return(db.SubscriptionCategory{ID: 5, UserID: 999}, nil) // different user

	svc := NewCategoryService(q)
	err := svc.Delete(context.Background(), 1, 5)

	assert.Error(t, err)
	var notFound *apperr.NotFoundError
	assert.True(t, errors.As(err, &notFound))
	assert.Equal(t, "category", notFound.Resource)
}

func TestCategoryDelete_NotFound(t *testing.T) {
	q := &mockQuerier{}
	q.On("FindCategoryByID", mock.Anything, int64(5)).
		Return(db.SubscriptionCategory{}, fmt.Errorf("no rows"))

	svc := NewCategoryService(q)
	err := svc.Delete(context.Background(), 1, 5)

	assert.Error(t, err)
	var notFound *apperr.NotFoundError
	assert.True(t, errors.As(err, &notFound))
}

func TestCategoryCreate_Conflict(t *testing.T) {
	q := &mockQuerier{}
	q.On("CreateCategory", mock.Anything, db.CreateCategoryParams{UserID: 1, Name: "Tech"}).
		Return(db.SubscriptionCategory{}, fmt.Errorf("unique constraint violation"))

	svc := NewCategoryService(q)
	_, err := svc.Create(context.Background(), 1, "Tech")

	assert.Error(t, err)
	var conflict *apperr.ConflictError
	assert.True(t, errors.As(err, &conflict))
	assert.Equal(t, "category", conflict.Resource)
}

func TestCategoryDelete_HasSubscriptions(t *testing.T) {
	q := &mockQuerier{}
	q.On("FindCategoryByID", mock.Anything, int64(5)).
		Return(db.SubscriptionCategory{ID: 5, UserID: 1}, nil)
	q.On("CategoryHasSubscriptions", mock.Anything, int64(5)).Return(int64(3), nil)

	svc := NewCategoryService(q)
	err := svc.Delete(context.Background(), 1, 5)

	assert.Error(t, err)
	var validErr *apperr.ValidationError
	assert.True(t, errors.As(err, &validErr))
	assert.Equal(t, "category", validErr.Field)
	q.AssertNotCalled(t, "DeleteCategory", mock.Anything, mock.Anything)
}

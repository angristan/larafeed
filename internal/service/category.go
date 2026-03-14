package service

import (
	"context"

	"github.com/angristan/larafeed-go/internal/apperr"
	"github.com/angristan/larafeed-go/internal/db"
)

type CategoryService struct {
	q db.Querier
}

func NewCategoryService(q db.Querier) *CategoryService {
	return &CategoryService{q: q}
}

// Create creates a new subscription category for the user.
func (s *CategoryService) Create(ctx context.Context, userID int64, name string) (db.SubscriptionCategory, error) {
	cat, err := s.q.CreateCategory(ctx, db.CreateCategoryParams{UserID: userID, Name: name})
	if err != nil {
		return cat, apperr.NewConflict("category", "A category with this name already exists.")
	}
	return cat, nil
}

// Delete deletes a category after verifying ownership and that it has no subscriptions.
func (s *CategoryService) Delete(ctx context.Context, userID int64, categoryID int64) error {
	cat, err := s.q.FindCategoryByID(ctx, categoryID)
	if err != nil || cat.UserID != userID {
		return apperr.NewNotFound("category")
	}

	count, err := s.q.CategoryHasSubscriptions(ctx, categoryID)
	if err != nil {
		return err
	}
	if count > 0 {
		return apperr.NewValidation("category", "Cannot delete a category that has feed subscriptions.")
	}

	return s.q.DeleteCategory(ctx, categoryID)
}

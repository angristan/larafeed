package service

import (
	"context"
	"fmt"

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
	return s.q.CreateCategory(ctx, db.CreateCategoryParams{UserID: userID, Name: name})
}

// Delete deletes a category after verifying ownership and that it has no subscriptions.
func (s *CategoryService) Delete(ctx context.Context, userID int64, categoryID int64) error {
	cat, err := s.q.FindCategoryByID(ctx, categoryID)
	if err != nil || cat.UserID != userID {
		return fmt.Errorf("category not found")
	}

	count, err := s.q.CategoryHasSubscriptions(ctx, categoryID)
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("cannot delete a category that has feed subscriptions")
	}

	return s.q.DeleteCategory(ctx, categoryID)
}

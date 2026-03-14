package api

import (
	"context"

	"github.com/angristan/larafeed-go/internal/db"
)

// readerService provides read-only access to reader data for API handlers.
type readerService interface {
	ListCategories(ctx context.Context, userID int64) ([]db.SubscriptionCategory, error)
	ListSubscriptions(ctx context.Context, userID int64) ([]db.ListSubscriptionsForUserRow, error)
	UnreadIDs(ctx context.Context, userID int64) ([]int64, error)
	StarredIDs(ctx context.Context, userID int64) ([]int64, error)
	ListEntries(ctx context.Context, userID int64, filter string, offset, limit int32) ([]db.ReaderEntry, int64, error)
	FindEntry(ctx context.Context, userID int64, entryID int64) (*db.ReaderEntry, error)
}

// entryService provides entry state management for API handlers.
type entryService interface {
	UpdateInteractions(ctx context.Context, userID, entryID int64, read, starred, archived *bool) error
}

// feverAuthService provides Fever API authentication.
type feverAuthService interface {
	FindUserByFeverApiKey(ctx context.Context, apiKey *string) (*db.User, error)
}

// greaderAuthService provides Google Reader API authentication and token management.
type greaderAuthService interface {
	AuthenticateReaderToken(ctx context.Context, tokenHash string) (*db.User, error)
	CreateReaderSession(ctx context.Context, email, password string) (string, error)
}

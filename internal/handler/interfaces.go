package handler

import (
	"context"
	"encoding/json"
	"io"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
)

// readerService defines the methods the ReaderHandler needs.
type readerService interface {
	ListFeeds(ctx context.Context, userID int64) []service.ReaderFeed
	FetchEntriesPage(ctx context.Context, userID int64, params service.ReaderQuery) service.PaginatedResult
	FetchCurrentEntry(ctx context.Context, userID int64, entryID int64, markRead *bool) (*db.ReaderEntry, error)
	CountUnread(ctx context.Context, userID int64) int64
	CountRead(ctx context.Context, userID int64) int64
	SummarizeEntry(ctx context.Context, entryID int64) (any, error)
	ListCategories(ctx context.Context, userID int64) []db.SubscriptionCategory
}

// feedService defines the methods the FeedHandler needs.
type feedService interface {
	ResolveCategory(ctx context.Context, userID int64, categoryID *int64, categoryName string) (int64, error)
	CreateFeed(ctx context.Context, userID int64, feedURL string, categoryID int64, fallbackName string) (*db.Feed, error)
	FindFeedByID(ctx context.Context, feedID int64) (*db.Feed, error)
	RefreshFeed(ctx context.Context, feed *db.Feed) (int, error)
	Unsubscribe(ctx context.Context, userID int64, feedID int64) error
	UpdateSubscription(ctx context.Context, userID, feedID, categoryID int64, customName *string, filterRulesJSON json.RawMessage) error
	MarkAllAsRead(ctx context.Context, userID, feedID int64) error
}

// entryService defines the methods the EntryHandler needs.
type entryService interface {
	UpdateInteractions(ctx context.Context, userID, entryID int64, read, starred, archived *bool) error
}

// categoryService defines the methods the CategoryHandler needs.
type categoryService interface {
	Create(ctx context.Context, userID int64, name string) (db.SubscriptionCategory, error)
	Delete(ctx context.Context, userID int64, categoryID int64) error
}

// userService defines the methods the UserHandler needs.
type userService interface {
	UpdateProfile(ctx context.Context, userID int64, currentEmail, name, email string) error
	DeleteAccount(ctx context.Context, userID int64) error
	WipeAccount(ctx context.Context, userID int64) error
}

// subscriptionService defines the methods the SubscriptionsHandler needs.
type subscriptionService interface {
	ListSubscriptions(ctx context.Context, userID int64) []service.SubscriptionFeed
	ListCategories(ctx context.Context, userID int64) []db.SubscriptionCategory
}

// chartsService defines the methods the ChartsHandler needs.
type chartsService interface {
	GetChartsData(ctx context.Context, userID int64, params service.ChartsQuery) service.ChartsData
}

// opmlService defines the methods the OPMLHandler needs.
type opmlService interface {
	ParseOPML(ctx context.Context, userID int64, reader io.Reader) ([]service.OPMLFeedImport, error)
	Export(ctx context.Context, userID int64) ([]byte, error)
}

// telegramService defines the methods the AuthHandler needs.
type telegramService interface {
	NotifyLoginFailure(email, ip string)
	NotifyRegistration(name, email string)
}

// authQuerier defines the DB query methods the AuthHandler needs directly.
// AuthHandler is special — it mixes session management (auth.Auth) with DB operations
// for user/password/2FA management. These DB calls are kept on a narrow interface
// rather than creating an auth service, since the auth.Auth package already handles
// the session side.
type authQuerier interface {
	FindUserByEmail(ctx context.Context, email string) (db.User, error)
	FindUserByID(ctx context.Context, id int64) (db.User, error)
	CreateUser(ctx context.Context, arg db.CreateUserParams) (db.User, error)
	CreatePasswordReset(ctx context.Context, arg db.CreatePasswordResetParams) error
	FindPasswordReset(ctx context.Context, email string) (db.PasswordResetToken, error)
	DeletePasswordReset(ctx context.Context, email string) error
	UpdateUserTwoFactor(ctx context.Context, arg db.UpdateUserTwoFactorParams) error
	UpdateUserPasswordAndFeverKey(ctx context.Context, arg db.UpdateUserPasswordAndFeverKeyParams) error
	UpdateUserPassword(ctx context.Context, arg db.UpdateUserPasswordParams) error
	VerifyUserEmail(ctx context.Context, id int64) error
}

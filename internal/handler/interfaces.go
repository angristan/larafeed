package handler

import (
	"context"
	"encoding/json"

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

// faviconService defines the methods handlers need from the favicon service.
type faviconService interface {
	RefreshFavicon(ctx context.Context, feed *db.Feed) error
}

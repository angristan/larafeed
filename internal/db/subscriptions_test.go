package db_test

import (
	"context"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubscribeAndUnsubscribe(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")

	// Subscribe
	err := queries.Subscribe(ctx, db.SubscribeParams{UserID: user.ID, FeedID: feed.ID, CategoryID: cat.ID})
	require.NoError(t, err)

	// Verify
	feeds, err := queries.ListSubscriptionsForUser(ctx, user.ID)
	require.NoError(t, err)
	assert.Len(t, feeds, 1)
	assert.Equal(t, feed.ID, feeds[0].ID)

	// Unsubscribe
	err = queries.Unsubscribe(ctx, db.UnsubscribeParams{UserID: user.ID, FeedID: feed.ID})
	require.NoError(t, err)

	feeds, err = queries.ListSubscriptionsForUser(ctx, user.ID)
	require.NoError(t, err)
	assert.Empty(t, feeds)
}

func TestSubscribe_DuplicateDoesNothing(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")

	err := queries.Subscribe(ctx, db.SubscribeParams{UserID: user.ID, FeedID: feed.ID, CategoryID: cat.ID})
	require.NoError(t, err)

	err = queries.Subscribe(ctx, db.SubscribeParams{UserID: user.ID, FeedID: feed.ID, CategoryID: cat.ID})
	require.NoError(t, err) // ON CONFLICT DO NOTHING

	feeds, err := queries.ListSubscriptionsForUser(ctx, user.ID)
	require.NoError(t, err)
	assert.Len(t, feeds, 1) // Still just one
}

func TestListForUser_WithCounts(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	// Create entries
	createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")
	createEntry(t, pool, feed.ID, "Entry 2", "https://example.com/2")

	feeds, err := queries.ListSubscriptionsForUser(ctx, user.ID)
	require.NoError(t, err)
	require.Len(t, feeds, 1)
	assert.Equal(t, int64(2), feeds[0].EntryCount)
	assert.Equal(t, int64(2), feeds[0].UnreadCount) // Both unread
}

func TestUpdateSubscription(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat1 := createCategory(t, pool, user.ID, "Tech")
	cat2 := createCategory(t, pool, user.ID, "News")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat1.ID)

	customName := "My Custom Feed"
	err := queries.UpdateSubscription(ctx, db.UpdateSubscriptionParams{
		UserID:         user.ID,
		FeedID:         feed.ID,
		CategoryID:     cat2.ID,
		CustomFeedName: &customName,
	})
	require.NoError(t, err)

	sub, err := queries.GetSubscription(ctx, db.GetSubscriptionParams{UserID: user.ID, FeedID: feed.ID})
	require.NoError(t, err)
	assert.Equal(t, cat2.ID, sub.CategoryID)
	assert.NotNil(t, sub.CustomFeedName)
	assert.Equal(t, "My Custom Feed", *sub.CustomFeedName)
}

func TestFeedHasSubscribers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")

	// No subscribers
	count, err := queries.CountFeedSubscribers(ctx, feed.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)

	// Subscribe
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	count, err = queries.CountFeedSubscribers(ctx, feed.ID)
	require.NoError(t, err)
	assert.True(t, count > 0)

	// Unsubscribe
	err = queries.Unsubscribe(ctx, db.UnsubscribeParams{UserID: user.ID, FeedID: feed.ID})
	require.NoError(t, err)

	count, err = queries.CountFeedSubscribers(ctx, feed.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)
}

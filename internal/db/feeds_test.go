package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateFeed(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	now := time.Now()
	feed, err := q.CreateFeed(ctx, db.CreateFeedParams{
		Name:      "Test Feed",
		FeedURL:   "https://example.com/feed.xml",
		SiteURL:   "https://example.com",
		CreatedAt: &now,
	})
	require.NoError(t, err)

	assert.NotZero(t, feed.ID)
	assert.Equal(t, "Test Feed", feed.Name)
	assert.Equal(t, "https://example.com/feed.xml", feed.FeedURL)
	assert.Equal(t, "https://example.com", feed.SiteURL)
	assert.Nil(t, feed.FaviconURL)
	assert.Nil(t, feed.FaviconIsDark)
	assert.NotNil(t, feed.CreatedAt)
	assert.NotNil(t, feed.UpdatedAt)
}

func TestFindFeedByID(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	feed := createFeed(t, pool, "By ID Feed", "https://example.com/byid.xml", "https://example.com")

	found, err := q.FindFeedByID(ctx, feed.ID)
	require.NoError(t, err)

	assert.Equal(t, feed.ID, found.ID)
	assert.Equal(t, feed.Name, found.Name)
	assert.Equal(t, feed.FeedURL, found.FeedURL)
	assert.Equal(t, feed.SiteURL, found.SiteURL)
}

func TestFindFeedByURL(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	feed := createFeed(t, pool, "By URL Feed", "https://example.com/byurl.xml", "https://example.com")

	found, err := q.FindFeedByURL(ctx, "https://example.com/byurl.xml")
	require.NoError(t, err)

	assert.Equal(t, feed.ID, found.ID)
	assert.Equal(t, feed.Name, found.Name)
	assert.Equal(t, feed.FeedURL, found.FeedURL)
}

func TestFindFeedByURL_NotFound(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	_, err := q.FindFeedByURL(ctx, "https://nonexistent.com/feed.xml")
	assert.Error(t, err)
}

func TestDeleteFeed(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	feed := createFeed(t, pool, "Delete Me", "https://example.com/delete.xml", "https://example.com")

	err := q.DeleteFeed(ctx, feed.ID)
	require.NoError(t, err)

	_, err = q.FindFeedByID(ctx, feed.ID)
	assert.Error(t, err)
}

func TestUpdateFeedFavicon(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	feed := createFeed(t, pool, "Favicon Feed", "https://example.com/favicon.xml", "https://example.com")

	faviconURL := "https://example.com/favicon.ico"
	isDark := true
	err := q.UpdateFeedFavicon(ctx, db.UpdateFeedFaviconParams{
		ID:            feed.ID,
		FaviconURL:    &faviconURL,
		FaviconIsDark: &isDark,
	})
	require.NoError(t, err)

	updated, err := q.FindFeedByID(ctx, feed.ID)
	require.NoError(t, err)

	require.NotNil(t, updated.FaviconURL)
	assert.Equal(t, "https://example.com/favicon.ico", *updated.FaviconURL)
	require.NotNil(t, updated.FaviconIsDark)
	assert.True(t, *updated.FaviconIsDark)
	assert.NotNil(t, updated.FaviconUpdatedAt)
}

func TestUpdateFeedRefreshSuccess(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	feed := createFeed(t, pool, "Refresh Success", "https://example.com/success.xml", "https://example.com")

	err := q.UpdateFeedRefreshSuccess(ctx, feed.ID)
	require.NoError(t, err)

	updated, err := q.FindFeedByID(ctx, feed.ID)
	require.NoError(t, err)

	assert.NotNil(t, updated.LastSuccessfulRefreshAt)
	assert.Nil(t, updated.LastErrorMessage)
}

func TestUpdateFeedRefreshFailure(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	feed := createFeed(t, pool, "Refresh Failure", "https://example.com/failure.xml", "https://example.com")

	errMsg := "connection timeout"
	err := q.UpdateFeedRefreshFailure(ctx, db.UpdateFeedRefreshFailureParams{
		ID:               feed.ID,
		LastErrorMessage: &errMsg,
	})
	require.NoError(t, err)

	updated, err := q.FindFeedByID(ctx, feed.ID)
	require.NoError(t, err)

	assert.NotNil(t, updated.LastFailedRefreshAt)
	require.NotNil(t, updated.LastErrorMessage)
	assert.Equal(t, "connection timeout", *updated.LastErrorMessage)
}

func TestFeedsMissingFavicons(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	// Feed without favicon
	noFavicon := createFeed(t, pool, "No Favicon", "https://example.com/nofav.xml", "https://example.com")

	// Feed with favicon
	withFavicon := createFeed(t, pool, "With Favicon", "https://example.com/withfav.xml", "https://example.com")
	faviconURL := "https://example.com/favicon.ico"
	isDark := false
	err := q.UpdateFeedFavicon(ctx, db.UpdateFeedFaviconParams{
		ID:            withFavicon.ID,
		FaviconURL:    &faviconURL,
		FaviconIsDark: &isDark,
	})
	require.NoError(t, err)

	missing, err := q.FeedsMissingFavicons(ctx)
	require.NoError(t, err)

	assert.Len(t, missing, 1)
	assert.Equal(t, noFavicon.ID, missing[0].ID)
}

func TestFeedsNeedingRefresh(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	user := createUser(t, pool, "refresh user", "refresh@example.com", "password123")
	cat := createCategory(t, pool, user.ID, "default")
	feed := createFeed(t, pool, "Stale Feed", "https://example.com/stale.xml", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	// Feed has never been refreshed (last_successful_refresh_at is NULL), so it should be returned
	feeds, err := q.FeedsNeedingRefresh(ctx, db.FeedsNeedingRefreshParams{
		StaleAfter: pgtype.Interval{Microseconds: int64(time.Hour / time.Microsecond), Valid: true},
		MaxFeeds:   10,
	})
	require.NoError(t, err)

	assert.Len(t, feeds, 1)
	assert.Equal(t, feed.ID, feeds[0].ID)
}

func TestCountFeedSubscribers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	feed := createFeed(t, pool, "Popular Feed", "https://example.com/popular.xml", "https://example.com")

	user1 := createUser(t, pool, "user1", "user1@example.com", "password123")
	cat1 := createCategory(t, pool, user1.ID, "cat1")
	subscribe(t, pool, user1.ID, feed.ID, cat1.ID)

	user2 := createUser(t, pool, "user2", "user2@example.com", "password123")
	cat2 := createCategory(t, pool, user2.ID, "cat2")
	subscribe(t, pool, user2.ID, feed.ID, cat2.ID)

	count, err := q.CountFeedSubscribers(ctx, feed.ID)
	require.NoError(t, err)

	assert.Equal(t, int64(2), count)
}

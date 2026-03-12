package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRecordRefresh(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	feed := createFeed(t, pool, "Refresh Feed", "https://example.com/refresh.xml", "https://example.com")

	count := 5
	err := q.RecordRefresh(ctx, db.RecordRefreshParams{
		FeedID:         feed.ID,
		WasSuccessful:  true,
		EntriesCreated: &count,
		ErrorMessage:   nil,
	})
	require.NoError(t, err)

	refreshes, err := q.ListFeedRefreshes(ctx, feed.ID)
	require.NoError(t, err)

	require.Len(t, refreshes, 1)
	assert.Equal(t, feed.ID, refreshes[0].FeedID)
	assert.True(t, refreshes[0].WasSuccessful)
	require.NotNil(t, refreshes[0].EntriesCreated)
	assert.Equal(t, 5, *refreshes[0].EntriesCreated)
	assert.Nil(t, refreshes[0].ErrorMessage)
}

func TestListFeedRefreshes_Order(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	feed := createFeed(t, pool, "Order Feed", "https://example.com/order.xml", "https://example.com")

	for i := 0; i < 3; i++ {
		count := i
		err := q.RecordRefresh(ctx, db.RecordRefreshParams{
			FeedID:         feed.ID,
			WasSuccessful:  true,
			EntriesCreated: &count,
			ErrorMessage:   nil,
		})
		require.NoError(t, err)
	}

	refreshes, err := q.ListFeedRefreshes(ctx, feed.ID)
	require.NoError(t, err)

	require.Len(t, refreshes, 3)
	// Verify DESC order by refreshed_at (most recent first)
	for i := 0; i < len(refreshes)-1; i++ {
		assert.True(t, refreshes[i].RefreshedAt.After(refreshes[i+1].RefreshedAt) ||
			refreshes[i].RefreshedAt.Equal(refreshes[i+1].RefreshedAt),
			"refreshes should be in DESC order by refreshed_at")
	}
}

func TestListFeedRefreshes_Limit20(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	feed := createFeed(t, pool, "Limit Feed", "https://example.com/limit.xml", "https://example.com")

	for i := 0; i < 25; i++ {
		count := 0
		err := q.RecordRefresh(ctx, db.RecordRefreshParams{
			FeedID:         feed.ID,
			WasSuccessful:  true,
			EntriesCreated: &count,
			ErrorMessage:   nil,
		})
		require.NoError(t, err)
	}

	refreshes, err := q.ListFeedRefreshes(ctx, feed.ID)
	require.NoError(t, err)

	assert.Len(t, refreshes, 20)
}

func TestGetRefreshStats(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	q := db.New(pool)

	user := createUser(t, pool, "stats user", "stats@example.com", "password123")
	cat := createCategory(t, pool, user.ID, "stats cat")
	feed := createFeed(t, pool, "Stats Feed", "https://example.com/stats.xml", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	// Record some successful refreshes
	for i := 0; i < 3; i++ {
		count := 2
		err := q.RecordRefresh(ctx, db.RecordRefreshParams{
			FeedID:         feed.ID,
			WasSuccessful:  true,
			EntriesCreated: &count,
			ErrorMessage:   nil,
		})
		require.NoError(t, err)
	}

	// Record some failed refreshes
	for i := 0; i < 2; i++ {
		errMsg := "fetch failed"
		err := q.RecordRefresh(ctx, db.RecordRefreshParams{
			FeedID:         feed.ID,
			WasSuccessful:  false,
			EntriesCreated: nil,
			ErrorMessage:   &errMsg,
		})
		require.NoError(t, err)
	}

	stats, err := q.GetRefreshStats(ctx, db.GetRefreshStatsParams{
		UserID:      user.ID,
		RefreshedAt: time.Now().Add(-24 * time.Hour),
	})
	require.NoError(t, err)

	assert.Equal(t, int64(3), stats.Successes)
	assert.Equal(t, int64(2), stats.Failures)
	assert.Equal(t, int64(6), stats.EntriesCreated) // 3 successes * 2 entries each
}

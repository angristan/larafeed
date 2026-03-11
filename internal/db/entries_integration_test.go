package db_test

import (
	"context"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListForReader_Pagination(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	// Create 5 entries
	for i := 0; i < 5; i++ {
		createEntry(t, pool, feed.ID, "Entry "+string(rune('A'+i)), "https://example.com/"+string(rune('a'+i)))
	}

	queries := db.New(pool)

	// Count total
	total, err := queries.CountForReader(ctx, db.CountForReaderParams{
		UserID: user.ID,
		Filter: "all",
	})
	require.NoError(t, err)
	assert.Equal(t, int64(5), total)

	// Page 1 with page size 2
	rows, err := queries.ListForReaderByPublished(ctx, db.ListForReaderByPublishedParams{
		UserID:     user.ID,
		Filter:     "all",
		PageOffset: 0,
		PageSize:   2,
	})
	require.NoError(t, err)
	entries := db.ReaderEntriesFromPublishedRows(rows)
	assert.Len(t, entries, 2)

	// Page 3 with page size 2 (should have 1 entry)
	rows, err = queries.ListForReaderByPublished(ctx, db.ListForReaderByPublishedParams{
		UserID:     user.ID,
		Filter:     "all",
		PageOffset: 4,
		PageSize:   2,
	})
	require.NoError(t, err)
	entries = db.ReaderEntriesFromPublishedRows(rows)
	assert.Len(t, entries, 1)
}

func TestListForReader_FilterUnread(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	entry1 := createEntry(t, pool, feed.ID, "Unread", "https://example.com/1")
	_ = createEntry(t, pool, feed.ID, "Read", "https://example.com/2")

	// Mark one as read
	queries := db.New(pool)
	_ = queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry1.ID})

	total, err := queries.CountForReader(ctx, db.CountForReaderParams{
		UserID: user.ID,
		Filter: "unread",
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)

	rows, err := queries.ListForReaderByPublished(ctx, db.ListForReaderByPublishedParams{
		UserID:     user.ID,
		Filter:     "unread",
		PageOffset: 0,
		PageSize:   30,
	})
	require.NoError(t, err)
	entries := db.ReaderEntriesFromPublishedRows(rows)
	assert.Len(t, entries, 1)
	assert.Equal(t, "Read", entries[0].Title) // The un-interacted one is unread
}

func TestListForReader_FilterFavorites(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	entry1 := createEntry(t, pool, feed.ID, "Starred", "https://example.com/1")
	_ = createEntry(t, pool, feed.ID, "Not Starred", "https://example.com/2")

	queries := db.New(pool)
	_ = queries.Favorite(ctx, db.FavoriteParams{UserID: user.ID, EntryID: entry1.ID})

	total, err := queries.CountForReader(ctx, db.CountForReaderParams{
		UserID: user.ID,
		Filter: "favorites",
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)

	rows, err := queries.ListForReaderByPublished(ctx, db.ListForReaderByPublishedParams{
		UserID:     user.ID,
		Filter:     "favorites",
		PageOffset: 0,
		PageSize:   30,
	})
	require.NoError(t, err)
	entries := db.ReaderEntriesFromPublishedRows(rows)
	assert.Len(t, entries, 1)
	assert.Equal(t, "Starred", entries[0].Title)
}

func TestListForReader_FilterByFeed(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed1 := createFeed(t, pool, "Feed 1", "https://example.com/feed1", "https://example.com")
	feed2 := createFeed(t, pool, "Feed 2", "https://example.com/feed2", "https://example.com")
	subscribe(t, pool, user.ID, feed1.ID, cat.ID)
	subscribe(t, pool, user.ID, feed2.ID, cat.ID)

	createEntry(t, pool, feed1.ID, "Feed 1 Entry", "https://example.com/1")
	createEntry(t, pool, feed2.ID, "Feed 2 Entry", "https://example.com/2")

	queries := db.New(pool)

	feedID := pgtype.Int8{Int64: feed1.ID, Valid: true}

	total, err := queries.CountForReader(ctx, db.CountForReaderParams{
		UserID: user.ID,
		FeedID: feedID,
		Filter: "all",
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)

	rows, err := queries.ListForReaderByPublished(ctx, db.ListForReaderByPublishedParams{
		UserID:     user.ID,
		FeedID:     feedID,
		Filter:     "all",
		PageOffset: 0,
		PageSize:   30,
	})
	require.NoError(t, err)
	entries := db.ReaderEntriesFromPublishedRows(rows)
	assert.Len(t, entries, 1)
	assert.Equal(t, "Feed 1 Entry", entries[0].Title)
}

func TestListForReader_FilterByCategory(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat1 := createCategory(t, pool, user.ID, "Tech")
	cat2 := createCategory(t, pool, user.ID, "News")
	feed1 := createFeed(t, pool, "Tech Feed", "https://example.com/tech", "https://example.com")
	feed2 := createFeed(t, pool, "News Feed", "https://example.com/news", "https://example.com")
	subscribe(t, pool, user.ID, feed1.ID, cat1.ID)
	subscribe(t, pool, user.ID, feed2.ID, cat2.ID)

	createEntry(t, pool, feed1.ID, "Tech Entry", "https://example.com/1")
	createEntry(t, pool, feed2.ID, "News Entry", "https://example.com/2")

	queries := db.New(pool)

	categoryID := pgtype.Int8{Int64: cat1.ID, Valid: true}

	total, err := queries.CountForReader(ctx, db.CountForReaderParams{
		UserID:     user.ID,
		CategoryID: categoryID,
		Filter:     "all",
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)

	rows, err := queries.ListForReaderByPublished(ctx, db.ListForReaderByPublishedParams{
		UserID:     user.ID,
		CategoryID: categoryID,
		Filter:     "all",
		PageOffset: 0,
		PageSize:   30,
	})
	require.NoError(t, err)
	entries := db.ReaderEntriesFromPublishedRows(rows)
	assert.Len(t, entries, 1)
	assert.Equal(t, "Tech Entry", entries[0].Title)
}

func TestListForReader_ExcludesFilteredEntries(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	entry1 := createEntry(t, pool, feed.ID, "Visible", "https://example.com/1")
	entry2 := createEntry(t, pool, feed.ID, "Filtered", "https://example.com/2")
	_ = entry1

	// Mark entry2 as filtered
	queries := db.New(pool)
	_ = queries.MarkFiltered(ctx, db.MarkFilteredParams{UserID: user.ID, EntryID: entry2.ID})

	total, err := queries.CountForReader(ctx, db.CountForReaderParams{
		UserID: user.ID,
		Filter: "all",
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)

	rows, err := queries.ListForReaderByPublished(ctx, db.ListForReaderByPublishedParams{
		UserID:     user.ID,
		Filter:     "all",
		PageOffset: 0,
		PageSize:   30,
	})
	require.NoError(t, err)
	entries := db.ReaderEntriesFromPublishedRows(rows)
	assert.Len(t, entries, 1)
	assert.Equal(t, "Visible", entries[0].Title)
}

func TestCountUnreadAndRead(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	entry1 := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")
	_ = createEntry(t, pool, feed.ID, "Entry 2", "https://example.com/2")

	queries := db.New(pool)

	// Initially all unread
	unread, err := queries.CountUnread(ctx, user.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), unread)

	read, err := queries.CountRead(ctx, user.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), read)

	// Mark one as read
	_ = queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry1.ID})

	unread, err = queries.CountUnread(ctx, user.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), unread)

	read, err = queries.CountRead(ctx, user.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), read)
}

func TestBulkCreate_SkipsDuplicates(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	// Create first batch
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Try to create again with same URL and published_at
	created, err := db.BulkCreate(ctx, pool, []db.Entry{{
		FeedID:      feed.ID,
		Title:       "Entry 1 Dup",
		URL:         "https://example.com/1",
		PublishedAt: entry.PublishedAt,
	}})
	require.NoError(t, err)
	assert.Empty(t, created, "duplicate should be skipped")
}

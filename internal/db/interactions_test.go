package db_test

import (
	"context"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/testhelper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMarkAsRead(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	cat := testhelper.CreateCategory(t, pool, user.ID, "Tech")
	feed := testhelper.CreateFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	testhelper.Subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := testhelper.CreateEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Mark as read
	err := queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	// Verify via reader entry
	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.NotNil(t, re.ReadAt)
}

func TestMarkAsUnread(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	cat := testhelper.CreateCategory(t, pool, user.ID, "Tech")
	feed := testhelper.CreateFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	testhelper.Subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := testhelper.CreateEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Mark as read then unread
	_ = queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry.ID})
	err := queries.MarkAsUnread(ctx, db.MarkAsUnreadParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.Nil(t, re.ReadAt)
}

func TestFavoriteAndUnfavorite(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	cat := testhelper.CreateCategory(t, pool, user.ID, "Tech")
	feed := testhelper.CreateFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	testhelper.Subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := testhelper.CreateEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Star
	err := queries.Favorite(ctx, db.FavoriteParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.NotNil(t, re.StarredAt)

	// Unstar
	err = queries.Unfavorite(ctx, db.UnfavoriteParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err = queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re = db.ReaderEntryFromRow(&row)
	assert.Nil(t, re.StarredAt)
}

func TestArchiveAndUnarchive(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	cat := testhelper.CreateCategory(t, pool, user.ID, "Tech")
	feed := testhelper.CreateFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	testhelper.Subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := testhelper.CreateEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Archive
	err := queries.Archive(ctx, db.ArchiveParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.NotNil(t, re.ArchivedAt)

	// Unarchive
	err = queries.Unarchive(ctx, db.UnarchiveParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err = queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re = db.ReaderEntryFromRow(&row)
	assert.Nil(t, re.ArchivedAt)
}

func TestMultipleInteractionsPreserveEachOther(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	cat := testhelper.CreateCategory(t, pool, user.ID, "Tech")
	feed := testhelper.CreateFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	testhelper.Subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := testhelper.CreateEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Star then mark as read
	_ = queries.Favorite(ctx, db.FavoriteParams{UserID: user.ID, EntryID: entry.ID})
	_ = queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry.ID})

	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.NotNil(t, re.StarredAt, "starring should be preserved after marking as read")
	assert.NotNil(t, re.ReadAt, "read_at should be set")
}

func TestMarkAllAsRead(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	cat := testhelper.CreateCategory(t, pool, user.ID, "Tech")
	feed := testhelper.CreateFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	testhelper.Subscribe(t, pool, user.ID, feed.ID, cat.ID)

	entry1 := testhelper.CreateEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")
	entry2 := testhelper.CreateEntry(t, pool, feed.ID, "Entry 2", "https://example.com/2")
	entry3 := testhelper.CreateEntry(t, pool, feed.ID, "Entry 3", "https://example.com/3")

	// Mark all as read
	err := db.MarkAllAsRead(ctx, queries, user.ID, feed.ID)
	require.NoError(t, err)

	for _, entryID := range []int64{entry1.ID, entry2.ID, entry3.ID} {
		row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entryID})
		require.NoError(t, err)
		re := db.ReaderEntryFromRow(&row)
		assert.NotNil(t, re.ReadAt, "entry %d should be marked as read", entryID)
	}
}

func TestMarkAllAsRead_PreservesStarred(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	cat := testhelper.CreateCategory(t, pool, user.ID, "Tech")
	feed := testhelper.CreateFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	testhelper.Subscribe(t, pool, user.ID, feed.ID, cat.ID)

	entry := testhelper.CreateEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Star first
	_ = queries.Favorite(ctx, db.FavoriteParams{UserID: user.ID, EntryID: entry.ID})

	// Then mark all as read
	err := db.MarkAllAsRead(ctx, queries, user.ID, feed.ID)
	require.NoError(t, err)

	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.NotNil(t, re.ReadAt, "should be marked as read")
	assert.NotNil(t, re.StarredAt, "starred should be preserved")
}

func TestMarkAllAsRead_DoesNotAffectOtherUsers(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user1 := testhelper.CreateUser(t, pool, "User1", "user1@test.com", "password")
	user2 := testhelper.CreateUser(t, pool, "User2", "user2@test.com", "password")
	cat1 := testhelper.CreateCategory(t, pool, user1.ID, "Tech")
	cat2 := testhelper.CreateCategory(t, pool, user2.ID, "Tech")
	feed := testhelper.CreateFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	testhelper.Subscribe(t, pool, user1.ID, feed.ID, cat1.ID)
	testhelper.Subscribe(t, pool, user2.ID, feed.ID, cat2.ID)

	entry := testhelper.CreateEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// User1 marks all as read
	err := db.MarkAllAsRead(ctx, queries, user1.ID, feed.ID)
	require.NoError(t, err)

	// User2 should still see it as unread
	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user2.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.Nil(t, re.ReadAt, "user2 should still see entry as unread")
}

func TestDeleteForFeed(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	cat := testhelper.CreateCategory(t, pool, user.ID, "Tech")
	feed := testhelper.CreateFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	testhelper.Subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := testhelper.CreateEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Create interaction
	_ = queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry.ID})

	// Delete interactions for feed
	err := queries.DeleteInteractionsForFeed(ctx, db.DeleteInteractionsForFeedParams{UserID: user.ID, FeedID: feed.ID})
	require.NoError(t, err)

	// Verify deleted
	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.Nil(t, re.ReadAt, "interaction should be deleted")
}

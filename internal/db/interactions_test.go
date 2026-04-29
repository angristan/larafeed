package db_test

import (
	"context"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMarkAsRead(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Mark as read
	_, err := queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	// Verify via reader entry
	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.NotNil(t, re.ReadAt)
}

func TestMarkAsRead_RejectsUnsubscribedEntry(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	owner := createUser(t, pool, "Owner", "owner@test.com", "password")
	other := createUser(t, pool, "Other", "other@test.com", "password")
	cat := createCategory(t, pool, owner.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, owner.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	rows, err := queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: other.ID, EntryID: entry.ID})
	require.NoError(t, err)
	assert.Equal(t, int64(0), rows)

	var interactions int
	err = pool.QueryRow(ctx,
		"SELECT COUNT(*) FROM entry_interactions WHERE user_id = $1 AND entry_id = $2",
		other.ID, entry.ID,
	).Scan(&interactions)
	require.NoError(t, err)
	assert.Equal(t, 0, interactions)
}

func TestMarkAsUnread(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Mark as read then unread
	_, err := queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	_, err = queries.MarkAsUnread(ctx, db.MarkAsUnreadParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.Nil(t, re.ReadAt)
}

func TestFavoriteAndUnfavorite(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Star
	_, err := queries.Favorite(ctx, db.FavoriteParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.NotNil(t, re.StarredAt)

	// Unstar
	_, err = queries.Unfavorite(ctx, db.UnfavoriteParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err = queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re = db.ReaderEntryFromRow(&row)
	assert.Nil(t, re.StarredAt)
}

func TestArchiveAndUnarchive(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Archive
	_, err := queries.Archive(ctx, db.ArchiveParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.NotNil(t, re.ArchivedAt)

	// Unarchive
	_, err = queries.Unarchive(ctx, db.UnarchiveParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err = queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re = db.ReaderEntryFromRow(&row)
	assert.Nil(t, re.ArchivedAt)
}

func TestMultipleInteractionsPreserveEachOther(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Star then mark as read
	_, err := queries.Favorite(ctx, db.FavoriteParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	_, err = queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.NotNil(t, re.StarredAt, "starring should be preserved after marking as read")
	assert.NotNil(t, re.ReadAt, "read_at should be set")
}

func TestMarkAllAsRead(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	entry1 := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")
	entry2 := createEntry(t, pool, feed.ID, "Entry 2", "https://example.com/2")
	entry3 := createEntry(t, pool, feed.ID, "Entry 3", "https://example.com/3")

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
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Star first
	_, err := queries.Favorite(ctx, db.FavoriteParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	// Then mark all as read
	err = db.MarkAllAsRead(ctx, queries, user.ID, feed.ID)
	require.NoError(t, err)

	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.NotNil(t, re.ReadAt, "should be marked as read")
	assert.NotNil(t, re.StarredAt, "starred should be preserved")
}

func TestMarkAllAsRead_DoesNotAffectOtherUsers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user1 := createUser(t, pool, "User1", "user1@test.com", "password")
	user2 := createUser(t, pool, "User2", "user2@test.com", "password")
	cat1 := createCategory(t, pool, user1.ID, "Tech")
	cat2 := createCategory(t, pool, user2.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user1.ID, feed.ID, cat1.ID)
	subscribe(t, pool, user2.ID, feed.ID, cat2.ID)

	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

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
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://example.com/1")

	// Create interaction
	_, err := queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	// Delete interactions for feed
	err = queries.DeleteInteractionsForFeed(ctx, db.DeleteInteractionsForFeedParams{UserID: user.ID, FeedID: feed.ID})
	require.NoError(t, err)

	// Verify deleted
	row, err := queries.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)
	re := db.ReaderEntryFromRow(&row)
	assert.Nil(t, re.ReadAt, "interaction should be deleted")
}

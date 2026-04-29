package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateUser(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	now := time.Now()
	feverKey := "feverkey"
	user, err := queries.CreateUser(ctx, db.CreateUserParams{
		Name:        "Test User",
		Email:       "test@test.com",
		Password:    "hashedpassword",
		FeverAPIKey: &feverKey,
		CreatedAt:   &now,
	})
	require.NoError(t, err)
	assert.NotZero(t, user.ID)
	assert.Equal(t, "Test User", user.Name)
	assert.Equal(t, "test@test.com", user.Email)
}

func TestFindByEmail(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	now := time.Now()
	feverKey := "key"
	_, err := queries.CreateUser(ctx, db.CreateUserParams{
		Name:        "Test",
		Email:       "test@test.com",
		Password:    "pass",
		FeverAPIKey: &feverKey,
		CreatedAt:   &now,
	})
	require.NoError(t, err)

	user, err := queries.FindUserByEmail(ctx, "test@test.com")
	require.NoError(t, err)
	assert.Equal(t, "Test", user.Name)

	_, err = queries.FindUserByEmail(ctx, "nonexistent@test.com")
	assert.Error(t, err)
}

func TestUpdateProfile(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Old Name", "old@test.com", "password")

	err := queries.UpdateUserProfile(ctx, db.UpdateUserProfileParams{
		ID:    user.ID,
		Name:  "New Name",
		Email: "new@test.com",
	})
	require.NoError(t, err)

	updated, err := queries.FindUserByID(ctx, user.ID)
	require.NoError(t, err)
	assert.Equal(t, "New Name", updated.Name)
	assert.Equal(t, "new@test.com", updated.Email)
}

func TestClearEmailVerification(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")

	// Verify email
	err := queries.VerifyUserEmail(ctx, user.ID)
	require.NoError(t, err)

	verified, err := queries.FindUserByID(ctx, user.ID)
	require.NoError(t, err)
	assert.NotNil(t, verified.EmailVerifiedAt)

	// Clear verification
	err = queries.ClearUserEmailVerification(ctx, user.ID)
	require.NoError(t, err)

	cleared, err := queries.FindUserByID(ctx, user.ID)
	require.NoError(t, err)
	assert.Nil(t, cleared.EmailVerifiedAt)
}

func TestDeleteUser(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := createUser(t, pool, "Test", "test@test.com", "password")

	err := queries.DeleteUser(ctx, user.ID)
	require.NoError(t, err)

	_, err = queries.FindUserByID(ctx, user.ID)
	assert.Error(t, err, "user should be deleted")
}

func TestWipeAccount_DeletesUserData(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry", "https://example.com/1")

	queries := db.New(pool)

	// Create interaction
	_, err := queries.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	// Wipe
	err = queries.DeleteAllInteractionsForUser(ctx, user.ID)
	require.NoError(t, err)
	err = queries.DeleteAllSubscriptionsForUser(ctx, user.ID)
	require.NoError(t, err)
	err = queries.DeleteAllCategoriesForUser(ctx, user.ID)
	require.NoError(t, err)

	// Verify
	feeds, err := queries.ListSubscriptionsForUser(ctx, user.ID)
	require.NoError(t, err)
	assert.Empty(t, feeds)

	cats, err := queries.ListCategoriesForUser(ctx, user.ID)
	require.NoError(t, err)
	assert.Empty(t, cats)

	// User still exists
	u, err := queries.FindUserByID(ctx, user.ID)
	require.NoError(t, err)
	assert.Equal(t, user.ID, u.ID)
}

func TestWipeAccount_DeletesOrphanedFeeds(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user := createUser(t, pool, "Test", "test@test.com", "password")
	cat := createCategory(t, pool, user.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user.ID, feed.ID, cat.ID)

	queries := db.New(pool)
	err := queries.DeleteAllSubscriptionsForUser(ctx, user.ID)
	require.NoError(t, err)

	// Feed has no more subscribers, should be deletable
	count, err := queries.CountFeedSubscribers(ctx, feed.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)
}

func TestWipeAccount_PreservesFeedsWithOtherSubscribers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	user1 := createUser(t, pool, "User1", "user1@test.com", "password")
	user2 := createUser(t, pool, "User2", "user2@test.com", "password")
	cat1 := createCategory(t, pool, user1.ID, "Tech")
	cat2 := createCategory(t, pool, user2.ID, "Tech")
	feed := createFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	subscribe(t, pool, user1.ID, feed.ID, cat1.ID)
	subscribe(t, pool, user2.ID, feed.ID, cat2.ID)

	queries := db.New(pool)

	// Wipe user1
	err := queries.DeleteAllSubscriptionsForUser(ctx, user1.ID)
	require.NoError(t, err)

	// Feed should still have user2 as subscriber
	count, err := queries.CountFeedSubscribers(ctx, feed.ID)
	require.NoError(t, err)
	assert.True(t, count > 0)

	// User2's subscription should be intact
	feeds, err := queries.ListSubscriptionsForUser(ctx, user2.ID)
	require.NoError(t, err)
	assert.Len(t, feeds, 1)
}

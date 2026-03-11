package db_test

import (
	"context"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/testhelper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateCategory(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")

	cat, err := queries.CreateCategory(ctx, db.CreateCategoryParams{UserID: user.ID, Name: "Tech"})
	require.NoError(t, err)
	assert.Equal(t, "Tech", cat.Name)
	assert.Equal(t, user.ID, cat.UserID)
	assert.NotZero(t, cat.ID)
}

func TestCreateCategory_DuplicateNameFails(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")

	_, err := queries.CreateCategory(ctx, db.CreateCategoryParams{UserID: user.ID, Name: "Tech"})
	require.NoError(t, err)

	_, err = queries.CreateCategory(ctx, db.CreateCategoryParams{UserID: user.ID, Name: "Tech"})
	assert.Error(t, err, "duplicate category name should fail")
}

func TestCreateCategory_DifferentUsersCanHaveSameName(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user1 := testhelper.CreateUser(t, pool, "User1", "user1@test.com", "password")
	user2 := testhelper.CreateUser(t, pool, "User2", "user2@test.com", "password")

	cat1, err := queries.CreateCategory(ctx, db.CreateCategoryParams{UserID: user1.ID, Name: "Tech"})
	require.NoError(t, err)
	cat2, err := queries.CreateCategory(ctx, db.CreateCategoryParams{UserID: user2.ID, Name: "Tech"})
	require.NoError(t, err)

	assert.NotEqual(t, cat1.ID, cat2.ID)
}

func TestDeleteCategory(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	cat, _ := queries.CreateCategory(ctx, db.CreateCategoryParams{UserID: user.ID, Name: "Tech"})

	err := queries.DeleteCategory(ctx, cat.ID)
	require.NoError(t, err)

	_, err = queries.FindCategoryByID(ctx, cat.ID)
	assert.Error(t, err, "category should be deleted")
}

func TestHasSubscriptions(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	cat := testhelper.CreateCategory(t, pool, user.ID, "Tech")

	// No subscriptions
	count, err := queries.CategoryHasSubscriptions(ctx, cat.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)

	// Add subscription
	feed := testhelper.CreateFeed(t, pool, "Feed", "https://example.com/feed", "https://example.com")
	testhelper.Subscribe(t, pool, user.ID, feed.ID, cat.ID)

	count, err = queries.CategoryHasSubscriptions(ctx, cat.ID)
	require.NoError(t, err)
	assert.True(t, count > 0)
}

func TestFindOrCreate(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")

	// Create new
	cat1, err := queries.FindOrCreateCategory(ctx, db.FindOrCreateCategoryParams{UserID: user.ID, Name: "Tech"})
	require.NoError(t, err)
	assert.Equal(t, "Tech", cat1.Name)

	// Find existing
	cat2, err := queries.FindOrCreateCategory(ctx, db.FindOrCreateCategoryParams{UserID: user.ID, Name: "Tech"})
	require.NoError(t, err)
	assert.Equal(t, cat1.ID, cat2.ID)
}

func TestListForUser(t *testing.T) {
	pool := testhelper.TestDB(t)
	ctx := context.Background()
	queries := db.New(pool)

	user := testhelper.CreateUser(t, pool, "Test", "test@test.com", "password")
	_, _ = queries.CreateCategory(ctx, db.CreateCategoryParams{UserID: user.ID, Name: "News"})
	_, _ = queries.CreateCategory(ctx, db.CreateCategoryParams{UserID: user.ID, Name: "Tech"})

	cats, err := queries.ListCategoriesForUser(ctx, user.ID)
	require.NoError(t, err)
	assert.Len(t, cats, 2)
	// Ordered by name
	assert.Equal(t, "News", cats[0].Name)
	assert.Equal(t, "Tech", cats[1].Name)
}

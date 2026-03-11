// Package testhelper provides utilities for integration tests.
// Integration tests require a PostgreSQL database. Set TEST_DATABASE_URL
// or the default postgres://localhost:5432/larafeed_test?sslmode=disable is used.
package testhelper

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	dbpkg "github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestDB creates a connection pool for integration tests, runs migrations,
// and registers cleanup to truncate all tables after each test.
func TestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://localhost:5432/larafeed_test?sslmode=disable"
	}

	ctx := context.Background()
	pool, err := dbpkg.NewPool(ctx, dbURL)
	if err != nil {
		t.Skipf("skipping integration test: could not connect to test database: %v", err)
	}

	t.Cleanup(func() {
		truncateAll(t, pool)
		pool.Close()
	})

	// Start clean
	truncateAll(t, pool)

	return pool
}

func truncateAll(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	tables := []string{
		"entry_interactions",
		"feed_refreshes",
		"entries",
		"feed_subscriptions",
		"feeds",
		"subscription_categories",
		"personal_access_tokens",
		"password_reset_tokens",
		"users",
	}
	for _, table := range tables {
		_, err := pool.Exec(ctx, "DELETE FROM "+table)
		if err != nil {
			t.Logf("warning: failed to truncate %s: %v", table, err)
		}
	}
}

// CreateUser creates a test user with hashed password and returns it.
func CreateUser(t *testing.T, pool *pgxpool.Pool, name, email, password string) *dbpkg.User {
	t.Helper()
	queries := dbpkg.New(pool)
	hashed, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	feverKey := auth.FeverAPIKey(email, password)
	now := time.Now()
	user, err := queries.CreateUser(context.Background(), dbpkg.CreateUserParams{
		Name:        name,
		Email:       email,
		Password:    hashed,
		FeverAPIKey: &feverKey,
		CreatedAt:   &now,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return &user
}

// CreateCategory creates a subscription category for a user.
func CreateCategory(t *testing.T, pool *pgxpool.Pool, userID int64, name string) *dbpkg.SubscriptionCategory {
	t.Helper()
	queries := dbpkg.New(pool)
	cat, err := queries.CreateCategory(context.Background(), dbpkg.CreateCategoryParams{
		UserID: userID,
		Name:   name,
	})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}
	return &cat
}

// CreateFeed creates a feed.
func CreateFeed(t *testing.T, pool *pgxpool.Pool, name, feedURL, siteURL string) *dbpkg.Feed {
	t.Helper()
	queries := dbpkg.New(pool)
	now := time.Now()
	feed, err := queries.CreateFeed(context.Background(), dbpkg.CreateFeedParams{
		Name:      name,
		FeedURL:   feedURL,
		SiteURL:   siteURL,
		CreatedAt: &now,
	})
	if err != nil {
		t.Fatalf("create feed: %v", err)
	}
	return &feed
}

// Subscribe creates a feed subscription.
func Subscribe(t *testing.T, pool *pgxpool.Pool, userID, feedID, categoryID int64) {
	t.Helper()
	queries := dbpkg.New(pool)
	err := queries.Subscribe(context.Background(), dbpkg.SubscribeParams{
		UserID:     userID,
		FeedID:     feedID,
		CategoryID: categoryID,
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
}

// CreateEntry creates an entry for a feed.
func CreateEntry(t *testing.T, pool *pgxpool.Pool, feedID int64, title, url string) *dbpkg.Entry {
	t.Helper()
	entries := []dbpkg.Entry{{
		FeedID:      feedID,
		Title:       title,
		URL:         url,
		PublishedAt: time.Now(),
	}}
	created, err := dbpkg.BulkCreate(context.Background(), pool, entries)
	if err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if len(created) == 0 {
		t.Fatal("no entry created (possible duplicate)")
	}
	return &created[0]
}

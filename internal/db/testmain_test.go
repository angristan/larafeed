package db_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

var testDBURL string

func TestMain(m *testing.M) {
	ctx := context.Background()
	container, err := postgres.Run(ctx,
		"postgres:17-alpine",
		postgres.WithDatabase("larafeed_test"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(30*time.Second),
		),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to start postgres container: %v\n", err)
		os.Exit(1)
	}
	testDBURL, err = container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to get connection string: %v\n", err)
		os.Exit(1)
	}

	code := m.Run()

	err = container.Terminate(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to terminate container: %v\n", err)
	}
	os.Exit(code)
}

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	ctx := context.Background()
	pool, err := db.NewPool(ctx, testDBURL)
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}

	t.Cleanup(func() {
		truncateAll(t, pool)
		pool.Close()
	})

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

func createUser(t *testing.T, pool *pgxpool.Pool, name, email, password string) *db.User {
	t.Helper()
	queries := db.New(pool)
	hashed, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	feverKey := auth.FeverAPIKey(email, password)
	now := time.Now()
	user, err := queries.CreateUser(context.Background(), db.CreateUserParams{
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

func createCategory(t *testing.T, pool *pgxpool.Pool, userID int64, name string) *db.SubscriptionCategory {
	t.Helper()
	queries := db.New(pool)
	cat, err := queries.CreateCategory(context.Background(), db.CreateCategoryParams{
		UserID: userID,
		Name:   name,
	})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}
	return &cat
}

func createFeed(t *testing.T, pool *pgxpool.Pool, name, feedURL, siteURL string) *db.Feed {
	t.Helper()
	queries := db.New(pool)
	now := time.Now()
	feed, err := queries.CreateFeed(context.Background(), db.CreateFeedParams{
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

func subscribe(t *testing.T, pool *pgxpool.Pool, userID, feedID, categoryID int64) {
	t.Helper()
	queries := db.New(pool)
	err := queries.Subscribe(context.Background(), db.SubscribeParams{
		UserID:     userID,
		FeedID:     feedID,
		CategoryID: categoryID,
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
}

func createEntry(t *testing.T, pool *pgxpool.Pool, feedID int64, title, url string) *db.Entry {
	t.Helper()
	entries := []db.Entry{{
		FeedID:      feedID,
		Title:       title,
		URL:         url,
		PublishedAt: time.Now(),
	}}
	created, err := db.BulkCreate(context.Background(), pool, entries)
	if err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if len(created) == 0 {
		t.Fatal("no entry created (possible duplicate)")
	}
	return &created[0]
}

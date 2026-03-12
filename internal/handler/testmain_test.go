package handler

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
	gonertia "github.com/romsar/gonertia/v2"
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
			wait.ForListeningPort("5432/tcp").WithStartupTimeout(30*time.Second),
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

	_ = container.Terminate(ctx)
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
		if _, err := pool.Exec(ctx, "DELETE FROM "+table); err != nil {
			t.Logf("warning: failed to truncate %s: %v", table, err)
		}
	}
}

// testAuth creates an Auth instance with a test session key.
func testAuth(t *testing.T, q *db.Queries) *auth.Auth {
	t.Helper()
	return auth.New("test-session-key-32chars!!!!!!!!!", q)
}

// testInertia creates a minimal gonertia instance suitable for handler tests.
func testInertia(t *testing.T, authSvc *auth.Auth) *gonertia.Inertia {
	t.Helper()
	flash := auth.NewFlashProvider(authSvc.Store(), authSvc.SessionName())
	i, err := gonertia.New(
		`<!DOCTYPE html><html><head>{{ .inertiaHead }}</head><body>{{ .inertia }}</body></html>`,
		gonertia.WithVersion("test"),
		gonertia.WithFlashProvider(flash),
	)
	if err != nil {
		t.Fatalf("create inertia: %v", err)
	}
	return i
}

// createUser creates a user in the test database and returns it.
func createUser(t *testing.T, q *db.Queries, name, email, password string) *db.User {
	t.Helper()
	hashed, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	feverKey := auth.FeverAPIKey(email, password)
	now := time.Now()
	user, err := q.CreateUser(context.Background(), db.CreateUserParams{
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

// createCategory creates a category in the test database.
func createCategory(t *testing.T, q *db.Queries, userID int64, name string) *db.SubscriptionCategory {
	t.Helper()
	cat, err := q.CreateCategory(context.Background(), db.CreateCategoryParams{
		UserID: userID,
		Name:   name,
	})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}
	return &cat
}

// jsonRequest creates an HTTP request with a JSON body and Content-Type header.
func jsonRequest(method, url, body string) *http.Request {
	r := httptest.NewRequest(method, url, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	return r
}

// callHandler wraps a handler function with the InjectRequestContext middleware
// (required for gonertia flash provider) and serves the request.
func callHandler(handler http.HandlerFunc, w *httptest.ResponseRecorder, r *http.Request) {
	auth.InjectRequestContext(handler).ServeHTTP(w, r)
}

// withUser sets an authenticated user in the request context.
func withUser(r *http.Request, user *db.User) *http.Request {
	ctx := auth.SetUserInContext(r.Context(), user)
	return r.WithContext(ctx)
}

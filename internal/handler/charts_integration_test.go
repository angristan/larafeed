package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/stretchr/testify/assert"
)

func newChartsHandler(t *testing.T, pool *db.Pool, q *db.Queries) *ChartsHandler {
	t.Helper()
	authSvc := testAuth(t, q)
	i := testInertia(t, authSvc)
	chartsSvc := service.NewChartsService(q, pool)
	return NewChartsHandler(i, chartsSvc)
}

func TestCharts_Show_Default(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newChartsHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)
	createEntry(t, pool, feed.ID, "Entry 1", "https://go.dev/1")

	r := jsonRequest("GET", "/charts", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCharts_Show_WithRange(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newChartsHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("GET", "/charts?range=7", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCharts_Show_WithFeedFilter(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newChartsHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)

	r := jsonRequest("GET", "/charts?feedId="+itoa(feed.ID), "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCharts_Show_InvalidRange(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newChartsHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("GET", "/charts?range=abc", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	// Falls back to default 30 days, still succeeds
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCharts_Show_Empty(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newChartsHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("GET", "/charts", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

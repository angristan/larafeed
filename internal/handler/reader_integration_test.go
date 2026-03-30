package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/stretchr/testify/assert"
)

func newReaderHandler(t *testing.T, pool *db.Pool, q *db.Queries) *ReaderHandler {
	t.Helper()
	authSvc := testAuth(t, q)
	i := testInertia(t, authSvc)
	imgProxy, err := service.NewImgProxyService("", "", "")
	if err != nil {
		t.Fatalf("create imgproxy service: %v", err)
	}
	faviconSvc := service.NewFaviconService(q, imgProxy)
	llm := service.NewLLMService("", q)
	readerSvc := service.NewReaderService(q, faviconSvc, imgProxy, llm)
	return NewReaderHandler(i, readerSvc)
}

func TestReader_Show_Default(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newReaderHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)
	createEntry(t, pool, feed.ID, "Entry 1", "https://go.dev/1")

	r := jsonRequest("GET", "/reader", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestReader_Show_WithFeedFilter(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newReaderHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)
	createEntry(t, pool, feed.ID, "Entry 1", "https://go.dev/1")

	r := jsonRequest("GET", "/reader?feed="+itoa(feed.ID), "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestReader_Show_WithCategoryFilter(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newReaderHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)
	createEntry(t, pool, feed.ID, "Entry 1", "https://go.dev/1")

	r := jsonRequest("GET", "/reader?category="+itoa(cat.ID), "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestReader_Show_UnreadFilter(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newReaderHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)
	createEntry(t, pool, feed.ID, "Entry 1", "https://go.dev/1")

	r := jsonRequest("GET", "/reader?filter=unread", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestReader_Show_Empty(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newReaderHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("GET", "/reader", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

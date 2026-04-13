package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newOPMLHandler(t *testing.T, pool *db.Pool, q *db.Queries) *OPMLHandler {
	t.Helper()
	authSvc := testAuth(t, q)
	i := testInertia(t, authSvc)
	filterSvc := service.NewFilterService(q)
	feedSvc := service.NewFeedService(q, pool, filterSvc, nil)
	opmlSvc := service.NewOPMLService(q, feedSvc)
	return NewOPMLHandler(i, opmlSvc, authSvc, feedSvc, nil) // nil River client — only Export/ShowImport tested
}

func TestOPML_Export_WithFeeds(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newOPMLHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)

	r := jsonRequest("GET", "/profile/opml/export", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	// Export doesn't use Inertia, so call directly without callHandler
	h.Export(w, r)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "text/xml", w.Header().Get("Content-Type"))
	assert.Contains(t, w.Header().Get("Content-Disposition"), "feeds.opml")
	body := w.Body.String()
	require.Contains(t, body, "<?xml")
	assert.Contains(t, body, "https://go.dev/feed")
}

func TestOPML_Export_Empty(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newOPMLHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("GET", "/profile/opml/export", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	h.Export(w, r)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "text/xml", w.Header().Get("Content-Type"))
	assert.Contains(t, w.Body.String(), "<?xml")
}

func TestOPML_ShowImport(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newOPMLHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("GET", "/profile/opml/import", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.ShowImport, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

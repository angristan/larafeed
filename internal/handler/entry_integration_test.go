package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newEntryHandler(t *testing.T, q *db.Queries) *EntryHandler {
	t.Helper()
	return NewEntryHandler(service.NewEntryService(q))
}

func TestEntryUpdate_MarkAsRead(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newEntryHandler(t, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://go.dev/1")

	r := jsonRequest("PATCH", "/entries/"+itoa(entry.ID), `{"read": true}`)
	r = withUser(r, user)
	r.Header.Set("Referer", "/feeds")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("entry_id", itoa(entry.ID))
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	w := httptest.NewRecorder()
	callHandler(h.Update, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	unread, err := q.CountUnread(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), unread)
}

func TestEntryUpdate_Favorite(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newEntryHandler(t, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://go.dev/1")

	r := jsonRequest("PATCH", "/entries/"+itoa(entry.ID), `{"starred": true}`)
	r = withUser(r, user)
	r.Header.Set("Referer", "/feeds")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("entry_id", itoa(entry.ID))
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	w := httptest.NewRecorder()
	callHandler(h.Update, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	starred, err := q.StarredIDs(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Contains(t, starred, entry.ID)
}

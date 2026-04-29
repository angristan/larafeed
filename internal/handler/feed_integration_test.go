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

func newFeedHandler(t *testing.T, pool *db.Pool, q *db.Queries) *FeedHandler {
	t.Helper()
	authSvc := testAuth(t, q)
	i := testInertia(t, authSvc)
	filterSvc := service.NewFilterService(q)
	feedSvc := service.NewFeedService(q, pool, filterSvc, nil)
	return NewFeedHandler(i, feedSvc, nil)
}

func TestUnsubscribe_Success(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newFeedHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)
	entry := createEntry(t, pool, feed.ID, "Entry 1", "https://go.dev/1")

	// Create an interaction
	_, err := q.MarkAsRead(context.Background(), db.MarkAsReadParams{UserID: user.ID, EntryID: entry.ID})
	require.NoError(t, err)

	// Build request with chi URL params
	r := jsonRequest("DELETE", "/feeds/"+itoa(feed.ID), "")
	r = withUser(r, user)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("feed_id", itoa(feed.ID))
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	w := httptest.NewRecorder()
	callHandler(h.Unsubscribe, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	// Feed should be deleted (no other subscribers)
	_, err = q.FindFeedByID(context.Background(), feed.ID)
	assert.Error(t, err)
}

func TestUnsubscribe_KeepsFeedForOtherSubscribers(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newFeedHandler(t, pool, q)

	user1 := createUser(t, q, "Alice", "alice@test.com", "secret123")
	user2 := createUser(t, q, "Bob", "bob@test.com", "secret123")
	cat1 := createCategory(t, q, user1.ID, "Tech")
	cat2 := createCategory(t, q, user2.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user1.ID, feed.ID, cat1.ID)
	subscribe(t, q, user2.ID, feed.ID, cat2.ID)

	r := jsonRequest("DELETE", "/feeds/"+itoa(feed.ID), "")
	r = withUser(r, user1)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("feed_id", itoa(feed.ID))
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	w := httptest.NewRecorder()
	callHandler(h.Unsubscribe, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	// Feed should still exist
	_, err := q.FindFeedByID(context.Background(), feed.ID)
	assert.NoError(t, err)
}

func TestMarkRead_Success(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newFeedHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)
	createEntry(t, pool, feed.ID, "Entry 1", "https://go.dev/1")
	createEntry(t, pool, feed.ID, "Entry 2", "https://go.dev/2")

	r := jsonRequest("POST", "/feeds/"+itoa(feed.ID)+"/mark-read", "")
	r = withUser(r, user)
	r.Header.Set("Referer", "/feeds")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("feed_id", itoa(feed.ID))
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	w := httptest.NewRecorder()
	callHandler(h.MarkRead, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	// All entries should be read
	unread, err := q.CountUnread(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), unread)
}

func TestMarkRead_RejectsUnsubscribedFeed(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newFeedHandler(t, pool, q)

	owner := createUser(t, q, "Alice", "alice@test.com", "secret123")
	other := createUser(t, q, "Bob", "bob@test.com", "secret123")
	cat := createCategory(t, q, owner.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, owner.ID, feed.ID, cat.ID)
	createEntry(t, pool, feed.ID, "Entry 1", "https://go.dev/1")

	r := jsonRequest("POST", "/feeds/"+itoa(feed.ID)+"/mark-read", "")
	r = withUser(r, other)
	r.Header.Set("Referer", "/feeds")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("feed_id", itoa(feed.ID))
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	w := httptest.NewRecorder()
	callHandler(h.MarkRead, w, r)

	assert.Equal(t, http.StatusNotFound, w.Code)

	var interactions int
	err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*)
		FROM entry_interactions ei
		JOIN entries e ON e.id = ei.entry_id
		WHERE ei.user_id = $1 AND e.feed_id = $2`,
		other.ID, feed.ID,
	).Scan(&interactions)
	require.NoError(t, err)
	assert.Equal(t, 0, interactions)
}

func TestUpdateSubscription_ChangeCategory(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newFeedHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat1 := createCategory(t, q, user.ID, "Tech")
	cat2 := createCategory(t, q, user.ID, "News")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat1.ID)

	r := jsonRequest("PATCH", "/feeds/"+itoa(feed.ID), `{"category_id": `+itoa(cat2.ID)+`, "name": "My Go Blog"}`)
	r = withUser(r, user)
	r.Header.Set("Referer", "/feeds")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("feed_id", itoa(feed.ID))
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	w := httptest.NewRecorder()
	callHandler(h.Update, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	sub, err := q.GetSubscription(context.Background(), db.GetSubscriptionParams{UserID: user.ID, FeedID: feed.ID})
	require.NoError(t, err)
	assert.Equal(t, cat2.ID, sub.CategoryID)
}

func TestUpdateSubscription_RejectsOtherUserCategory(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newFeedHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	other := createUser(t, q, "Bob", "bob@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	otherCat := createCategory(t, q, other.ID, "News")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)

	r := jsonRequest("PATCH", "/feeds/"+itoa(feed.ID), `{"category_id": `+itoa(otherCat.ID)+`, "name": "My Go Blog"}`)
	r = withUser(r, user)
	r.Header.Set("Referer", "/feeds")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("feed_id", itoa(feed.ID))
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))

	w := httptest.NewRecorder()
	callHandler(h.Update, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	sub, err := q.GetSubscription(context.Background(), db.GetSubscriptionParams{UserID: user.ID, FeedID: feed.ID})
	require.NoError(t, err)
	assert.Equal(t, cat.ID, sub.CategoryID)
}

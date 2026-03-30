package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/stretchr/testify/assert"
)

func newSubscriptionsHandler(t *testing.T, pool *db.Pool, q *db.Queries) *SubscriptionsHandler {
	t.Helper()
	authSvc := testAuth(t, q)
	i := testInertia(t, authSvc)
	imgProxy, err := service.NewImgProxyService("", "", "")
	if err != nil {
		t.Fatalf("create imgproxy service: %v", err)
	}
	faviconSvc := service.NewFaviconService(q, imgProxy)
	subsSvc := service.NewSubscriptionService(q, faviconSvc)
	return NewSubscriptionsHandler(i, subsSvc)
}

func TestSubscriptions_Show_WithFeeds(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newSubscriptionsHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	cat := createCategory(t, q, user.ID, "Tech")
	feed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	subscribe(t, q, user.ID, feed.ID, cat.ID)

	r := jsonRequest("GET", "/subscriptions", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSubscriptions_Show_Empty(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newSubscriptionsHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("GET", "/subscriptions", "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

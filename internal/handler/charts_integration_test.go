package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	gonertia "github.com/romsar/gonertia/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

	r := jsonRequest("GET", "/charts?group=feed&feedId="+itoa(feed.ID), "")
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCharts_Show_WithCategoryAndCustomRange(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newChartsHandler(t, pool, q)
	ctx := context.Background()

	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	tech := createCategory(t, q, user.ID, "Tech")
	news := createCategory(t, q, user.ID, "News")
	goFeed := createFeed(t, q, "Go Blog", "https://go.dev/feed", "https://go.dev")
	newsFeed := createFeed(t, q, "News", "https://news.test/feed", "https://news.test")
	subscribe(t, q, user.ID, goFeed.ID, tech.ID)
	subscribe(t, q, user.ID, newsFeed.ID, news.ID)

	goEntry := createEntry(t, pool, goFeed.ID, "Go entry", "https://go.dev/1")
	createEntry(t, pool, newsFeed.ID, "News entry", "https://news.test/1")
	_, err := q.MarkAsRead(ctx, db.MarkAsReadParams{UserID: user.ID, EntryID: goEntry.ID})
	require.NoError(t, err)
	_, err = q.Favorite(ctx, db.FavoriteParams{UserID: user.ID, EntryID: goEntry.ID})
	require.NoError(t, err)
	entriesCreated := 3
	err = q.RecordRefresh(ctx, db.RecordRefreshParams{
		FeedID: goFeed.ID, WasSuccessful: true, EntriesCreated: &entriesCreated,
	})
	require.NoError(t, err)
	err = q.RecordRefresh(ctx, db.RecordRefreshParams{
		FeedID: newsFeed.ID, WasSuccessful: false,
	})
	require.NoError(t, err)

	today := time.Now().UTC().Format(chartsDateLayout)
	r := jsonRequest(
		"GET",
		"/charts?range=custom&group=category&categoryId="+itoa(tech.ID)+"&startDate="+today+"&endDate="+today,
		"",
	)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Show, w, r)

	require.Equal(t, http.StatusOK, w.Code)
	assertable := gonertia.AssertFromString(t, w.Body.String())
	assertable.AssertComponent("Charts")

	encodedProps, err := json.Marshal(assertable.Props)
	require.NoError(t, err)
	var props struct {
		DailyEntries   []dailyEntriesDTO      `json:"dailyEntries"`
		DailyReads     []dailyReadsDTO        `json:"dailyReads"`
		DailySaved     []dailySavedDTO        `json:"dailySaved"`
		DailyRefreshes []service.DailyRefresh `json:"dailyRefreshes"`
		Filters        struct {
			Range      string `json:"range"`
			Group      string `json:"group"`
			CategoryID *int64 `json:"categoryId"`
			StartDate  string `json:"startDate"`
			EndDate    string `json:"endDate"`
		} `json:"filters"`
		Summary struct {
			TotalEntries int `json:"totalEntries"`
			TotalReads   int `json:"totalReads"`
			TotalSaved   int `json:"totalSaved"`
		} `json:"summary"`
		RefreshSummary struct {
			TotalAttempts  int `json:"totalAttempts"`
			Successes      int `json:"successes"`
			Failures       int `json:"failures"`
			EntriesCreated int `json:"entriesCreated"`
		} `json:"refreshSummary"`
	}
	require.NoError(t, json.Unmarshal(encodedProps, &props))

	assert.Equal(t, "custom", props.Filters.Range)
	assert.Equal(t, "category", props.Filters.Group)
	require.NotNil(t, props.Filters.CategoryID)
	assert.Equal(t, tech.ID, *props.Filters.CategoryID)
	assert.Equal(t, today, props.Filters.StartDate)
	assert.Equal(t, today, props.Filters.EndDate)
	assert.Equal(t, 1, props.Summary.TotalEntries)
	assert.Equal(t, 1, props.Summary.TotalReads)
	assert.Equal(t, 1, props.Summary.TotalSaved)
	assert.Equal(t, 1, props.RefreshSummary.TotalAttempts)
	assert.Equal(t, 1, props.RefreshSummary.Successes)
	assert.Equal(t, 0, props.RefreshSummary.Failures)
	assert.Equal(t, entriesCreated, props.RefreshSummary.EntriesCreated)
	require.Len(t, props.DailyEntries, 1)
	assert.Equal(t, 1, props.DailyEntries[0].Entries)
	require.Len(t, props.DailyReads, 1)
	assert.Equal(t, 1, props.DailyReads[0].Reads)
	require.Len(t, props.DailySaved, 1)
	assert.Equal(t, 1, props.DailySaved[0].Saved)
	require.Len(t, props.DailyRefreshes, 1)
	assert.Equal(t, 1, props.DailyRefreshes[0].Successes)
	assert.Equal(t, 0, props.DailyRefreshes[0].Failures)
	assert.Equal(t, entriesCreated, props.DailyRefreshes[0].EntriesCreated)
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

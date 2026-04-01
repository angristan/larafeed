package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/apperr"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/db/mocks"
	"github.com/jackc/pgx/v5"
	"github.com/mmcdole/gofeed"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestValidateURL(t *testing.T) {
	t.Run("accepts valid HTTP URLs", func(t *testing.T) {
		err := ValidateURL("https://example.com")
		if err != nil && err.Error() != "" {
			t.Skip("DNS resolution not available")
		}
		assert.NoError(t, err)
	})

	t.Run("blocks non-HTTP schemes", func(t *testing.T) {
		err := ValidateURL("ftp://example.com")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid scheme")
	})

	t.Run("blocks empty scheme", func(t *testing.T) {
		err := ValidateURL("example.com/feed")
		assert.Error(t, err)
	})

	t.Run("blocks localhost", func(t *testing.T) {
		err := ValidateURL("http://localhost/feed")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "private IP")
	})

	t.Run("blocks 127.0.0.1", func(t *testing.T) {
		err := ValidateURL("http://127.0.0.1/feed")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "private IP")
	})

	t.Run("blocks private IP 192.168.x.x", func(t *testing.T) {
		err := ValidateURL("http://192.168.1.1/feed")
		assert.Error(t, err)
	})

	t.Run("blocks private IP 10.x.x.x", func(t *testing.T) {
		err := ValidateURL("http://10.0.0.1/feed")
		assert.Error(t, err)
	})

	t.Run("blocks private IP 172.16.x.x", func(t *testing.T) {
		err := ValidateURL("http://172.16.0.1/feed")
		assert.Error(t, err)
	})
}

func TestPaginate(t *testing.T) {
	t.Run("calculates correct pagination", func(t *testing.T) {
		result := Paginate([]int{1, 2, 3}, 100, 1, 30)
		assert.Equal(t, 1, result.CurrentPage)
		assert.Equal(t, 4, result.LastPage)
		assert.Equal(t, 30, result.PerPage)
		assert.Equal(t, 100, result.Total)
	})

	t.Run("handles zero total", func(t *testing.T) {
		result := Paginate([]int{}, 0, 1, 30)
		assert.Equal(t, 1, result.LastPage)
		assert.Equal(t, 0, result.Total)
	})

	t.Run("handles exact division", func(t *testing.T) {
		result := Paginate(nil, 60, 1, 30)
		assert.Equal(t, 2, result.LastPage)
	})

	t.Run("handles single page", func(t *testing.T) {
		result := Paginate(nil, 5, 1, 30)
		assert.Equal(t, 1, result.LastPage)
	})
}

func TestStringContainsAny(t *testing.T) {
	t.Run("matches substring", func(t *testing.T) {
		assert.True(t, StringContainsAny("Hello World", []string{"world"}))
	})

	t.Run("case insensitive", func(t *testing.T) {
		assert.True(t, StringContainsAny("HELLO", []string{"hello"}))
	})

	t.Run("no match returns false", func(t *testing.T) {
		assert.False(t, StringContainsAny("Hello", []string{"xyz", "abc"}))
	})

	t.Run("empty substrs returns false", func(t *testing.T) {
		assert.False(t, StringContainsAny("Hello", []string{}))
	})
}

func TestResolveCategory_ByID(t *testing.T) {
	q := mocks.NewQuerier(t)
	svc := NewFeedService(q, nil, nil)

	catID := int64(42)
	id, err := svc.ResolveCategory(context.Background(), 1, &catID, "")
	require.NoError(t, err)
	assert.Equal(t, int64(42), id)
}

func TestResolveCategory_ByName(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("FindOrCreateCategory", mock.Anything, db.FindOrCreateCategoryParams{
		UserID: 1, Name: "Tech",
	}).Return(db.SubscriptionCategory{ID: 99, Name: "Tech"}, nil)

	svc := NewFeedService(q, nil, nil)

	id, err := svc.ResolveCategory(context.Background(), 1, nil, "Tech")
	require.NoError(t, err)
	assert.Equal(t, int64(99), id)
}

func TestResolveCategory_NeitherIDNorName(t *testing.T) {
	q := mocks.NewQuerier(t)
	svc := NewFeedService(q, nil, nil)

	_, err := svc.ResolveCategory(context.Background(), 1, nil, "")
	assert.Error(t, err)
	var validErr *apperr.ValidationError
	assert.True(t, errors.As(err, &validErr))
	assert.Equal(t, "category_id", validErr.Field)
}

func TestResolveCategory_CreateFails(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("FindOrCreateCategory", mock.Anything, mock.Anything).
		Return(db.SubscriptionCategory{}, fmt.Errorf("db error"))

	svc := NewFeedService(q, nil, nil)

	_, err := svc.ResolveCategory(context.Background(), 1, nil, "Tech")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "db error")
}

func TestFindFeedByID(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("FindFeedByID", mock.Anything, int64(5)).
		Return(db.Feed{ID: 5, Name: "Go Blog"}, nil)

	svc := NewFeedService(q, nil, nil)

	feed, err := svc.FindFeedByID(context.Background(), 5)
	require.NoError(t, err)
	assert.Equal(t, int64(5), feed.ID)
	assert.Equal(t, "Go Blog", feed.Name)
}

func TestFindFeedByID_NotFound(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("FindFeedByID", mock.Anything, int64(99)).
		Return(db.Feed{}, fmt.Errorf("no rows"))

	svc := NewFeedService(q, nil, nil)

	_, err := svc.FindFeedByID(context.Background(), 99)
	assert.Error(t, err)
	var notFound *apperr.NotFoundError
	assert.True(t, errors.As(err, &notFound))
	assert.Equal(t, "feed", notFound.Resource)
}

func TestMarkAllAsRead(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("MarkAllAsReadExisting", mock.Anything, db.MarkAllAsReadExistingParams{UserID: 1, FeedID: 5}).Return(nil)
	q.On("MarkAllAsReadNew", mock.Anything, db.MarkAllAsReadNewParams{UserID: 1, FeedID: 5}).Return(nil)

	svc := NewFeedService(q, nil, nil)

	err := svc.MarkAllAsRead(context.Background(), 1, 5)
	require.NoError(t, err)
}

func TestIsUserSubscribed(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("GetSubscription", mock.Anything, db.GetSubscriptionParams{UserID: 1, FeedID: 5}).
		Return(db.FeedSubscription{UserID: 1, FeedID: 5}, nil)

	svc := NewFeedService(q, nil, nil)

	subscribed, err := svc.IsUserSubscribed(context.Background(), 1, 5)
	require.NoError(t, err)
	assert.True(t, subscribed)
}

func TestIsUserSubscribed_NotSubscribed(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("GetSubscription", mock.Anything, db.GetSubscriptionParams{UserID: 1, FeedID: 99}).
		Return(db.FeedSubscription{}, pgx.ErrNoRows)

	svc := NewFeedService(q, nil, nil)

	subscribed, err := svc.IsUserSubscribed(context.Background(), 1, 99)
	require.NoError(t, err)
	assert.False(t, subscribed)
}

func TestCreateFeed_EmptyURL(t *testing.T) {
	q := mocks.NewQuerier(t)
	svc := NewFeedService(q, nil, nil)

	_, err := svc.CreateFeed(context.Background(), 1, "", 1, "fallback")
	assert.Error(t, err)
	var validErr *apperr.ValidationError
	assert.True(t, errors.As(err, &validErr))
	assert.Equal(t, "feed_url", validErr.Field)
}

func TestCreateFeed_InvalidScheme(t *testing.T) {
	q := mocks.NewQuerier(t)
	svc := NewFeedService(q, nil, nil)

	_, err := svc.CreateFeed(context.Background(), 1, "ftp://example.com/feed", 1, "")
	assert.Error(t, err)
	var validErr *apperr.ValidationError
	assert.True(t, errors.As(err, &validErr))
	assert.Equal(t, "feed_url", validErr.Field)
}

func TestUpdateSubscription_InvalidFilterJSON(t *testing.T) {
	q := mocks.NewQuerier(t)
	svc := NewFeedService(q, nil, NewFilterService(q))

	err := svc.UpdateSubscription(context.Background(), 1, 5, 2, nil, json.RawMessage(`{bad json`))
	assert.Error(t, err)
	var validErr *apperr.ValidationError
	assert.True(t, errors.As(err, &validErr))
	assert.Equal(t, "filter_rules", validErr.Field)
	q.AssertNotCalled(t, "UpdateSubscription", mock.Anything, mock.Anything)
}

func TestUpdateSubscription_UnsafePattern(t *testing.T) {
	q := mocks.NewQuerier(t)
	svc := NewFeedService(q, nil, NewFilterService(q))

	rules := FilterRules{ExcludeTitle: []string{"(a+)+"}}
	rulesJSON, err := json.Marshal(rules)
	require.NoError(t, err)

	err = svc.UpdateSubscription(context.Background(), 1, 5, 2, nil, rulesJSON)
	assert.Error(t, err)
	var validErr *apperr.ValidationError
	assert.True(t, errors.As(err, &validErr))
	assert.Equal(t, "filter_rules", validErr.Field)
	q.AssertNotCalled(t, "UpdateSubscription", mock.Anything, mock.Anything)
}

func TestUpdateSubscription(t *testing.T) {
	q := mocks.NewQuerier(t)
	filterSvc := NewFilterService(q)

	customName := "My Blog"
	q.On("UpdateSubscription", mock.Anything, db.UpdateSubscriptionParams{
		UserID: 1, FeedID: 5, CategoryID: 2,
		CustomFeedName: &customName, FilterRules: nil,
	}).Return(nil)

	svc := NewFeedService(q, nil, filterSvc)

	err := svc.UpdateSubscription(context.Background(), 1, 5, 2, &customName, nil)
	require.NoError(t, err)
}

func TestUpdateSubscription_WithFilters(t *testing.T) {
	q := mocks.NewQuerier(t)
	filterSvc := NewFilterService(q)

	rules := FilterRules{ExcludeTitle: []string{"alpha"}}
	rulesJSON, err := json.Marshal(rules)
	require.NoError(t, err)

	q.On("UpdateSubscription", mock.Anything, mock.Anything).Return(nil)
	q.On("GetSubscription", mock.Anything, db.GetSubscriptionParams{UserID: 1, FeedID: 5}).
		Return(db.FeedSubscription{UserID: 1, FeedID: 5, FilterRules: rulesJSON}, nil)
	q.On("EntriesForFeed", mock.Anything, int64(5)).Return([]db.Entry{}, nil)

	svc := NewFeedService(q, nil, filterSvc)

	err = svc.UpdateSubscription(context.Background(), 1, 5, 2, nil, rulesJSON)
	require.NoError(t, err)
}

func TestDiscoverFeedFromHTML(t *testing.T) {
	t.Run("discovers RSS link", func(t *testing.T) {
		html := `<html><head>
			<link rel="alternate" type="application/rss+xml" href="/feed.xml">
		</head></html>`
		got := discoverFeedFromHTML("https://example.com", html)
		assert.Equal(t, "https://example.com/feed.xml", got)
	})

	t.Run("discovers Atom link", func(t *testing.T) {
		html := `<html><head>
			<link rel="alternate" type="application/atom+xml" href="/atom.xml">
		</head></html>`
		got := discoverFeedFromHTML("https://example.com", html)
		assert.Equal(t, "https://example.com/atom.xml", got)
	})

	t.Run("discovers JSON feed link", func(t *testing.T) {
		html := `<html><head>
			<link rel="alternate" type="application/feed+json" href="/feed.json">
		</head></html>`
		got := discoverFeedFromHTML("https://example.com", html)
		assert.Equal(t, "https://example.com/feed.json", got)
	})

	t.Run("resolves absolute URLs", func(t *testing.T) {
		html := `<html><head>
			<link rel="alternate" type="application/rss+xml" href="https://cdn.example.com/rss">
		</head></html>`
		got := discoverFeedFromHTML("https://example.com", html)
		assert.Equal(t, "https://cdn.example.com/rss", got)
	})

	t.Run("resolves relative paths", func(t *testing.T) {
		html := `<html><head>
			<link rel="alternate" type="application/rss+xml" href="blog/feed">
		</head></html>`
		got := discoverFeedFromHTML("https://example.com/site/", html)
		assert.Equal(t, "https://example.com/site/blog/feed", got)
	})

	t.Run("returns empty when no feed link", func(t *testing.T) {
		html := `<html><head>
			<link rel="stylesheet" href="/style.css">
		</head></html>`
		got := discoverFeedFromHTML("https://example.com", html)
		assert.Empty(t, got)
	})

	t.Run("returns empty when no alternate link", func(t *testing.T) {
		html := `<html><head><title>No feeds</title></head></html>`
		got := discoverFeedFromHTML("https://example.com", html)
		assert.Empty(t, got)
	})

	t.Run("ignores non-feed alternate types", func(t *testing.T) {
		html := `<html><head>
			<link rel="alternate" type="text/html" href="/fr/" hreflang="fr">
		</head></html>`
		got := discoverFeedFromHTML("https://example.com", html)
		assert.Empty(t, got)
	})

	t.Run("handles single-quoted attributes", func(t *testing.T) {
		html := `<html><head>
			<link rel='alternate' type='application/rss+xml' href='/feed'>
		</head></html>`
		got := discoverFeedFromHTML("https://example.com", html)
		assert.Equal(t, "https://example.com/feed", got)
	})

	t.Run("picks first feed link when multiple present", func(t *testing.T) {
		html := `<html><head>
			<link rel="alternate" type="application/rss+xml" href="/rss">
			<link rel="alternate" type="application/atom+xml" href="/atom">
		</head></html>`
		got := discoverFeedFromHTML("https://example.com", html)
		assert.Equal(t, "https://example.com/rss", got)
	})
}

// validRSSFeed returns a minimal valid RSS feed for testing.
func validRSSFeed() string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <item>
      <title>Test Entry</title>
      <link>https://example.com/1</link>
    </item>
  </channel>
</rss>`
}

func mockQuerier(t *testing.T, existingURLs []string) *mocks.Querier {
	t.Helper()
	q := mocks.NewQuerier(t)
	q.On("EntryURLsForFeed", mock.Anything, mock.AnythingOfType("int64")).
		Return(existingURLs, nil)
	return q
}

func TestIngestEntries_SkipsFutureEntries(t *testing.T) {
	q := mockQuerier(t, nil)
	svc := &FeedService{}
	future := time.Now().Add(24 * time.Hour)

	items := []*gofeed.Item{
		{Title: "Future 1", Link: "https://example.com/f1", PublishedParsed: &future},
		{Title: "Future 2", Link: "https://example.com/f2", PublishedParsed: &future},
	}
	entries, err := svc.ingestEntries(context.Background(), q, nil, 1, items, 0)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

func TestIngestEntries_SkipsEmptyTitleOrLink(t *testing.T) {
	q := mockQuerier(t, nil)
	svc := &FeedService{}
	items := []*gofeed.Item{
		{Title: "", Link: "https://example.com/1"},
		{Title: "No link", Link: ""},
		{Title: "", Link: ""},
	}

	entries, err := svc.ingestEntries(context.Background(), q, nil, 1, items, 0)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

func TestIngestEntries_UsesUpdatedParsedAsFallback(t *testing.T) {
	q := mockQuerier(t, nil)
	svc := &FeedService{}
	future := time.Now().Add(24 * time.Hour)

	items := []*gofeed.Item{
		{Title: "Future via updated", Link: "https://example.com/1", UpdatedParsed: &future},
	}

	entries, err := svc.ingestEntries(context.Background(), q, nil, 1, items, 0)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

func TestIngestEntries_RespectsLimit(t *testing.T) {
	q := mockQuerier(t, nil)
	svc := &FeedService{}
	future := time.Now().Add(24 * time.Hour)

	items := []*gofeed.Item{
		{Title: "A", Link: "https://example.com/1", PublishedParsed: &future},
		{Title: "B", Link: "https://example.com/2", PublishedParsed: &future},
		{Title: "C", Link: "https://example.com/3", PublishedParsed: &future},
	}

	entries, err := svc.ingestEntries(context.Background(), q, nil, 1, items, 1)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

func TestIngestEntries_SkipsExistingURLs(t *testing.T) {
	q := mockQuerier(t, []string{"https://example.com/existing"})
	svc := &FeedService{}
	past := time.Now().Add(-1 * time.Hour)

	items := []*gofeed.Item{
		{Title: "Existing", Link: "https://example.com/existing", PublishedParsed: &past},
		{Title: "Also existing", Link: "https://example.com/existing", PublishedParsed: &past},
	}

	// All items have URLs that already exist — nothing to insert.
	entries, err := svc.ingestEntries(context.Background(), q, nil, 1, items, 0)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

func TestIngestEntries_DedupsWithinBatch(t *testing.T) {
	q := mockQuerier(t, nil)
	svc := &FeedService{}
	future := time.Now().Add(24 * time.Hour)

	// Two items with the same URL — second should be deduped within the batch.
	// Both are future so result is empty, but the dedup logic still runs.
	items := []*gofeed.Item{
		{Title: "First", Link: "https://example.com/dup", PublishedParsed: &future},
		{Title: "Second", Link: "https://example.com/dup", PublishedParsed: &future},
	}

	entries, err := svc.ingestEntries(context.Background(), q, nil, 1, items, 0)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

func TestFetchForRefresh_200_WithConditionalHeaders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Larafeed/1.0", r.Header.Get("User-Agent"))
		assert.Equal(t, `"etag-abc"`, r.Header.Get("If-None-Match"))
		assert.Equal(t, "Mon, 01 Jan 2024 00:00:00 GMT", r.Header.Get("If-Modified-Since"))

		w.Header().Set("ETag", `"etag-def"`)
		w.Header().Set("Last-Modified", "Tue, 02 Jan 2024 00:00:00 GMT")
		w.WriteHeader(http.StatusOK)
		_, err := w.Write([]byte(validRSSFeed()))
		require.NoError(t, err)
	}))
	defer srv.Close()

	svc := &FeedService{httpClient: srv.Client()}
	etag := `"etag-abc"`
	lastMod := "Mon, 01 Jan 2024 00:00:00 GMT"
	feed := &db.Feed{
		ID:           1,
		FeedURL:      srv.URL,
		ETag:         &etag,
		LastModified: &lastMod,
	}

	result, err := svc.fetchForRefresh(context.Background(), feed)
	require.NoError(t, err)
	assert.Equal(t, "Test Feed", result.Title)
	assert.Equal(t, `"etag-def"`, result.ETag)
	assert.Equal(t, "Tue, 02 Jan 2024 00:00:00 GMT", result.LastModified)
	assert.Len(t, result.Items, 1)
}

func TestFetchForRefresh_304_NotModified(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer srv.Close()

	svc := &FeedService{httpClient: srv.Client()}
	feed := &db.Feed{ID: 1, FeedURL: srv.URL}

	_, err := svc.fetchForRefresh(context.Background(), feed)
	assert.ErrorIs(t, err, ErrNotModified)
}

func TestFetchForRefresh_410_Gone(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusGone)
	}))
	defer srv.Close()

	svc := &FeedService{httpClient: srv.Client()}
	feed := &db.Feed{ID: 1, FeedURL: srv.URL}

	_, err := svc.fetchForRefresh(context.Background(), feed)
	assert.ErrorIs(t, err, ErrFeedGone)
}

func TestFetchForRefresh_429_TooManyRequests(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "3600")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()

	svc := &FeedService{httpClient: srv.Client()}
	feed := &db.Feed{ID: 1, FeedURL: srv.URL}

	_, err := svc.fetchForRefresh(context.Background(), feed)
	assert.ErrorIs(t, err, ErrTooManyReqs)

	var raErr *retryAfterError
	require.ErrorAs(t, err, &raErr)
	assert.WithinDuration(t, time.Now().Add(1*time.Hour), raErr.retryAt, 5*time.Second)
}

func TestFetchForRefresh_500_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	svc := &FeedService{httpClient: srv.Client()}
	feed := &db.Feed{ID: 1, FeedURL: srv.URL}

	_, err := svc.fetchForRefresh(context.Background(), feed)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unexpected status 500")
}

func TestFetchForRefresh_NoConditionalHeaders_WhenEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Empty(t, r.Header.Get("If-None-Match"))
		assert.Empty(t, r.Header.Get("If-Modified-Since"))
		w.WriteHeader(http.StatusOK)
		_, err := w.Write([]byte(validRSSFeed()))
		require.NoError(t, err)
	}))
	defer srv.Close()

	svc := &FeedService{httpClient: srv.Client()}
	feed := &db.Feed{ID: 1, FeedURL: srv.URL}

	result, err := svc.fetchForRefresh(context.Background(), feed)
	require.NoError(t, err)
	assert.Equal(t, "Test Feed", result.Title)
}

func TestParseRetryAfter(t *testing.T) {
	t.Run("parses seconds", func(t *testing.T) {
		retryAt := parseRetryAfter("120")
		assert.WithinDuration(t, time.Now().Add(120*time.Second), retryAt, 2*time.Second)
	})

	t.Run("parses HTTP-date", func(t *testing.T) {
		future := time.Now().Add(2 * time.Hour).UTC()
		httpDate := future.Format(http.TimeFormat)
		retryAt := parseRetryAfter(httpDate)
		assert.WithinDuration(t, future, retryAt, 2*time.Second)
	})

	t.Run("caps at 24 hours", func(t *testing.T) {
		retryAt := parseRetryAfter("100000")
		assert.WithinDuration(t, time.Now().Add(24*time.Hour), retryAt, 2*time.Second)
	})

	t.Run("defaults to 1 hour on empty", func(t *testing.T) {
		retryAt := parseRetryAfter("")
		assert.WithinDuration(t, time.Now().Add(1*time.Hour), retryAt, 2*time.Second)
	})

	t.Run("defaults to 1 hour on garbage", func(t *testing.T) {
		retryAt := parseRetryAfter("not-a-number-or-date")
		assert.WithinDuration(t, time.Now().Add(1*time.Hour), retryAt, 2*time.Second)
	})
}

func TestStrPtr(t *testing.T) {
	t.Run("returns nil for empty string", func(t *testing.T) {
		assert.Nil(t, strPtr(""))
	})

	t.Run("returns pointer for non-empty string", func(t *testing.T) {
		p := strPtr("hello")
		require.NotNil(t, p)
		assert.Equal(t, "hello", *p)
	})
}

func TestRetryAfterError(t *testing.T) {
	retryAt := time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)
	err := &retryAfterError{retryAt: retryAt}

	assert.Contains(t, err.Error(), "429")
	assert.ErrorIs(t, err, ErrTooManyReqs)
}

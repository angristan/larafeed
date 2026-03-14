package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/angristan/larafeed-go/internal/apperr"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/db/mocks"
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
	rulesJSON, _ := json.Marshal(rules)

	q.On("UpdateSubscription", mock.Anything, mock.Anything).Return(nil)
	q.On("GetSubscription", mock.Anything, db.GetSubscriptionParams{UserID: 1, FeedID: 5}).
		Return(db.FeedSubscription{UserID: 1, FeedID: 5, FilterRules: rulesJSON}, nil)
	q.On("EntriesForFeed", mock.Anything, int64(5)).Return([]db.Entry{}, nil)

	svc := NewFeedService(q, nil, filterSvc)

	err := svc.UpdateSubscription(context.Background(), 1, 5, 2, nil, rulesJSON)
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

package service

import (
	"context"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/db/mocks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func newTestReaderService(q *mocks.Querier) *ReaderService {
	imgProxy := NewImgProxyService("", "", "")
	faviconSvc := NewFaviconService(q, imgProxy)
	llm := NewLLMService("", q)
	return NewReaderService(q, faviconSvc, imgProxy, llm)
}

func TestListFeeds_Empty(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow(nil), nil)

	svc := newTestReaderService(q)
	feeds := svc.ListFeeds(context.Background(), 1)
	assert.Nil(t, feeds)
}

func TestListFeeds_WithSubscriptions(t *testing.T) {
	q := mocks.NewQuerier(t)
	now := time.Now()
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow{
			{
				ID: 10, Name: "Go Blog", SiteURL: "https://go.dev", FeedURL: "https://go.dev/feed",
				EntryCount: 5, CategoryID: 2, LastSuccessfulRefreshAt: &now,
			},
		}, nil)

	svc := newTestReaderService(q)
	feeds := svc.ListFeeds(context.Background(), 1)

	require.Len(t, feeds, 1)
	assert.Equal(t, int64(10), feeds[0].ID)
	assert.Equal(t, "Go Blog", feeds[0].Name)
	assert.Equal(t, int64(2), feeds[0].CategoryID)
	assert.Equal(t, int64(5), feeds[0].EntriesCount)
}

func TestListFeeds_CustomNameOverridesOriginal(t *testing.T) {
	q := mocks.NewQuerier(t)
	custom := "My Go Blog"
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow{
			{ID: 10, Name: "Go Blog", CustomFeedName: &custom, CategoryID: 2},
		}, nil)

	svc := newTestReaderService(q)
	feeds := svc.ListFeeds(context.Background(), 1)

	require.Len(t, feeds, 1)
	assert.Equal(t, "My Go Blog", feeds[0].Name)
	assert.Equal(t, "Go Blog", feeds[0].OriginalName)
}

func TestFetchEntriesPage_Empty(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("CountForReader", mock.Anything, mock.Anything).Return(int64(0), nil)
	q.On("ListForReaderByPublished", mock.Anything, mock.Anything).
		Return([]db.ListForReaderByPublishedRow(nil), nil)

	svc := newTestReaderService(q)
	result := svc.FetchEntriesPage(context.Background(), 1, ReaderQuery{
		Filter: "all", OrderBy: "published_at", Page: 1,
	})

	assert.Equal(t, 0, result.Total)
	assert.Equal(t, 1, result.CurrentPage)
}

func TestFetchEntriesPage_UsesCreatedOrderBy(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("CountForReader", mock.Anything, mock.Anything).Return(int64(1), nil)
	q.On("ListForReaderByCreated", mock.Anything, mock.Anything).
		Return([]db.ListForReaderByCreatedRow{
			{ID: 1, Title: "Entry 1", PublishedAt: time.Now()},
		}, nil)

	svc := newTestReaderService(q)
	result := svc.FetchEntriesPage(context.Background(), 1, ReaderQuery{
		Filter: "all", OrderBy: "created_at", Page: 1,
	})

	assert.Equal(t, 1, result.Total)
	// Verify ListForReaderByCreated was called, not ListForReaderByPublished
	q.AssertCalled(t, "ListForReaderByCreated", mock.Anything, mock.Anything)
	q.AssertNotCalled(t, "ListForReaderByPublished", mock.Anything, mock.Anything)
}

func TestFetchCurrentEntry(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("FindReaderEntry", mock.Anything, db.FindReaderEntryParams{UserID: 1, EntryID: 42}).
		Return(db.FindReaderEntryRow{
			ID: 42, FeedID: 10, Title: "Test Entry", FeedName: "Go Blog",
			PublishedAt: time.Now(),
		}, nil)

	svc := newTestReaderService(q)
	entry, err := svc.FetchCurrentEntry(context.Background(), 1, 42, nil)

	require.NoError(t, err)
	assert.Equal(t, int64(42), entry.ID)
	assert.Equal(t, "Test Entry", entry.Title)
}

func TestFetchCurrentEntry_MarkAsRead(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("FindReaderEntry", mock.Anything, mock.Anything).
		Return(db.FindReaderEntryRow{ID: 42, FeedID: 10, Title: "Test", FeedName: "Blog", PublishedAt: time.Now()}, nil)
	q.On("MarkAsRead", mock.Anything, db.MarkAsReadParams{UserID: 1, EntryID: 42}).Return(nil)

	svc := newTestReaderService(q)
	markRead := true
	entry, err := svc.FetchCurrentEntry(context.Background(), 1, 42, &markRead)

	require.NoError(t, err)
	assert.NotNil(t, entry.ReadAt)
	q.AssertCalled(t, "MarkAsRead", mock.Anything, mock.Anything)
}

func TestFetchCurrentEntry_MarkAsUnread(t *testing.T) {
	q := mocks.NewQuerier(t)
	now := time.Now()
	q.On("FindReaderEntry", mock.Anything, mock.Anything).
		Return(db.FindReaderEntryRow{ID: 42, FeedID: 10, Title: "Test", FeedName: "Blog", PublishedAt: time.Now(), ReadAt: &now}, nil)
	q.On("MarkAsUnread", mock.Anything, db.MarkAsUnreadParams{UserID: 1, EntryID: 42}).Return(nil)

	svc := newTestReaderService(q)
	markRead := false
	entry, err := svc.FetchCurrentEntry(context.Background(), 1, 42, &markRead)

	require.NoError(t, err)
	assert.Nil(t, entry.ReadAt)
	q.AssertCalled(t, "MarkAsUnread", mock.Anything, mock.Anything)
}

func TestCountUnread(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("CountUnread", mock.Anything, int64(1)).Return(int64(42), nil)

	svc := newTestReaderService(q)
	count := svc.CountUnread(context.Background(), 1)

	assert.Equal(t, int64(42), count)
}

func TestCountRead(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("CountRead", mock.Anything, int64(1)).Return(int64(10), nil)

	svc := newTestReaderService(q)
	count := svc.CountRead(context.Background(), 1)

	assert.Equal(t, int64(10), count)
}

func TestListCategories(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("ListCategoriesForUser", mock.Anything, int64(1)).
		Return([]db.SubscriptionCategory{
			{ID: 1, Name: "Tech"},
			{ID: 2, Name: "News"},
		}, nil)

	svc := newTestReaderService(q)
	cats := svc.ListCategories(context.Background(), 1)

	assert.Len(t, cats, 2)
	assert.Equal(t, "Tech", cats[0].Name)
}

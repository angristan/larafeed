package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/db/mocks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func newTestSubscriptionService(t *testing.T, q *mocks.Querier) *SubscriptionService {
	t.Helper()
	imgProxy, err := NewImgProxyService("", "", "")
	require.NoError(t, err)
	faviconSvc := NewFaviconService(q, imgProxy)
	return NewSubscriptionService(q, faviconSvc)
}

func TestListSubscriptions_Empty(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow(nil), nil)

	svc := newTestSubscriptionService(t, q)
	feeds, err := svc.ListSubscriptions(context.Background(), 1)
	require.NoError(t, err)
	assert.Empty(t, feeds)
}

func TestListSubscriptions_CustomNameOverride(t *testing.T) {
	q := mocks.NewQuerier(t)
	custom := "My Blog"
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow{
			{ID: 10, Name: "Original Blog", CustomFeedName: &custom, FeedURL: "https://example.com/feed", SiteURL: "https://example.com", CategoryID: 1, CategoryName: "Tech"},
		}, nil)
	q.On("ListFeedRefreshes", mock.Anything, int64(10)).
		Return([]db.FeedRefresh(nil), nil)

	svc := newTestSubscriptionService(t, q)
	feeds, err := svc.ListSubscriptions(context.Background(), 1)
	require.NoError(t, err)
	require.Len(t, feeds, 1)
	assert.Equal(t, "My Blog", feeds[0].Name)
	assert.Equal(t, "Original Blog", feeds[0].OriginalName)
}

func TestListSubscriptions_OriginalNameWhenNoCustom(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow{
			{ID: 10, Name: "Go Blog", FeedURL: "https://go.dev/feed", SiteURL: "https://go.dev", CategoryID: 1, CategoryName: "Tech"},
		}, nil)
	q.On("ListFeedRefreshes", mock.Anything, int64(10)).
		Return([]db.FeedRefresh(nil), nil)

	svc := newTestSubscriptionService(t, q)
	feeds, err := svc.ListSubscriptions(context.Background(), 1)
	require.NoError(t, err)
	require.Len(t, feeds, 1)
	assert.Equal(t, "Go Blog", feeds[0].Name)
	assert.Equal(t, "Go Blog", feeds[0].OriginalName)
}

func TestListSubscriptions_RefreshHistory(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow{
			{ID: 10, Name: "Blog", FeedURL: "https://example.com/feed", SiteURL: "https://example.com", CategoryID: 1, CategoryName: "Tech"},
		}, nil)

	refreshTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	entriesCreated := 3
	q.On("ListFeedRefreshes", mock.Anything, int64(10)).
		Return([]db.FeedRefresh{
			{ID: 1, FeedID: 10, RefreshedAt: refreshTime, WasSuccessful: true, EntriesCreated: &entriesCreated},
		}, nil)

	svc := newTestSubscriptionService(t, q)
	feeds, err := svc.ListSubscriptions(context.Background(), 1)
	require.NoError(t, err)
	require.Len(t, feeds, 1)
	require.Len(t, feeds[0].Refreshes, 1)
	assert.True(t, feeds[0].Refreshes[0].WasSuccessful)
	require.NotNil(t, feeds[0].Refreshes[0].RefreshedAt)
	assert.Equal(t, refreshTime.Format(time.RFC3339), *feeds[0].Refreshes[0].RefreshedAt)
	assert.Equal(t, 3, *feeds[0].Refreshes[0].EntriesCreated)
}

func TestListSubscriptions_LastRefreshTimestamps(t *testing.T) {
	q := mocks.NewQuerier(t)
	success := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	failure := time.Date(2024, 6, 14, 10, 0, 0, 0, time.UTC)
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow{
			{ID: 10, Name: "Blog", FeedURL: "https://example.com/feed", SiteURL: "https://example.com",
				CategoryID: 1, CategoryName: "Tech",
				LastSuccessfulRefreshAt: &success, LastFailedRefreshAt: &failure},
		}, nil)
	q.On("ListFeedRefreshes", mock.Anything, int64(10)).
		Return([]db.FeedRefresh(nil), nil)

	svc := newTestSubscriptionService(t, q)
	feeds, err := svc.ListSubscriptions(context.Background(), 1)
	require.NoError(t, err)
	require.Len(t, feeds, 1)
	require.NotNil(t, feeds[0].LastSuccessfulRefreshAt)
	assert.Equal(t, success.Format(time.RFC3339), *feeds[0].LastSuccessfulRefreshAt)
	require.NotNil(t, feeds[0].LastFailedRefreshAt)
	assert.Equal(t, failure.Format(time.RFC3339), *feeds[0].LastFailedRefreshAt)
}

func TestListSubscriptions_NilTimestamps(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow{
			{ID: 10, Name: "Blog", FeedURL: "https://example.com/feed", SiteURL: "https://example.com", CategoryID: 1, CategoryName: "Tech"},
		}, nil)
	q.On("ListFeedRefreshes", mock.Anything, int64(10)).
		Return([]db.FeedRefresh(nil), nil)

	svc := newTestSubscriptionService(t, q)
	feeds, err := svc.ListSubscriptions(context.Background(), 1)
	require.NoError(t, err)
	require.Len(t, feeds, 1)
	assert.Nil(t, feeds[0].LastSuccessfulRefreshAt)
	assert.Nil(t, feeds[0].LastFailedRefreshAt)
}

func TestListSubscriptions_FaviconURL(t *testing.T) {
	q := mocks.NewQuerier(t)
	favicon := "https://example.com/favicon.ico"
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow{
			{ID: 10, Name: "Blog", FeedURL: "https://example.com/feed", SiteURL: "https://example.com", FaviconURL: &favicon, CategoryID: 1, CategoryName: "Tech"},
		}, nil)
	q.On("ListFeedRefreshes", mock.Anything, int64(10)).
		Return([]db.FeedRefresh(nil), nil)

	svc := newTestSubscriptionService(t, q)
	feeds, err := svc.ListSubscriptions(context.Background(), 1)
	require.NoError(t, err)
	require.Len(t, feeds, 1)
	// With imgproxy disabled, the URL passes through
	assert.NotEmpty(t, feeds[0].FaviconURL)
}

func TestListSubscriptions_ErrorPropagated(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
		Return([]db.ListSubscriptionsForUserRow(nil), fmt.Errorf("db error"))

	svc := newTestSubscriptionService(t, q)
	_, err := svc.ListSubscriptions(context.Background(), 1)
	assert.Error(t, err)
}

func TestListCategories_Success(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("ListCategoriesForUser", mock.Anything, int64(1)).
		Return([]db.SubscriptionCategory{
			{ID: 1, Name: "Tech"},
			{ID: 2, Name: "News"},
		}, nil)

	svc := newTestSubscriptionService(t, q)
	cats, err := svc.ListCategories(context.Background(), 1)
	require.NoError(t, err)
	assert.Len(t, cats, 2)
}

func TestListCategories_ErrorPropagated(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("ListCategoriesForUser", mock.Anything, int64(1)).
		Return([]db.SubscriptionCategory(nil), fmt.Errorf("db error"))

	svc := newTestSubscriptionService(t, q)
	_, err := svc.ListCategories(context.Background(), 1)
	assert.Error(t, err)
}

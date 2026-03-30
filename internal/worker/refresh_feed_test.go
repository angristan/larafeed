package worker

import (
	"context"
	"fmt"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// mockFeedFinder implements feedFinder for testing.
type mockFeedFinder struct {
	mock.Mock
}

func (m *mockFeedFinder) FindFeedByID(ctx context.Context, feedID int64) (db.Feed, error) {
	args := m.Called(ctx, feedID)
	return args.Get(0).(db.Feed), args.Error(1)
}

// mockFeedRefresher implements feedRefresher for testing.
type mockFeedRefresher struct {
	mock.Mock
}

func (m *mockFeedRefresher) RefreshFeed(ctx context.Context, feed *db.Feed) (int, error) {
	args := m.Called(ctx, feed)
	return args.Int(0), args.Error(1)
}

func newRefreshFeedJob(feedID int64) *river.Job[RefreshFeedArgs] {
	return &river.Job[RefreshFeedArgs]{
		JobRow: &rivertype.JobRow{ID: 1},
		Args:   RefreshFeedArgs{FeedID: feedID},
	}
}

func TestRefreshFeedWorker_FeedNotFound(t *testing.T) {
	finder := &mockFeedFinder{}
	refresher := &mockFeedRefresher{}
	finder.On("FindFeedByID", mock.Anything, int64(42)).
		Return(db.Feed{}, fmt.Errorf("no rows"))

	w := &RefreshFeedWorker{finder: finder, refresher: refresher}
	err := w.Work(context.Background(), newRefreshFeedJob(42))

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "find feed 42")
	refresher.AssertNotCalled(t, "RefreshFeed", mock.Anything, mock.Anything)
}

func TestRefreshFeedWorker_RefreshSuccess(t *testing.T) {
	finder := &mockFeedFinder{}
	refresher := &mockFeedRefresher{}
	feed := db.Feed{ID: 42, FeedURL: "https://example.com/feed"}
	finder.On("FindFeedByID", mock.Anything, int64(42)).Return(feed, nil)
	refresher.On("RefreshFeed", mock.Anything, &feed).Return(5, nil)

	w := &RefreshFeedWorker{finder: finder, refresher: refresher}
	err := w.Work(context.Background(), newRefreshFeedJob(42))

	assert.NoError(t, err)
	refresher.AssertCalled(t, "RefreshFeed", mock.Anything, &feed)
}

func TestRefreshFeedWorker_RefreshFails_ReturnsNil(t *testing.T) {
	finder := &mockFeedFinder{}
	refresher := &mockFeedRefresher{}
	feed := db.Feed{ID: 42, FeedURL: "https://example.com/feed"}
	finder.On("FindFeedByID", mock.Anything, int64(42)).Return(feed, nil)
	refresher.On("RefreshFeed", mock.Anything, &feed).Return(0, fmt.Errorf("network error"))

	w := &RefreshFeedWorker{finder: finder, refresher: refresher}
	err := w.Work(context.Background(), newRefreshFeedJob(42))

	// Worker swallows refresh errors (no retry) — errors are recorded in feed_refreshes
	assert.NoError(t, err)
}

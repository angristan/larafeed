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

// mockFaviconRefresher implements faviconRefresher for testing.
type mockFaviconRefresher struct {
	mock.Mock
}

func (m *mockFaviconRefresher) RefreshFavicon(ctx context.Context, feed *db.Feed) error {
	args := m.Called(ctx, feed)
	return args.Error(0)
}

func newRefreshFaviconJob(feedID int64) *river.Job[RefreshFaviconArgs] {
	return &river.Job[RefreshFaviconArgs]{
		JobRow: &rivertype.JobRow{ID: 1},
		Args:   RefreshFaviconArgs{FeedID: feedID},
	}
}

func TestRefreshFaviconWorker_FeedNotFound(t *testing.T) {
	finder := &mockFeedFinder{}
	refresher := &mockFaviconRefresher{}
	finder.On("FindFeedByID", mock.Anything, int64(42)).
		Return(db.Feed{}, fmt.Errorf("no rows"))

	w := &RefreshFaviconWorker{finder: finder, refresher: refresher}
	err := w.Work(context.Background(), newRefreshFaviconJob(42))

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "find feed 42")
	refresher.AssertNotCalled(t, "RefreshFavicon", mock.Anything, mock.Anything)
}

func TestRefreshFaviconWorker_Success(t *testing.T) {
	finder := &mockFeedFinder{}
	refresher := &mockFaviconRefresher{}
	feed := db.Feed{ID: 42, FeedURL: "https://example.com/feed"}
	finder.On("FindFeedByID", mock.Anything, int64(42)).Return(feed, nil)
	refresher.On("RefreshFavicon", mock.Anything, &feed).Return(nil)

	w := &RefreshFaviconWorker{finder: finder, refresher: refresher}
	err := w.Work(context.Background(), newRefreshFaviconJob(42))

	assert.NoError(t, err)
	refresher.AssertCalled(t, "RefreshFavicon", mock.Anything, &feed)
}

func TestRefreshFaviconWorker_RefreshError_Propagated(t *testing.T) {
	finder := &mockFeedFinder{}
	refresher := &mockFaviconRefresher{}
	feed := db.Feed{ID: 42, FeedURL: "https://example.com/feed"}
	finder.On("FindFeedByID", mock.Anything, int64(42)).Return(feed, nil)
	refresher.On("RefreshFavicon", mock.Anything, &feed).Return(fmt.Errorf("download failed"))

	w := &RefreshFaviconWorker{finder: finder, refresher: refresher}
	err := w.Work(context.Background(), newRefreshFaviconJob(42))

	// Favicon refresh errors are propagated for River retry
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "refresh favicon for feed 42")
}

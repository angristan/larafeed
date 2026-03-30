package worker

import (
	"context"
	"fmt"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/logging"
	"github.com/riverqueue/river"
)

// RefreshFaviconArgs are the arguments for the RefreshFavicon job.
type RefreshFaviconArgs struct {
	FeedID int64 `json:"feed_id"`
}

func (RefreshFaviconArgs) Kind() string { return "refresh_favicon" }

// faviconRefresher refreshes a feed's favicon (satisfied by *service.FaviconService).
type faviconRefresher interface {
	RefreshFavicon(ctx context.Context, feed *db.Feed) error
}

// RefreshFaviconWorker processes favicon refresh jobs.
type RefreshFaviconWorker struct {
	river.WorkerDefaults[RefreshFaviconArgs]
	finder    feedFinder
	refresher faviconRefresher
}

func (w *RefreshFaviconWorker) Work(ctx context.Context, job *river.Job[RefreshFaviconArgs]) error {
	ctx = logging.WithRequestID(ctx, fmt.Sprintf("job-%d", job.ID))
	ctx, span := startJobSpan(ctx, "refresh_favicon", job.ID)
	defer span.End()

	feed, err := w.finder.FindFeedByID(ctx, job.Args.FeedID)
	if err != nil {
		return fmt.Errorf("find feed %d: %w", job.Args.FeedID, err)
	}

	err = w.refresher.RefreshFavicon(ctx, &feed)
	if err != nil {
		return fmt.Errorf("refresh favicon for feed %d: %w", feed.ID, err)
	}

	return nil
}

package worker

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/logging"
	"github.com/riverqueue/river"
)

// RefreshFeedArgs are the arguments for the RefreshFeed job.
type RefreshFeedArgs struct {
	FeedID int64 `json:"feed_id"`
}

func (RefreshFeedArgs) Kind() string { return "refresh_feed" }

// feedFinder finds a feed by ID (satisfied by *db.Queries).
type feedFinder interface {
	FindFeedByID(ctx context.Context, feedID int64) (db.Feed, error)
}

// feedRefresher refreshes a feed (satisfied by *service.FeedService).
type feedRefresher interface {
	RefreshFeed(ctx context.Context, feed *db.Feed) (int, error)
}

// RefreshFeedWorker processes feed refresh jobs.
type RefreshFeedWorker struct {
	river.WorkerDefaults[RefreshFeedArgs]
	finder    feedFinder
	refresher feedRefresher
}

func (w *RefreshFeedWorker) Work(ctx context.Context, job *river.Job[RefreshFeedArgs]) error {
	ctx = logging.WithRequestID(ctx, fmt.Sprintf("job-%d", job.ID))
	ctx, span := startJobSpan(ctx, "refresh_feed", job.ID)
	defer span.End()

	feed, err := w.finder.FindFeedByID(ctx, job.Args.FeedID)
	if err != nil {
		return fmt.Errorf("find feed %d: %w", job.Args.FeedID, err)
	}

	newCount, err := w.refresher.RefreshFeed(ctx, &feed)
	if err != nil {
		slog.ErrorContext(ctx, "failed to refresh feed", "feed_id", feed.ID, "feed_url", feed.FeedURL, "error", err)
		return nil // Don't retry — errors are recorded in feed_refreshes
	}

	if newCount > 0 {
		slog.InfoContext(ctx, "refreshed feed", "feed_id", feed.ID, "feed_url", feed.FeedURL, "new_entries", newCount)
	}
	return nil
}

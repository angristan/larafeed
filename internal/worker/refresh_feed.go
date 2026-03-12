package worker

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/riverqueue/river"
)

// RefreshFeedArgs are the arguments for the RefreshFeed job.
type RefreshFeedArgs struct {
	FeedID int64 `json:"feed_id"`
}

func (RefreshFeedArgs) Kind() string { return "refresh_feed" }

// RefreshFeedWorker processes feed refresh jobs.
type RefreshFeedWorker struct {
	river.WorkerDefaults[RefreshFeedArgs]
	feedService *service.FeedService
	q           *db.Queries
}

func (w *RefreshFeedWorker) Work(ctx context.Context, job *river.Job[RefreshFeedArgs]) error {
	feed, err := w.q.FindFeedByID(ctx, job.Args.FeedID)
	if err != nil {
		return fmt.Errorf("find feed %d: %w", job.Args.FeedID, err)
	}

	newCount, err := w.feedService.RefreshFeed(ctx, &feed)
	if err != nil {
		slog.Error("failed to refresh feed", "feed_id", feed.ID, "feed_url", feed.FeedURL, "error", err)
		return nil // Don't retry — errors are recorded in feed_refreshes
	}

	if newCount > 0 {
		slog.Info("refreshed feed", "feed_id", feed.ID, "feed_url", feed.FeedURL, "new_entries", newCount)
	}
	return nil
}

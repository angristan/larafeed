package worker

import (
	"context"
	"fmt"
	"log"

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
		log.Printf("Failed to refresh feed %d (%s): %v", feed.ID, feed.FeedURL, err)
		return nil // Don't retry — errors are recorded in feed_refreshes
	}

	if newCount > 0 {
		log.Printf("Refreshed feed %d (%s): %d new entries", feed.ID, feed.FeedURL, newCount)
	}
	return nil
}

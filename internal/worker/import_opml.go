package worker

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/logging"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// ImportOPMLFeedArgs creates a single feed from an OPML import.
type ImportOPMLFeedArgs struct {
	UserID       int64  `json:"user_id"`
	FeedURL      string `json:"feed_url"`
	CategoryID   int64  `json:"category_id"`
	FallbackName string `json:"fallback_name"`
}

func (ImportOPMLFeedArgs) Kind() string { return "import_opml_feed" }

// ImportOPMLWorker processes individual feed creation from OPML imports.
type ImportOPMLWorker struct {
	river.WorkerDefaults[ImportOPMLFeedArgs]
	feedService    *service.FeedService
	faviconService *service.FaviconService
	q              *db.Queries
	pool           *pgxpool.Pool
}

func (w *ImportOPMLWorker) Work(ctx context.Context, job *river.Job[ImportOPMLFeedArgs]) error {
	ctx = logging.WithRequestID(ctx, fmt.Sprintf("job-%d", job.ID))
	ctx, span := startJobSpan(ctx, "import_opml_feed", job.ID)
	defer span.End()
	args := job.Args

	feed, err := w.feedService.CreateFeed(ctx, args.UserID, args.FeedURL, args.CategoryID, args.FallbackName)
	if err != nil {
		slog.ErrorContext(ctx, "OPML import: failed to create feed", "feed_url", args.FeedURL, "error", err)
		return nil // Don't retry — log and move on
	}

	// Enqueue favicon refresh for the new feed
	client, err := river.NewClient(riverpgxv5.New(w.pool), &river.Config{})
	if err != nil {
		return nil
	}

	_, _ = client.Insert(ctx, RefreshFaviconArgs{FeedID: feed.ID}, &river.InsertOpts{
		UniqueOpts: river.UniqueOpts{
			ByArgs:   true,
			ByPeriod: 1 * time.Hour,
		},
	})

	return nil
}

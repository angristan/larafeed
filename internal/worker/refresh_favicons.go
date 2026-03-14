package worker

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/logging"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// RefreshStaleFaviconsArgs triggers periodic favicon refresh for outdated favicons.
type RefreshStaleFaviconsArgs struct{}

func (RefreshStaleFaviconsArgs) Kind() string { return "refresh_stale_favicons" }

// RefreshStaleFaviconsWorker enqueues favicon refresh jobs for feeds with outdated or missing favicons.
type RefreshStaleFaviconsWorker struct {
	river.WorkerDefaults[RefreshStaleFaviconsArgs]
	q    *db.Queries
	pool *pgxpool.Pool
}

func (w *RefreshStaleFaviconsWorker) Work(ctx context.Context, job *river.Job[RefreshStaleFaviconsArgs]) error {
	ctx = logging.WithRequestID(ctx, fmt.Sprintf("job-%d", job.ID))
	ctx, span := startJobSpan(ctx, "refresh_stale_favicons", job.ID)
	defer span.End()

	// Refresh favicons older than 30 days or missing
	feeds, err := w.q.FeedsWithOutdatedFavicons(ctx, pgtype.Interval{
		Microseconds: int64(30 * 24 * time.Hour / time.Microsecond),
		Valid:        true,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get feeds with outdated favicons", "error", err)
		return nil
	}

	if len(feeds) == 0 {
		return nil
	}

	// Limit to 1 per run to avoid overloading
	limit := 1
	if len(feeds) < limit {
		limit = len(feeds)
	}
	feeds = feeds[:limit]

	client, err := river.NewClient(riverpgxv5.New(w.pool), &river.Config{})
	if err != nil {
		return err
	}

	for _, feed := range feeds {
		_, err := client.Insert(ctx, RefreshFaviconArgs{FeedID: feed.ID}, &river.InsertOpts{
			UniqueOpts: river.UniqueOpts{
				ByArgs:   true,
				ByPeriod: 1 * time.Hour,
			},
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to enqueue favicon refresh", "feed_id", feed.ID, "error", err)
		}
	}

	slog.InfoContext(ctx, "enqueued favicon refresh", "count", limit)
	return nil
}

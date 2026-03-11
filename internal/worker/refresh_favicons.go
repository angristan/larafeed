package worker

import (
	"context"
	"log"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
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
	// Refresh favicons older than 30 days or missing
	feeds, err := w.q.FeedsWithOutdatedFavicons(ctx, pgtype.Interval{
		Microseconds: int64(30 * 24 * time.Hour / time.Microsecond),
		Valid:        true,
	})
	if err != nil {
		log.Printf("Failed to get feeds with outdated favicons: %v", err)
		return nil
	}

	if len(feeds) == 0 {
		return nil
	}

	// Limit to 5 per run to avoid overloading
	limit := 5
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
			log.Printf("Failed to enqueue favicon refresh for feed %d: %v", feed.ID, err)
		}
	}

	log.Printf("Enqueued favicon refresh for %d feeds", limit)
	return nil
}

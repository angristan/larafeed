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

// RefreshStaleFeedsArgs are the arguments for the periodic stale feed refresh.
type RefreshStaleFeedsArgs struct{}

func (RefreshStaleFeedsArgs) Kind() string { return "refresh_stale_feeds" }

// RefreshStaleFeedsWorker enqueues refresh jobs for feeds that are stale.
type RefreshStaleFeedsWorker struct {
	river.WorkerDefaults[RefreshStaleFeedsArgs]
	q    *db.Queries
	pool *pgxpool.Pool
}

func (w *RefreshStaleFeedsWorker) Work(ctx context.Context, job *river.Job[RefreshStaleFeedsArgs]) error {
	staleFeeds, err := w.q.FeedsNeedingRefresh(ctx, db.FeedsNeedingRefreshParams{
		StaleAfter: pgtype.Interval{Microseconds: int64(2 * time.Hour / time.Microsecond), Valid: true},
		MaxFeeds:   10,
	})
	if err != nil {
		log.Printf("Failed to get stale feeds: %v", err)
		return nil
	}

	if len(staleFeeds) == 0 {
		return nil
	}

	// Create an insert-only client to enqueue jobs
	client, err := river.NewClient(riverpgxv5.New(w.pool), &river.Config{})
	if err != nil {
		return err
	}

	for _, feed := range staleFeeds {
		_, err := client.Insert(ctx, RefreshFeedArgs{FeedID: feed.ID}, &river.InsertOpts{
			UniqueOpts: river.UniqueOpts{
				ByArgs:   true,
				ByPeriod: 30 * time.Minute,
			},
		})
		if err != nil {
			log.Printf("Failed to enqueue refresh for feed %d: %v", feed.ID, err)
		}
	}

	log.Printf("Enqueued refresh for %d stale feeds", len(staleFeeds))
	return nil
}

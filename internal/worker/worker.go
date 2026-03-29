package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("larafeed/worker")

func startJobSpan(ctx context.Context, jobKind string, jobID int64) (context.Context, trace.Span) {
	return tracer.Start(ctx, "worker."+jobKind,
		trace.WithAttributes(
			attribute.String("job.kind", jobKind),
			attribute.Int64("job.id", jobID),
		),
	)
}

// Setup creates and starts the River client with all workers and periodic jobs.
func Setup(ctx context.Context, pool *pgxpool.Pool, feedService *service.FeedService, faviconService *service.FaviconService, q *db.Queries) (*river.Client[pgx.Tx], error) {
	// Run River migrations
	driver := riverpgxv5.New(pool)
	migrator, err := rivermigrate.New(driver, nil)
	if err != nil {
		return nil, err
	}
	res, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil)
	if err != nil {
		return nil, err
	}
	for _, v := range res.Versions {
		slog.Info("river migration applied", "version", v.Version)
	}

	workers := river.NewWorkers()
	river.AddWorker(workers, &RefreshFeedWorker{feedService: feedService, q: q})
	river.AddWorker(workers, &RefreshFaviconWorker{faviconService: faviconService, q: q})
	river.AddWorker(workers, &RefreshStaleFeedsWorker{q: q, pool: pool})
	river.AddWorker(workers, &RefreshStaleFaviconsWorker{q: q, pool: pool})
	river.AddWorker(workers, &ImportOPMLWorker{feedService: feedService, faviconService: faviconService, q: q, pool: pool})

	periodicJobs := []*river.PeriodicJob{
		// Refresh stale feeds every 5 minutes
		river.NewPeriodicJob(
			river.PeriodicInterval(5*time.Minute),
			func() (river.JobArgs, *river.InsertOpts) {
				return RefreshStaleFeedsArgs{}, nil
			},
			&river.PeriodicJobOpts{RunOnStart: true},
		),
		// Refresh outdated/missing favicons every hour
		river.NewPeriodicJob(
			river.PeriodicInterval(1*time.Hour),
			func() (river.JobArgs, *river.InsertOpts) {
				return RefreshStaleFaviconsArgs{}, nil
			},
			nil,
		),
	}

	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues: map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: 5},
		},
		Workers:      workers,
		PeriodicJobs: periodicJobs,
	})
	if err != nil {
		return nil, err
	}

	err = client.Start(ctx)
	if err != nil {
		return nil, err
	}

	slog.Info("river worker started")
	return client, nil
}

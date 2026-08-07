-- Reconciliation starts from the small set of queued or failed refresh jobs
-- instead of scanning retained sent outbox history every Cron run.
CREATE INDEX jobs_feed_refresh_reconcile
    ON jobs(updated_at, id, available_at)
    WHERE kind = 'feed_refresh'
      AND state IN ('queued', 'failed');

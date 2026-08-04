-- Favicon refresh uses the shared durable job/outbox tables. One active job per
-- feed prevents Cron, feed refresh, and duplicate Queue delivery from creating
-- competing favicon transformations.
CREATE UNIQUE INDEX jobs_favicon_refresh_active_feed
    ON jobs(CAST(json_extract(payload_json, '$.feedId') AS INTEGER))
    WHERE kind = 'favicon_refresh'
      AND state IN ('pending', 'queued', 'running', 'failed');

-- Cron walks the oldest/null refresh generation first without sorting all feeds.
CREATE INDEX feeds_favicon_refresh_due
    ON feeds(COALESCE(favicon_updated_at, 0), id);

-- Reconcile duplicate active feed refreshes created before admission was
-- per-feed. Keep the most advanced/newest command and terminalize the rest.
UPDATE outbox_messages
SET state = 'dead_lettered',
    lease_owner = NULL,
    lease_expires_at = NULL,
    sent_at = NULL,
    last_error_class = 'duplicate_active_refresh',
    last_error_message = 'Superseded during per-feed admission migration'
WHERE job_id IN (
    SELECT id FROM (
        SELECT id,
            ROW_NUMBER() OVER (
                PARTITION BY CAST(json_extract(payload_json, '$.feedId') AS INTEGER)
                ORDER BY CASE state
                    WHEN 'running' THEN 0
                    WHEN 'queued' THEN 1
                    WHEN 'pending' THEN 2
                    ELSE 3
                END,
                updated_at DESC,
                id
            ) AS duplicate_rank
        FROM jobs
        WHERE kind = 'feed_refresh'
          AND state IN ('pending', 'queued', 'running', 'failed')
          AND json_type(payload_json, '$.feedId') = 'integer'
    ) ranked
    WHERE duplicate_rank > 1
);

UPDATE jobs
SET state = 'canceled',
    lease_owner = NULL,
    lease_expires_at = NULL,
    completed_at = updated_at,
    last_error_class = 'duplicate_active_refresh',
    last_error_message = 'Superseded during per-feed admission migration'
WHERE id IN (
    SELECT id FROM (
        SELECT id,
            ROW_NUMBER() OVER (
                PARTITION BY CAST(json_extract(payload_json, '$.feedId') AS INTEGER)
                ORDER BY CASE state
                    WHEN 'running' THEN 0
                    WHEN 'queued' THEN 1
                    WHEN 'pending' THEN 2
                    ELSE 3
                END,
                updated_at DESC,
                id
            ) AS duplicate_rank
        FROM jobs
        WHERE kind = 'feed_refresh'
          AND state IN ('pending', 'queued', 'running', 'failed')
          AND json_type(payload_json, '$.feedId') = 'integer'
    ) ranked
    WHERE duplicate_rank > 1
);

-- D1 serializes writes, and this index is the final race fence behind the
-- atomic NOT EXISTS admission query.
CREATE UNIQUE INDEX jobs_feed_refresh_active_feed
    ON jobs(CAST(json_extract(payload_json, '$.feedId') AS INTEGER))
    WHERE kind = 'feed_refresh'
      AND state IN ('pending', 'queued', 'running', 'failed');

CREATE INDEX jobs_terminal_completed
    ON jobs(completed_at, id)
    WHERE state IN ('succeeded', 'dead_lettered', 'canceled');

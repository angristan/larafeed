ALTER TABLE feeds
ADD COLUMN last_failed_refresh_at INTEGER
    CHECK (last_failed_refresh_at IS NULL OR last_failed_refresh_at >= 0);

UPDATE feeds
SET last_failed_refresh_at = (
    SELECT MAX(feed_refreshes.refreshed_at)
    FROM feed_refreshes
    WHERE feed_refreshes.feed_id = feeds.id
      AND feed_refreshes.was_successful = 0
);

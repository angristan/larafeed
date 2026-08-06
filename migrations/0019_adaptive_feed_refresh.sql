-- Successful refreshes slow down after repeated unchanged responses while
-- active feeds remain on the minimum interval. Publisher hints are retained
-- across 304 responses, and truncated entry windows never slow down.
ALTER TABLE feeds ADD COLUMN consecutive_unchanged_refreshes INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_unchanged_refreshes BETWEEN 0 AND 5);

ALTER TABLE feeds ADD COLUMN publisher_refresh_interval_ms INTEGER
    CHECK (
        publisher_refresh_interval_ms IS NULL
        OR publisher_refresh_interval_ms BETWEEN 1 AND 86400000
    );

ALTER TABLE feeds ADD COLUMN entry_window_truncated INTEGER NOT NULL DEFAULT 0
    CHECK (entry_window_truncated IN (0, 1));

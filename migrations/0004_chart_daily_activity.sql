-- Sparse forward-only activity aggregates for charts.
-- One row represents real state transitions for one user/feed/UTC day.
CREATE TABLE chart_daily_activity (
    user_id INTEGER NOT NULL,
    feed_id INTEGER NOT NULL,
    day_start INTEGER NOT NULL CHECK (day_start >= 0),
    marked_read_count INTEGER NOT NULL DEFAULT 0 CHECK (marked_read_count >= 0),
    marked_unread_count INTEGER NOT NULL DEFAULT 0 CHECK (marked_unread_count >= 0),
    saved_count INTEGER NOT NULL DEFAULT 0 CHECK (saved_count >= 0),
    unsaved_count INTEGER NOT NULL DEFAULT 0 CHECK (unsaved_count >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    PRIMARY KEY (user_id, feed_id, day_start),
    FOREIGN KEY (user_id, feed_id)
        REFERENCES feed_subscriptions(user_id, feed_id)
        ON DELETE CASCADE
) STRICT;

CREATE INDEX chart_daily_activity_user_day
    ON chart_daily_activity(user_id, day_start, feed_id);

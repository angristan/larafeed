-- Durable daily refresh aggregates preserve long-range charts while detailed
-- refresh history remains bounded.
CREATE TABLE chart_daily_refreshes (
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    day_start INTEGER NOT NULL CHECK (
        day_start >= 0 AND day_start % 86400000 = 0
    ),
    attempts_count INTEGER NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
    successes_count INTEGER NOT NULL DEFAULT 0 CHECK (successes_count >= 0),
    failures_count INTEGER NOT NULL DEFAULT 0 CHECK (failures_count >= 0),
    entries_created_count INTEGER NOT NULL DEFAULT 0
        CHECK (entries_created_count >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (attempts_count = successes_count + failures_count),
    PRIMARY KEY (feed_id, day_start)
) STRICT;

INSERT INTO chart_daily_refreshes (
    feed_id,
    day_start,
    attempts_count,
    successes_count,
    failures_count,
    entries_created_count,
    created_at,
    updated_at
)
SELECT
    feed_id,
    refreshed_at - (refreshed_at % 86400000),
    COUNT(*),
    SUM(CASE WHEN was_successful = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN was_successful = 0 THEN 1 ELSE 0 END),
    SUM(entries_created),
    MIN(created_at),
    MAX(created_at)
FROM feed_refreshes
GROUP BY feed_id, refreshed_at - (refreshed_at % 86400000);

-- A subscriber can dismiss a moved-feed notice. The notice stays hidden
-- until refresh finds a different URL.
ALTER TABLE feed_subscriptions ADD COLUMN dismissed_moved_url TEXT
    CHECK (dismissed_moved_url IS NULL OR length(dismissed_moved_url) BETWEEN 1 AND 2048);

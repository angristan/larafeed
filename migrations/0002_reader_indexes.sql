-- Global/category reader pages join subscriptions by feed after ordering entries.
-- Feed-scoped pages continue to use the feed-specific indexes from 0001.
CREATE INDEX entries_published_global
    ON entries(published_at DESC, id DESC, feed_id);

CREATE INDEX entries_created_global
    ON entries(created_at DESC, id DESC, feed_id);

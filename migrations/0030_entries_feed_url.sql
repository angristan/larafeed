-- Moving a subscription to another feed matches old and new entries by
-- deduplication key or by link. The key has an index; this one serves the
-- link match, which otherwise read every old entry for each new entry.
CREATE INDEX entries_feed_url ON entries(feed_id, url) WHERE url IS NOT NULL;

-- Feed IDs are user-visible through reader URLs and compatibility APIs. Remap
-- the pre-production random IDs to a compact stable order, then let D1 own
-- allocation through a trigger-backed sequence.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE feed_id_remap (
    old_id INTEGER PRIMARY KEY,
    new_id INTEGER NOT NULL UNIQUE CHECK (new_id BETWEEN 1 AND 9007199254740991)
) STRICT;

INSERT INTO feed_id_remap (old_id, new_id)
SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id)
FROM feeds;

UPDATE entries
SET feed_id = (SELECT new_id FROM feed_id_remap WHERE old_id = entries.feed_id)
WHERE feed_id IN (SELECT old_id FROM feed_id_remap);

UPDATE feed_subscriptions
SET feed_id = (SELECT new_id FROM feed_id_remap WHERE old_id = feed_subscriptions.feed_id)
WHERE feed_id IN (SELECT old_id FROM feed_id_remap);

UPDATE entry_interactions
SET feed_id = (SELECT new_id FROM feed_id_remap WHERE old_id = entry_interactions.feed_id)
WHERE feed_id IN (SELECT old_id FROM feed_id_remap);

UPDATE feed_refreshes
SET feed_id = (SELECT new_id FROM feed_id_remap WHERE old_id = feed_refreshes.feed_id)
WHERE feed_id IN (SELECT old_id FROM feed_id_remap);

UPDATE opml_import_items
SET feed_id = (SELECT new_id FROM feed_id_remap WHERE old_id = opml_import_items.feed_id)
WHERE feed_id IN (SELECT old_id FROM feed_id_remap);

UPDATE chart_daily_activity
SET feed_id = (SELECT new_id FROM feed_id_remap WHERE old_id = chart_daily_activity.feed_id)
WHERE feed_id IN (SELECT old_id FROM feed_id_remap);

UPDATE chart_daily_refreshes
SET feed_id = (SELECT new_id FROM feed_id_remap WHERE old_id = chart_daily_refreshes.feed_id)
WHERE feed_id IN (SELECT old_id FROM feed_id_remap);

-- Queue messages and outbox rows carry operation IDs, so keep those stable and
-- only remap the authoritative feed ID inside each job payload.
UPDATE jobs
SET payload_json = json_set(
    payload_json,
    '$.feedId',
    (
        SELECT new_id
        FROM feed_id_remap
        WHERE old_id = CAST(json_extract(jobs.payload_json, '$.feedId') AS INTEGER)
    )
)
WHERE json_type(payload_json, '$.feedId') = 'integer'
  AND CAST(json_extract(payload_json, '$.feedId') AS INTEGER) IN (
      SELECT old_id FROM feed_id_remap
  );

UPDATE feeds
SET id = (SELECT new_id FROM feed_id_remap WHERE old_id = feeds.id)
WHERE id IN (SELECT old_id FROM feed_id_remap);

CREATE TABLE feed_id_sequence (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    next_id INTEGER NOT NULL CHECK (next_id BETWEEN 1 AND 9007199254740991)
) STRICT;

INSERT INTO feed_id_sequence (singleton, next_id)
SELECT 1, COALESCE(MAX(id), 0) + 1 FROM feeds;

CREATE TRIGGER feeds_advance_id_sequence
AFTER INSERT ON feeds
WHEN NEW.id >= (
    SELECT next_id FROM feed_id_sequence WHERE singleton = 1
)
BEGIN
    UPDATE feed_id_sequence
    SET next_id = NEW.id + 1
    WHERE singleton = 1;
END;

DROP TABLE feed_id_remap;

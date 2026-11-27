-- Stored counters for the reader's unread and total badges.
--
-- Counting a subscription's entries used to read every entry of the feed,
-- and every badge request did it for every feed. With these counters a
-- subscription's counts read only its own row, its feed's row, and its
-- sparse entry_interactions rows.
--
-- feeds.entry_count is the number of entries of the feed.
-- feed_subscriptions.read_through_count is the number of entries of the
-- feed whose ID is at or below read_through_entry_id, so
-- entry_count - read_through_count entries are unread unless an
-- interaction row says otherwise.
--
-- The triggers below keep both counters exact whatever writes the rows:
-- feed refreshes, imports, deletes cascading from a feed, and fixtures.
-- D1 includes rows changed by triggers in a statement's change count, so
-- inserting an entry now reports one more change.
ALTER TABLE feeds ADD COLUMN entry_count INTEGER NOT NULL DEFAULT 0
    CHECK (entry_count >= 0);

ALTER TABLE feed_subscriptions ADD COLUMN read_through_count INTEGER NOT NULL DEFAULT 0
    CHECK (read_through_count >= 0);

UPDATE feeds SET entry_count = (
    SELECT COUNT(*) FROM entries WHERE entries.feed_id = feeds.id
);

UPDATE feed_subscriptions SET read_through_count = (
    SELECT COUNT(*) FROM entries
    WHERE entries.feed_id = feed_subscriptions.feed_id
      AND entries.id <= feed_subscriptions.read_through_entry_id
)
WHERE read_through_entry_id IS NOT NULL;

CREATE TRIGGER entries_count_insert
AFTER INSERT ON entries
BEGIN
    UPDATE feeds SET entry_count = entry_count + 1 WHERE id = NEW.feed_id;
    -- Entry IDs only grow, so a new entry is normally above every
    -- watermark and this matches no row.
    UPDATE feed_subscriptions SET read_through_count = read_through_count + 1
    WHERE feed_id = NEW.feed_id AND read_through_entry_id >= NEW.id;
END;

CREATE TRIGGER entries_count_delete
AFTER DELETE ON entries
BEGIN
    UPDATE feeds SET entry_count = entry_count - 1 WHERE id = OLD.feed_id;
    UPDATE feed_subscriptions SET read_through_count = read_through_count - 1
    WHERE feed_id = OLD.feed_id AND read_through_entry_id >= OLD.id;
END;

CREATE TRIGGER feed_subscriptions_count_insert
AFTER INSERT ON feed_subscriptions
WHEN NEW.read_through_entry_id IS NOT NULL
BEGIN
    UPDATE feed_subscriptions SET read_through_count = (
        SELECT COUNT(*) FROM entries
        WHERE feed_id = NEW.feed_id AND id <= NEW.read_through_entry_id
    )
    WHERE user_id = NEW.user_id AND feed_id = NEW.feed_id;
END;

-- "Mark as read" moves the watermark to the feed's newest entry and sets
-- read_through_count to the feed's entry_count in the same statement.
-- Any other change of the watermark that leaves the count alone is counted
-- here, reading only the entries between the old and the new watermark.
CREATE TRIGGER feed_subscriptions_count_read_through
AFTER UPDATE OF read_through_entry_id ON feed_subscriptions
WHEN NEW.read_through_entry_id IS NOT OLD.read_through_entry_id
    AND NEW.read_through_count = OLD.read_through_count
BEGIN
    UPDATE feed_subscriptions SET read_through_count = CASE
        WHEN NEW.read_through_entry_id IS NULL THEN 0
        WHEN COALESCE(OLD.read_through_entry_id, 0) < NEW.read_through_entry_id
        THEN OLD.read_through_count + (
            SELECT COUNT(*) FROM entries
            WHERE feed_id = NEW.feed_id
              AND id > COALESCE(OLD.read_through_entry_id, 0)
              AND id <= NEW.read_through_entry_id
        )
        ELSE OLD.read_through_count - (
            SELECT COUNT(*) FROM entries
            WHERE feed_id = NEW.feed_id
              AND id > NEW.read_through_entry_id
              AND id <= OLD.read_through_entry_id
        )
    END
    WHERE user_id = NEW.user_id AND feed_id = NEW.feed_id;
END;

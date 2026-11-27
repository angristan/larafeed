-- Removes an entry's search row when the entry is deleted. Entries are only
-- deleted through the feeds ON DELETE CASCADE, which fires this trigger too.
-- Before this, the search indexer scanned the whole index on every cron run
-- to find rows whose entry was gone.
CREATE TRIGGER entries_delete_search
AFTER DELETE ON entries
BEGIN
    DELETE FROM entry_search WHERE rowid = OLD.id;
END;

-- Removes rows left behind by deletions before the trigger existed.
DELETE FROM entry_search WHERE rowid NOT IN (SELECT id FROM entries);

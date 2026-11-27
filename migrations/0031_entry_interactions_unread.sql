-- Explicit "keep unread" overrides are rare. Sync clients ask for every
-- unread entry, and the ones at or below a read-through watermark are
-- found through this index instead of reading every interaction row.
CREATE INDEX entry_interactions_unread
    ON entry_interactions(user_id, entry_id) WHERE read_override = 0;

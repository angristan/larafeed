-- Finds the outbox messages a recovery run has just dead-lettered. The OPML
-- recovery marks their jobs from these rows; without this index it read
-- every job on each cron run. Dead-lettered messages are rare, so the index
-- stays small.
CREATE INDEX outbox_messages_dead_lettered
    ON outbox_messages(topic, updated_at)
    WHERE state = 'dead_lettered';

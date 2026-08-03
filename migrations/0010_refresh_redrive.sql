-- Keep scheduled refresh delivery reconciliation bounded as sent history grows.
CREATE INDEX outbox_messages_sent_topic_updated
    ON outbox_messages(topic, updated_at, id) WHERE state = 'sent';

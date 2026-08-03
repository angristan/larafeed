-- Fence refresh filter writes against concurrent subscription rule rebuilds.
ALTER TABLE feed_subscriptions
    ADD COLUMN filter_revision INTEGER NOT NULL DEFAULT 0
    CHECK (filter_revision >= 0);

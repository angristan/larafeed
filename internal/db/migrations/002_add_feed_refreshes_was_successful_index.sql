-- +goose Up
CREATE INDEX idx_fr_was_successful ON feed_refreshes(was_successful);

-- +goose Down
DROP INDEX IF EXISTS idx_fr_was_successful;

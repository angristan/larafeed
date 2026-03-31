-- +goose Up
-- Add columns for HTTP conditional requests, gone detection, and error backoff.

ALTER TABLE feeds
    ADD COLUMN etag VARCHAR(255),
    ADD COLUMN last_modified VARCHAR(255),
    ADD COLUMN is_gone BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN consecutive_failures INT NOT NULL DEFAULT 0,
    ADD COLUMN retry_after TIMESTAMPTZ;

-- +goose Down
ALTER TABLE feeds
    DROP COLUMN etag,
    DROP COLUMN last_modified,
    DROP COLUMN is_gone,
    DROP COLUMN consecutive_failures,
    DROP COLUMN retry_after;

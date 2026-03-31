-- +goose Up
-- Align prod schema (created by Laravel) with Go expectations.

-- filter_rules: Laravel uses JSON, Go/sqlc expects JSONB.
ALTER TABLE feed_subscriptions ALTER COLUMN filter_rules TYPE JSONB USING filter_rules::jsonb;

-- All timestamp columns: Laravel uses TIMESTAMP (without timezone),
-- Go migration uses TIMESTAMPTZ (with timezone).
ALTER TABLE users
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
    ALTER COLUMN email_verified_at TYPE TIMESTAMPTZ USING email_verified_at AT TIME ZONE 'UTC',
    ALTER COLUMN two_factor_confirmed_at TYPE TIMESTAMPTZ USING two_factor_confirmed_at AT TIME ZONE 'UTC';

ALTER TABLE password_reset_tokens
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE feeds
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
    ALTER COLUMN favicon_updated_at TYPE TIMESTAMPTZ USING favicon_updated_at AT TIME ZONE 'UTC',
    ALTER COLUMN last_successful_refresh_at TYPE TIMESTAMPTZ USING last_successful_refresh_at AT TIME ZONE 'UTC',
    ALTER COLUMN last_failed_refresh_at TYPE TIMESTAMPTZ USING last_failed_refresh_at AT TIME ZONE 'UTC';

ALTER TABLE entries
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
    ALTER COLUMN published_at TYPE TIMESTAMPTZ USING published_at AT TIME ZONE 'UTC';

ALTER TABLE subscription_categories
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE feed_subscriptions
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE entry_interactions
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
    ALTER COLUMN read_at TYPE TIMESTAMPTZ USING read_at AT TIME ZONE 'UTC',
    ALTER COLUMN starred_at TYPE TIMESTAMPTZ USING starred_at AT TIME ZONE 'UTC',
    ALTER COLUMN archived_at TYPE TIMESTAMPTZ USING archived_at AT TIME ZONE 'UTC',
    ALTER COLUMN filtered_at TYPE TIMESTAMPTZ USING filtered_at AT TIME ZONE 'UTC';

ALTER TABLE feed_refreshes
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
    ALTER COLUMN refreshed_at TYPE TIMESTAMPTZ USING refreshed_at AT TIME ZONE 'UTC';

ALTER TABLE personal_access_tokens
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
    ALTER COLUMN last_used_at TYPE TIMESTAMPTZ USING last_used_at AT TIME ZONE 'UTC',
    ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at AT TIME ZONE 'UTC';

-- +goose Down
ALTER TABLE feed_subscriptions ALTER COLUMN filter_rules TYPE JSON USING filter_rules::json;

ALTER TABLE users
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP,
    ALTER COLUMN email_verified_at TYPE TIMESTAMP,
    ALTER COLUMN two_factor_confirmed_at TYPE TIMESTAMP;

ALTER TABLE password_reset_tokens
    ALTER COLUMN created_at TYPE TIMESTAMP;

ALTER TABLE feeds
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP,
    ALTER COLUMN favicon_updated_at TYPE TIMESTAMP,
    ALTER COLUMN last_successful_refresh_at TYPE TIMESTAMP,
    ALTER COLUMN last_failed_refresh_at TYPE TIMESTAMP;

ALTER TABLE entries
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP,
    ALTER COLUMN published_at TYPE TIMESTAMP;

ALTER TABLE subscription_categories
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP;

ALTER TABLE feed_subscriptions
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP;

ALTER TABLE entry_interactions
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP,
    ALTER COLUMN read_at TYPE TIMESTAMP,
    ALTER COLUMN starred_at TYPE TIMESTAMP,
    ALTER COLUMN archived_at TYPE TIMESTAMP,
    ALTER COLUMN filtered_at TYPE TIMESTAMP;

ALTER TABLE feed_refreshes
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP,
    ALTER COLUMN refreshed_at TYPE TIMESTAMP;

ALTER TABLE personal_access_tokens
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP,
    ALTER COLUMN last_used_at TYPE TIMESTAMP,
    ALTER COLUMN expires_at TYPE TIMESTAMP;

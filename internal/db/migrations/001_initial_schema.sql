-- +goose Up

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    email_verified_at TIMESTAMPTZ NULL,
    password VARCHAR(255) NOT NULL,
    remember_token VARCHAR(100) NULL,
    fever_api_key TEXT NULL,
    two_factor_secret TEXT NULL,
    two_factor_recovery_codes TEXT NULL,
    two_factor_confirmed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NULL DEFAULT NOW()
);

CREATE TABLE password_reset_tokens (
    email VARCHAR(255) PRIMARY KEY,
    token VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NULL
);

CREATE TABLE feeds (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    feed_url VARCHAR(255) NOT NULL UNIQUE,
    site_url VARCHAR(255) NOT NULL,
    favicon_url VARCHAR(255) NULL,
    favicon_is_dark BOOLEAN NULL,
    favicon_updated_at TIMESTAMPTZ NULL,
    last_successful_refresh_at TIMESTAMPTZ NULL,
    last_failed_refresh_at TIMESTAMPTZ NULL,
    last_error_message VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NULL DEFAULT NOW()
);

CREATE TABLE entries (
    id BIGSERIAL PRIMARY KEY,
    feed_id BIGINT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    url VARCHAR(255) NOT NULL,
    author VARCHAR(255) NULL,
    content TEXT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NULL DEFAULT NOW(),
    UNIQUE (feed_id, url, published_at)
);
CREATE INDEX idx_entries_published_at ON entries(published_at);

CREATE TABLE subscription_categories (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE TABLE feed_subscriptions (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feed_id BIGINT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    category_id BIGINT NOT NULL REFERENCES subscription_categories(id),
    custom_feed_name VARCHAR(255) NULL,
    filter_rules JSONB NULL,
    created_at TIMESTAMPTZ NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, feed_id)
);

CREATE TABLE entry_interactions (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entry_id BIGINT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NULL,
    starred_at TIMESTAMPTZ NULL,
    archived_at TIMESTAMPTZ NULL,
    filtered_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, entry_id)
);
CREATE INDEX idx_ei_read_at ON entry_interactions(read_at);
CREATE INDEX idx_ei_starred_at ON entry_interactions(starred_at);
CREATE INDEX idx_ei_archived_at ON entry_interactions(archived_at);
CREATE INDEX idx_ei_user_filtered ON entry_interactions(user_id, filtered_at);

CREATE TABLE feed_refreshes (
    id BIGSERIAL PRIMARY KEY,
    feed_id BIGINT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    refreshed_at TIMESTAMPTZ NOT NULL,
    was_successful BOOLEAN NOT NULL,
    entries_created INT DEFAULT 0,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NULL DEFAULT NOW()
);
CREATE INDEX idx_fr_refreshed_at ON feed_refreshes(refreshed_at);
CREATE INDEX idx_fr_was_successful ON feed_refreshes(was_successful);

CREATE TABLE personal_access_tokens (
    id BIGSERIAL PRIMARY KEY,
    tokenable_type VARCHAR(255) NOT NULL,
    tokenable_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    abilities TEXT NULL,
    last_used_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NULL DEFAULT NOW()
);
CREATE INDEX idx_pat_tokenable ON personal_access_tokens(tokenable_type, tokenable_id);

CREATE TABLE cache (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    expiration INT NOT NULL
);

-- +goose Down
DROP TABLE IF EXISTS cache;
DROP TABLE IF EXISTS personal_access_tokens;
DROP TABLE IF EXISTS feed_refreshes;
DROP TABLE IF EXISTS entry_interactions;
DROP TABLE IF EXISTS feed_subscriptions;
DROP TABLE IF EXISTS subscription_categories;
DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS feeds;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS users;

-- Larafeed's initial Cloudflare D1 schema.
-- All *_at values are UTC Unix epoch milliseconds supplied by the application.
-- Authentication secrets are represented only by SHA-256 hashes; plaintext tokens
-- and plaintext WebAuthn challenges are never persisted here.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    webauthn_user_handle BLOB NOT NULL UNIQUE CHECK (length(webauthn_user_handle) = 32),
    username TEXT NOT NULL CHECK (length(trim(username)) > 0),
    email TEXT NOT NULL CHECK (length(trim(email)) > 0),
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    disabled_at INTEGER CHECK (disabled_at IS NULL OR disabled_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

-- Usernames are protocol login names. Email and username normalization is enforced
-- by these ASCII case-insensitive identities, while display spelling is preserved.
CREATE UNIQUE INDEX users_username_unique
    ON users(username COLLATE NOCASE);
CREATE UNIQUE INDEX users_email_unique
    ON users(email COLLATE NOCASE);

CREATE TABLE passkeys (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id BLOB NOT NULL UNIQUE CHECK (length(credential_id) > 0),
    public_key BLOB NOT NULL CHECK (length(public_key) > 0),
    sign_count INTEGER NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
    transports_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(transports_json)),
    aaguid TEXT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    is_backed_up INTEGER NOT NULL DEFAULT 0 CHECK (is_backed_up IN (0, 1)),
    last_used_at INTEGER CHECK (last_used_at IS NULL OR last_used_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX passkeys_user
    ON passkeys(user_id, created_at, id);

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BLOB NOT NULL UNIQUE CHECK (length(token_hash) = 32),
    csrf_token_hash BLOB NOT NULL CHECK (length(csrf_token_hash) = 32),
    rotated_from_session_id INTEGER UNIQUE REFERENCES sessions(id) ON DELETE SET NULL,
    expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
    last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= 0),
    revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    CHECK (expires_at > created_at),
    CHECK (last_seen_at >= created_at)
) STRICT;

CREATE INDEX sessions_user
    ON sessions(user_id, expires_at, id);
CREATE INDEX sessions_active_expiry
    ON sessions(expires_at, id) WHERE revoked_at IS NULL;

CREATE TABLE user_access_links (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('enrollment', 'recovery')),
    token_hash BLOB NOT NULL UNIQUE CHECK (length(token_hash) = 32),
    expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
    consumed_at INTEGER CHECK (consumed_at IS NULL OR consumed_at >= 0),
    revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    CHECK (expires_at > created_at),
    CHECK (consumed_at IS NULL OR revoked_at IS NULL)
) STRICT;

CREATE INDEX user_access_links_user
    ON user_access_links(user_id, purpose, created_at DESC, id DESC);
CREATE INDEX user_access_links_expiry
    ON user_access_links(expires_at, id)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE webauthn_challenges (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    access_link_id INTEGER REFERENCES user_access_links(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('authentication', 'enrollment', 'recovery')),
    challenge_hash BLOB NOT NULL UNIQUE CHECK (length(challenge_hash) = 32),
    expected_rp_id TEXT NOT NULL CHECK (length(trim(expected_rp_id)) > 0),
    expected_origin TEXT NOT NULL CHECK (length(trim(expected_origin)) > 0),
    expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
    consumed_at INTEGER CHECK (consumed_at IS NULL OR consumed_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    CHECK (expires_at > created_at),
    CHECK (
        (purpose = 'authentication')
        OR (user_id IS NOT NULL AND access_link_id IS NOT NULL)
    )
) STRICT;

CREATE INDEX webauthn_challenges_active
    ON webauthn_challenges(expires_at, id) WHERE consumed_at IS NULL;
CREATE INDEX webauthn_challenges_user
    ON webauthn_challenges(user_id, created_at DESC, id DESC)
    WHERE user_id IS NOT NULL;

CREATE TABLE security_events (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX security_events_user_time
    ON security_events(user_id, created_at DESC, id DESC)
    WHERE user_id IS NOT NULL;

CREATE TABLE app_tokens (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    token_hash BLOB NOT NULL UNIQUE CHECK (length(token_hash) = 32),
    token_prefix TEXT NOT NULL CHECK (length(token_prefix) > 0),
    scopes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scopes_json)),
    last_used_at INTEGER CHECK (last_used_at IS NULL OR last_used_at >= 0),
    expires_at INTEGER CHECK (expires_at IS NULL OR expires_at >= 0),
    revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    CHECK (expires_at IS NULL OR expires_at > created_at)
) STRICT;

CREATE INDEX app_tokens_user
    ON app_tokens(user_id, created_at DESC, id DESC);
CREATE INDEX app_tokens_active_expiry
    ON app_tokens(expires_at, id) WHERE revoked_at IS NULL;

CREATE TABLE feeds (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    -- The application canonicalizes the URL before insertion. URL paths remain
    -- case-sensitive, so deterministic identity uses SQLite's binary collation.
    feed_url TEXT NOT NULL UNIQUE CHECK (length(feed_url) > 0),
    site_url TEXT,
    favicon_url TEXT,
    favicon_is_dark INTEGER CHECK (favicon_is_dark IS NULL OR favicon_is_dark IN (0, 1)),
    favicon_updated_at INTEGER CHECK (favicon_updated_at IS NULL OR favicon_updated_at >= 0),
    etag TEXT,
    last_modified TEXT,
    is_gone INTEGER NOT NULL DEFAULT 0 CHECK (is_gone IN (0, 1)),
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    last_attempt_at INTEGER CHECK (last_attempt_at IS NULL OR last_attempt_at >= 0),
    last_successful_refresh_at INTEGER CHECK (last_successful_refresh_at IS NULL OR last_successful_refresh_at >= 0),
    latest_entry_at INTEGER CHECK (latest_entry_at IS NULL OR latest_entry_at >= 0),
    next_refresh_at INTEGER NOT NULL CHECK (next_refresh_at >= 0),
    last_error_class TEXT,
    last_error_message TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

-- Cron scans live feeds in next-attempt order.
CREATE INDEX feeds_due_refresh
    ON feeds(next_refresh_at, id) WHERE is_gone = 0;

CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991),
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    -- SHA-256 over the parser's canonical source identity (GUID, URL, or a
    -- documented fallback) makes retries and reordered deliveries idempotent.
    deduplication_key BLOB NOT NULL CHECK (length(deduplication_key) = 32),
    source_id TEXT,
    title TEXT NOT NULL,
    url TEXT,
    author TEXT,
    published_at INTEGER NOT NULL CHECK (published_at >= 0),
    source_updated_at INTEGER CHECK (source_updated_at IS NULL OR source_updated_at >= 0),
    content_status TEXT NOT NULL CHECK (content_status IN ('stored', 'empty', 'oversized')),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (feed_id, deduplication_key),
    -- This candidate key lets subscription watermarks prove feed ownership.
    UNIQUE (feed_id, id)
) STRICT;

-- Reader pagination uses stable id tie-breakers for equal timestamps.
CREATE INDEX entries_feed_published
    ON entries(feed_id, published_at DESC, id DESC);
CREATE INDEX entries_feed_created
    ON entries(feed_id, created_at DESC, id DESC);

CREATE TABLE entry_contents (
    entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
    content_html TEXT NOT NULL,
    content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
    encoded_size_bytes INTEGER NOT NULL CHECK (encoded_size_bytes >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (encoded_size_bytes = length(CAST(content_html AS BLOB))),
    -- Keep an oversized article out of D1 instead of creating a poison job.
    CHECK (encoded_size_bytes <= 1800000)
) STRICT;

CREATE TABLE subscription_categories (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    -- Required parent key for the ownership-preserving subscription FK.
    UNIQUE (user_id, id)
) STRICT;

CREATE UNIQUE INDEX subscription_categories_user_name
    ON subscription_categories(user_id, name COLLATE NOCASE);

CREATE TABLE feed_subscriptions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL,
    custom_feed_name TEXT,
    filter_rules_json TEXT CHECK (filter_rules_json IS NULL OR json_valid(filter_rules_json)),
    -- Entries at or below this ingestion identity are read unless an explicit
    -- interaction overrides them. Publication time is intentionally not used.
    read_through_entry_id INTEGER,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    PRIMARY KEY (user_id, feed_id),
    FOREIGN KEY (user_id, category_id)
        REFERENCES subscription_categories(user_id, id)
        ON DELETE NO ACTION,
    FOREIGN KEY (feed_id, read_through_entry_id)
        REFERENCES entries(feed_id, id)
        ON DELETE NO ACTION
) STRICT;

CREATE INDEX feed_subscriptions_feed
    ON feed_subscriptions(feed_id, user_id);
CREATE INDEX feed_subscriptions_user_category
    ON feed_subscriptions(user_id, category_id, feed_id);

CREATE TABLE entry_interactions (
    user_id INTEGER NOT NULL,
    feed_id INTEGER NOT NULL,
    entry_id INTEGER NOT NULL,
    -- NULL follows the subscription watermark, 0 means explicitly unread, and
    -- 1 means explicitly read.
    read_override INTEGER CHECK (read_override IS NULL OR read_override IN (0, 1)),
    read_changed_at INTEGER CHECK (read_changed_at IS NULL OR read_changed_at >= 0),
    starred_at INTEGER CHECK (starred_at IS NULL OR starred_at >= 0),
    archived_at INTEGER CHECK (archived_at IS NULL OR archived_at >= 0),
    filtered_at INTEGER CHECK (filtered_at IS NULL OR filtered_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    PRIMARY KEY (user_id, entry_id),
    FOREIGN KEY (user_id, feed_id)
        REFERENCES feed_subscriptions(user_id, feed_id) ON DELETE CASCADE,
    FOREIGN KEY (feed_id, entry_id)
        REFERENCES entries(feed_id, id) ON DELETE CASCADE,
    CHECK (
        (read_override IS NULL AND read_changed_at IS NULL)
        OR (read_override IS NOT NULL AND read_changed_at IS NOT NULL)
    ),
    -- Clearing the last meaningful state deletes the row. This is the sparse
    -- override invariant used by reader counts and filtering.
    CHECK (
        read_override IS NOT NULL
        OR starred_at IS NOT NULL
        OR archived_at IS NOT NULL
        OR filtered_at IS NOT NULL
    )
) STRICT;

-- Supports subscription-scoped cleanup/count joins; the PK covers user/entry.
CREATE INDEX entry_interactions_subscription
    ON entry_interactions(user_id, feed_id, entry_id);
CREATE INDEX entry_interactions_starred
    ON entry_interactions(user_id, starred_at DESC, entry_id DESC)
    WHERE starred_at IS NOT NULL;
CREATE INDEX entry_interactions_archived
    ON entry_interactions(user_id, archived_at DESC, entry_id DESC)
    WHERE archived_at IS NOT NULL;

CREATE TABLE jobs (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) > 0),
    kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
    state TEXT NOT NULL CHECK (
        state IN ('pending', 'queued', 'running', 'succeeded', 'failed', 'dead_lettered', 'canceled')
    ),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
    available_at INTEGER NOT NULL CHECK (available_at >= 0),
    lease_owner TEXT,
    lease_expires_at INTEGER CHECK (lease_expires_at IS NULL OR lease_expires_at >= 0),
    started_at INTEGER CHECK (started_at IS NULL OR started_at >= 0),
    completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= 0),
    last_error_class TEXT,
    last_error_message TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (attempt_count <= max_attempts),
    CHECK (
        (state = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    ),
    CHECK (
        (state IN ('succeeded', 'dead_lettered', 'canceled')) = (completed_at IS NOT NULL)
    )
) STRICT;

CREATE INDEX jobs_runnable
    ON jobs(available_at, id) WHERE state IN ('pending', 'failed');
CREATE INDEX jobs_expired_leases
    ON jobs(lease_expires_at, id) WHERE state = 'running';

CREATE TABLE outbox_messages (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    topic TEXT NOT NULL CHECK (length(trim(topic)) > 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'sent', 'dead_lettered')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at INTEGER NOT NULL CHECK (available_at >= 0),
    lease_owner TEXT,
    lease_expires_at INTEGER CHECK (lease_expires_at IS NULL OR lease_expires_at >= 0),
    sent_at INTEGER CHECK (sent_at IS NULL OR sent_at >= 0),
    last_error_class TEXT,
    last_error_message TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (
        (state = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    ),
    CHECK ((state = 'sent') = (sent_at IS NOT NULL))
) STRICT;

-- Separate partial indexes keep normal dispatch and stale-lease recovery bounded.
CREATE INDEX outbox_messages_pending
    ON outbox_messages(available_at, id) WHERE state = 'pending';
CREATE INDEX outbox_messages_expired_leases
    ON outbox_messages(lease_expires_at, id) WHERE state = 'leased';

CREATE TABLE feed_refreshes (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    job_id INTEGER UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
    refreshed_at INTEGER NOT NULL CHECK (refreshed_at >= 0),
    was_successful INTEGER NOT NULL CHECK (was_successful IN (0, 1)),
    was_not_modified INTEGER NOT NULL DEFAULT 0 CHECK (was_not_modified IN (0, 1)),
    http_status INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
    entries_seen INTEGER NOT NULL DEFAULT 0 CHECK (entries_seen >= 0),
    entries_created INTEGER NOT NULL DEFAULT 0 CHECK (entries_created >= 0),
    entries_updated INTEGER NOT NULL DEFAULT 0 CHECK (entries_updated >= 0),
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    error_class TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    CHECK (was_not_modified = 0 OR was_successful = 1)
) STRICT;

-- Feed history pages and retained-history pruning use this order.
CREATE INDEX feed_refreshes_feed_time
    ON feed_refreshes(feed_id, refreshed_at DESC, id DESC);
CREATE INDEX feed_refreshes_time
    ON feed_refreshes(refreshed_at, id);

CREATE TABLE entry_summaries (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    job_id INTEGER UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
    content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
    model TEXT NOT NULL CHECK (length(trim(model)) > 0),
    prompt_version TEXT NOT NULL CHECK (length(trim(prompt_version)) > 0),
    summary_html TEXT NOT NULL CHECK (length(summary_html) > 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (entry_id, content_hash, model, prompt_version)
) STRICT;

CREATE INDEX entry_summaries_requester
    ON entry_summaries(requested_by_user_id, created_at DESC, id DESC)
    WHERE requested_by_user_id IS NOT NULL;

CREATE TABLE opml_imports (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_filename TEXT,
    state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'completed', 'failed', 'canceled')),
    total_items INTEGER NOT NULL DEFAULT 0 CHECK (total_items >= 0),
    succeeded_items INTEGER NOT NULL DEFAULT 0 CHECK (succeeded_items >= 0),
    failed_items INTEGER NOT NULL DEFAULT 0 CHECK (failed_items >= 0),
    skipped_items INTEGER NOT NULL DEFAULT 0 CHECK (skipped_items >= 0),
    started_at INTEGER CHECK (started_at IS NULL OR started_at >= 0),
    completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= 0),
    error_class TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (id, user_id),
    CHECK (succeeded_items + failed_items + skipped_items <= total_items),
    CHECK (
        state <> 'completed'
        OR succeeded_items + failed_items + skipped_items = total_items
    )
) STRICT;

CREATE INDEX opml_imports_user
    ON opml_imports(user_id, created_at DESC, id DESC);
CREATE INDEX opml_imports_active
    ON opml_imports(updated_at, id) WHERE state IN ('pending', 'processing');

CREATE TABLE opml_import_items (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    import_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) > 0),
    job_id INTEGER UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
    title TEXT,
    feed_url TEXT NOT NULL CHECK (length(feed_url) > 0),
    normalized_feed_url TEXT NOT NULL CHECK (length(normalized_feed_url) > 0),
    site_url TEXT,
    category_path_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(category_path_json)),
    state TEXT NOT NULL CHECK (state IN ('pending', 'queued', 'running', 'succeeded', 'failed', 'skipped')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
    feed_id INTEGER REFERENCES feeds(id) ON DELETE SET NULL,
    category_id INTEGER,
    error_class TEXT,
    error_message TEXT,
    started_at INTEGER CHECK (started_at IS NULL OR started_at >= 0),
    completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (attempt_count <= max_attempts),
    FOREIGN KEY (import_id, user_id)
        REFERENCES opml_imports(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, category_id)
        REFERENCES subscription_categories(user_id, id) ON DELETE NO ACTION,
    UNIQUE (import_id, position),
    -- Parsing keeps the first occurrence, including its category path, so item
    -- scheduling is deterministic even when an OPML file repeats a feed URL.
    UNIQUE (import_id, normalized_feed_url)
) STRICT;

CREATE INDEX opml_import_items_progress
    ON opml_import_items(import_id, state, position, id);
CREATE INDEX opml_import_items_retry
    ON opml_import_items(import_id, updated_at, id) WHERE state = 'failed';

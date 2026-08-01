-- Read-only PostgreSQL baseline for the Cloudflare migration.
-- Run off-peak or against a replica: exact sections scan application tables.
-- Example: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/postgres-baseline.sql

\pset pager off
\timing on

BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5min';

\echo '== Database and table sizes =='
SELECT
    pg_database_size(current_database()) AS database_bytes,
    pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT
    s.relname AS table_name,
    s.n_live_tup AS estimated_rows,
    s.n_dead_tup AS estimated_dead_rows,
    pg_table_size(s.relid) AS table_bytes,
    pg_indexes_size(s.relid) AS index_bytes,
    pg_total_relation_size(s.relid) AS total_bytes,
    s.seq_scan,
    s.idx_scan
FROM pg_stat_user_tables s
ORDER BY total_bytes DESC;

\echo '== Exact application cardinalities =='
SELECT 'users' AS table_name, COUNT(*) AS rows FROM users
UNION ALL SELECT 'feeds', COUNT(*) FROM feeds
UNION ALL SELECT 'entries', COUNT(*) FROM entries
UNION ALL SELECT 'subscription_categories', COUNT(*) FROM subscription_categories
UNION ALL SELECT 'feed_subscriptions', COUNT(*) FROM feed_subscriptions
UNION ALL SELECT 'entry_interactions', COUNT(*) FROM entry_interactions
UNION ALL SELECT 'feed_refreshes', COUNT(*) FROM feed_refreshes
UNION ALL SELECT 'personal_access_tokens', COUNT(*) FROM personal_access_tokens
UNION ALL SELECT 'password_reset_tokens', COUNT(*) FROM password_reset_tokens
UNION ALL SELECT 'cache', COUNT(*) FROM cache
ORDER BY rows DESC;

\echo '== Identifier ranges and JavaScript safety =='
WITH ids AS (
    SELECT 'users' AS table_name, MIN(id) AS min_id, MAX(id) AS max_id FROM users
    UNION ALL SELECT 'feeds', MIN(id), MAX(id) FROM feeds
    UNION ALL SELECT 'entries', MIN(id), MAX(id) FROM entries
    UNION ALL SELECT 'subscription_categories', MIN(id), MAX(id) FROM subscription_categories
    UNION ALL SELECT 'feed_refreshes', MIN(id), MAX(id) FROM feed_refreshes
    UNION ALL SELECT 'personal_access_tokens', MIN(id), MAX(id) FROM personal_access_tokens
)
SELECT
    table_name,
    min_id,
    max_id,
    COALESCE(max_id > 9007199254740991, FALSE) AS exceeds_javascript_safe_integer
FROM ids
ORDER BY table_name;

\echo '== Article content size distribution =='
SELECT
    COUNT(*) AS entries_with_content,
    SUM(octet_length(content)) AS content_bytes,
    AVG(octet_length(content))::bigint AS avg_content_bytes,
    percentile_disc(ARRAY[0.50, 0.95, 0.99])
        WITHIN GROUP (ORDER BY octet_length(content)) AS p50_p95_p99_content_bytes,
    MAX(octet_length(content)) AS max_content_bytes,
    COUNT(*) FILTER (WHERE octet_length(content) >= 1800000) AS content_ge_1_8mb,
    COUNT(*) FILTER (WHERE octet_length(content) >= 2000000) AS content_ge_2mb
FROM entries
WHERE content IS NOT NULL;

SELECT
    MAX(
        octet_length(title)
        + octet_length(url)
        + octet_length(COALESCE(author, ''))
        + octet_length(COALESCE(content, ''))
    ) AS max_approx_text_payload_bytes,
    MAX(pg_column_size(e)) AS max_postgres_tuple_bytes
FROM entries e;

\echo '== Twelve-month growth =='
SELECT
    date_trunc('month', COALESCE(created_at, published_at)) AS month,
    COUNT(*) AS entries,
    SUM(octet_length(COALESCE(content, ''))) AS content_bytes
FROM entries
WHERE COALESCE(created_at, published_at) >= date_trunc('month', now()) - interval '12 months'
GROUP BY 1
ORDER BY 1;

SELECT
    date_trunc('month', refreshed_at) AS month,
    COUNT(*) AS refreshes,
    COUNT(*) FILTER (WHERE was_successful) AS successful,
    COUNT(*) FILTER (WHERE NOT was_successful) AS failed,
    SUM(entries_created) AS entries_created
FROM feed_refreshes
WHERE refreshed_at >= date_trunc('month', now()) - interval '12 months'
GROUP BY 1
ORDER BY 1;

\echo '== Feed, subscription, and interaction fanout =='
WITH per_feed AS (
    SELECT f.id, COUNT(e.id) AS entries
    FROM feeds f
    LEFT JOIN entries e ON e.feed_id = f.id
    GROUP BY f.id
)
SELECT
    COUNT(*) AS feeds,
    AVG(entries)::bigint AS avg_entries,
    percentile_disc(ARRAY[0.50, 0.95, 0.99])
        WITHIN GROUP (ORDER BY entries) AS p50_p95_p99_entries,
    MAX(entries) AS max_entries
FROM per_feed;

WITH per_user AS (
    SELECT user_id, COUNT(*) AS subscriptions
    FROM feed_subscriptions
    GROUP BY user_id
)
SELECT
    COUNT(*) AS users,
    AVG(subscriptions)::bigint AS avg_subscriptions,
    percentile_disc(ARRAY[0.50, 0.95, 0.99])
        WITHIN GROUP (ORDER BY subscriptions) AS p50_p95_p99_subscriptions,
    MAX(subscriptions) AS max_subscriptions
FROM per_user;

SELECT
    COUNT(*) AS interaction_rows,
    COUNT(*) FILTER (
        WHERE read_at IS NULL
          AND starred_at IS NULL
          AND archived_at IS NULL
          AND filtered_at IS NULL
    ) AS empty_interaction_rows,
    COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS read_rows,
    COUNT(*) FILTER (WHERE starred_at IS NOT NULL) AS starred_rows,
    COUNT(*) FILTER (WHERE filtered_at IS NOT NULL) AS filtered_rows
FROM entry_interactions;

WITH visible AS (
    SELECT fs.user_id, COUNT(e.id) AS visible_entries
    FROM feed_subscriptions fs
    JOIN entries e ON e.feed_id = fs.feed_id
    GROUP BY fs.user_id
), interactions AS (
    SELECT user_id, COUNT(*) AS interaction_rows
    FROM entry_interactions
    GROUP BY user_id
)
SELECT
    u.id AS user_id,
    COALESCE(v.visible_entries, 0) AS visible_entries,
    COALESCE(i.interaction_rows, 0) AS interaction_rows,
    ROUND(
        100.0 * COALESCE(i.interaction_rows, 0)
        / NULLIF(v.visible_entries, 0),
        2
    ) AS interaction_density_percent
FROM users u
LEFT JOIN visible v ON v.user_id = u.id
LEFT JOIN interactions i ON i.user_id = u.id
ORDER BY visible_entries DESC;

\echo '== Migration anomalies =='
WITH duplicates AS (
    SELECT feed_id, url, COUNT(*) AS rows
    FROM entries
    GROUP BY feed_id, url
    HAVING COUNT(*) > 1
)
SELECT
    COUNT(*) AS duplicated_feed_url_groups,
    COALESCE(SUM(rows - 1), 0) AS duplicate_rows
FROM duplicates;

SELECT
    COUNT(*) FILTER (WHERE created_at IS NULL) AS entries_missing_created_at,
    COUNT(*) FILTER (WHERE updated_at IS NULL) AS entries_missing_updated_at,
    COUNT(*) FILTER (WHERE published_at > now()) AS future_entries,
    COUNT(*) FILTER (
        WHERE date_trunc('milliseconds', published_at) <> published_at
    ) AS timestamps_losing_submillisecond_precision
FROM entries;

SELECT
    COUNT(*) FILTER (WHERE expiration < extract(epoch FROM now())) AS expired_cache_rows,
    COUNT(*) AS cache_rows
FROM cache;

COMMIT;

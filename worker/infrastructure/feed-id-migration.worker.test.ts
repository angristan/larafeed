import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('monotonic feed ID migration', () => {
    it('remaps retained relational and job references atomically', async () => {
        await env.DB.batch([
            env.DB.prepare('DROP TRIGGER feeds_advance_id_sequence'),
            env.DB.prepare('DROP TABLE feed_id_sequence'),
        ]);
        await env.DB.batch([
            env.DB.prepare(`INSERT INTO users (
                    id, webauthn_user_handle, username, email, display_name,
                    created_at, updated_at
                ) VALUES (
                    1, zeroblob(32), 'migration-owner',
                    'migration-owner@example.test', 'Migration owner', 1, 1
                )`),
            env.DB.prepare(`INSERT INTO subscription_categories (
                    id, user_id, name, created_at, updated_at
                ) VALUES (10, 1, 'General', 1, 1)`),
            env.DB.prepare(`INSERT INTO feeds (
                    id, name, feed_url, next_refresh_at, created_at, updated_at
                ) VALUES
                    (7000, 'Older', 'https://older.example.test/feed', 1, 1, 1),
                    (9000, 'Newer', 'https://newer.example.test/feed', 2, 2, 2)`),
            env.DB.prepare(`INSERT INTO entries (
                    id, feed_id, deduplication_key, title, published_at,
                    content_status, created_at, updated_at
                ) VALUES (
                    100, 7000, zeroblob(32), 'Entry', 1, 'empty', 1, 1
                )`),
            env.DB.prepare(`INSERT INTO feed_subscriptions (
                    user_id, feed_id, category_id, read_through_entry_id,
                    created_at, updated_at
                ) VALUES (1, 7000, 10, 100, 1, 1)`),
            env.DB.prepare(`INSERT INTO entry_interactions (
                    user_id, feed_id, entry_id, starred_at,
                    created_at, updated_at
                ) VALUES (1, 7000, 100, 1, 1, 1)`),
            env.DB.prepare(`INSERT INTO jobs (
                    id, operation_id, kind, state, payload_json, max_attempts,
                    available_at, created_at, updated_at
                ) VALUES
                    (200, 'feed-refresh:scheduled:7000:1', 'feed_refresh',
                        'pending', '{"feedId":7000,"trigger":"scheduled"}',
                        8, 1, 1, 1),
                    (201, 'favicon-refresh:stable-token', 'favicon_refresh',
                        'pending', '{"feedId":9000}', 8, 1, 1, 1)`),
            env.DB.prepare(`INSERT INTO outbox_messages (
                    id, job_id, topic, payload_json, state, available_at,
                    created_at, updated_at
                ) VALUES (
                    300, 200, 'feed_refresh',
                    '{"operationId":"feed-refresh:scheduled:7000:1"}',
                    'pending', 1, 1, 1
                )`),
            env.DB.prepare(`INSERT INTO feed_refreshes (
                    id, feed_id, refreshed_at, was_successful, created_at
                ) VALUES (400, 7000, 1, 1, 1)`),
            env.DB.prepare(`INSERT INTO opml_imports (
                    id, user_id, state, total_items, succeeded_items,
                    started_at, completed_at, created_at, updated_at
                ) VALUES (500, 1, 'completed', 1, 1, 1, 1, 1, 1)`),
            env.DB.prepare(`INSERT INTO opml_import_items (
                    id, import_id, user_id, position, operation_id, feed_url,
                    normalized_feed_url, state, max_attempts, feed_id,
                    category_id, completed_at, created_at, updated_at
                ) VALUES (
                    501, 500, 1, 0, 'opml-retained-item',
                    'https://older.example.test/feed',
                    'https://older.example.test/feed', 'succeeded', 5,
                    7000, 10, 1, 1, 1
                )`),
            env.DB.prepare(`INSERT INTO chart_daily_activity (
                    user_id, feed_id, day_start, created_at, updated_at
                ) VALUES (1, 7000, 0, 1, 1)`),
            env.DB.prepare(`INSERT INTO chart_daily_refreshes (
                    feed_id, day_start, attempts_count, successes_count,
                    created_at, updated_at
                ) VALUES (7000, 0, 1, 1, 1, 1)`),
        ]);

        const migration = env.TEST_MIGRATIONS.find((candidate) =>
            candidate.name.includes('0017_monotonic_feed_ids'),
        );
        if (migration === undefined) {
            throw new Error('Missing monotonic feed ID migration');
        }
        await applyD1Migrations(
            env.DB,
            [{ ...migration, name: 'retained-feed-id-remap' }],
            'test_feed_id_migrations',
        );

        const [
            feeds,
            entries,
            subscriptions,
            interactions,
            refreshes,
            opmlItems,
            activity,
            dailyRefreshes,
            jobs,
            outbox,
            sequence,
            foreignKeys,
        ] = await env.DB.batch([
            env.DB.prepare('SELECT id, name FROM feeds ORDER BY id'),
            env.DB.prepare('SELECT feed_id FROM entries'),
            env.DB.prepare('SELECT feed_id FROM feed_subscriptions'),
            env.DB.prepare('SELECT feed_id FROM entry_interactions'),
            env.DB.prepare('SELECT feed_id FROM feed_refreshes'),
            env.DB.prepare('SELECT feed_id FROM opml_import_items'),
            env.DB.prepare('SELECT feed_id FROM chart_daily_activity'),
            env.DB.prepare('SELECT feed_id FROM chart_daily_refreshes'),
            env.DB.prepare(`SELECT operation_id,
                    json_extract(payload_json, '$.feedId') AS feed_id
                FROM jobs ORDER BY id`),
            env.DB.prepare('SELECT payload_json FROM outbox_messages'),
            env.DB.prepare(
                'SELECT next_id FROM feed_id_sequence WHERE singleton = 1',
            ),
            env.DB.prepare('PRAGMA foreign_key_check'),
        ]);

        expect(feeds.results).toEqual([
            { id: 1, name: 'Older' },
            { id: 2, name: 'Newer' },
        ]);
        for (const result of [
            entries,
            subscriptions,
            interactions,
            refreshes,
            opmlItems,
            activity,
            dailyRefreshes,
        ]) {
            expect(result.results).toEqual([{ feed_id: 1 }]);
        }
        expect(jobs.results).toEqual([
            {
                operation_id: 'feed-refresh:scheduled:7000:1',
                feed_id: 1,
            },
            {
                operation_id: 'favicon-refresh:stable-token',
                feed_id: 2,
            },
        ]);
        expect(outbox.results).toEqual([
            {
                payload_json: '{"operationId":"feed-refresh:scheduled:7000:1"}',
            },
        ]);
        expect(sequence.results).toEqual([{ next_id: 3 }]);
        expect(foreignKeys.results).toEqual([]);
    });
});

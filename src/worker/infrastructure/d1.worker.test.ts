import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { D1OperationError, makeD1 } from './d1';

const d1 = makeD1(env.DB);
const now = 1_800_000_000_000;

const bytes = (value: number) => new Uint8Array(32).fill(value);

const insertUser = (id: number, suffix: string) =>
    d1.run({
        sql: `
            INSERT INTO users (
                id, webauthn_user_handle, username, email, display_name,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        bindings: [
            id,
            bytes(id),
            `user-${suffix}`,
            `user-${suffix}@example.test`,
            `User ${suffix}`,
            now,
            now,
        ],
    });

const insertFeed = (id: number, suffix: string) =>
    d1.run({
        sql: `
            INSERT INTO feeds (
                id, name, feed_url, next_refresh_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
        `,
        bindings: [
            id,
            `Feed ${suffix}`,
            `https://example.test/${suffix}.xml`,
            now,
            now,
            now,
        ],
    });

const insertEntry = (id: number, feedId: number, suffix: string) =>
    d1.run({
        sql: `
            INSERT INTO entries (
                id, feed_id, deduplication_key, title, published_at,
                content_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'empty', ?, ?)
        `,
        bindings: [id, feedId, bytes(id), `Entry ${suffix}`, now, now, now],
    });

describe('D1 schema', () => {
    it('creates the target tables without password-era columns', async () => {
        const tables = await Effect.runPromise(
            d1.all<{ name: string }>({
                sql: `
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                `,
            }),
        );
        const tableNames = tables.results.map(({ name }) => name);

        expect(tableNames).toEqual(
            expect.arrayContaining([
                'users',
                'passkeys',
                'webauthn_challenges',
                'sessions',
                'app_tokens',
                'feeds',
                'entries',
                'entry_contents',
                'feed_subscriptions',
                'entry_interactions',
                'jobs',
                'outbox_messages',
                'opml_imports',
                'opml_import_items',
            ]),
        );

        const userColumns = await Effect.runPromise(
            d1.all<{ name: string }>({ sql: 'PRAGMA table_info(users)' }),
        );
        const columnNames = userColumns.results.map(({ name }) => name);

        expect(columnNames).not.toContain('password');
        expect(columnNames).not.toContain('two_factor_secret');

        const jobIndexes = await Effect.runPromise(
            d1.all<{ name: string }>({
                sql: `SELECT name FROM sqlite_master
                    WHERE type = 'index' AND tbl_name = 'jobs'`,
            }),
        );
        expect(jobIndexes.results.map(({ name }) => name)).toEqual(
            expect.arrayContaining([
                'jobs_feed_refresh_active_feed',
                'jobs_terminal_completed',
            ]),
        );

        const authRetentionIndexes = await Effect.runPromise(
            d1.all<{ name: string }>({
                sql: `SELECT name FROM sqlite_master
                    WHERE type = 'index' AND name LIKE '%retention%'`,
            }),
        );
        expect(authRetentionIndexes.results.map(({ name }) => name)).toEqual(
            expect.arrayContaining([
                'sessions_retention_revoked',
                'webauthn_challenges_retention_consumed',
                'user_access_links_retention_consumed',
                'user_access_links_retention_revoked',
                'security_events_retention',
            ]),
        );

        const activePlan = await Effect.runPromise(
            d1.all<{ detail: string }>({
                sql: `EXPLAIN QUERY PLAN
                    SELECT id FROM jobs
                    WHERE kind = 'feed_refresh'
                      AND state IN ('pending', 'queued', 'running', 'failed')
                      AND CAST(json_extract(payload_json, '$.feedId') AS INTEGER) = ?
                    ORDER BY updated_at, id LIMIT 1`,
                bindings: [1],
            }),
        );
        expect(
            activePlan.results.map(({ detail }) => detail).join('\n'),
        ).toContain('jobs_feed_refresh_active_feed');

        const retentionPlan = await Effect.runPromise(
            d1.all<{ detail: string }>({
                sql: `EXPLAIN QUERY PLAN
                    SELECT id FROM jobs
                    WHERE state IN ('succeeded', 'dead_lettered', 'canceled')
                      AND completed_at < ?
                    ORDER BY completed_at, id LIMIT 1`,
                bindings: [now],
            }),
        );
        expect(
            retentionPlan.results.map(({ detail }) => detail).join('\n'),
        ).toContain('jobs_terminal_completed');
    });

    it('rejects a subscription category owned by another user', async () => {
        await Effect.runPromise(insertUser(101, 'owner'));
        await Effect.runPromise(insertUser(102, 'subscriber'));
        await Effect.runPromise(insertFeed(201, 'ownership'));
        await Effect.runPromise(
            d1.run({
                sql: `
                    INSERT INTO subscription_categories (
                        id, user_id, name, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                `,
                bindings: [301, 101, 'Owner category', now, now],
            }),
        );

        const failure = Effect.runPromise(
            d1.run({
                sql: `
                    INSERT INTO feed_subscriptions (
                        user_id, feed_id, category_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                `,
                bindings: [102, 201, 301, now, now],
            }),
        );

        await expect(failure).rejects.toBeInstanceOf(D1OperationError);
    });

    it('enforces same-feed read watermarks and sparse interactions', async () => {
        await Effect.runPromise(insertUser(103, 'reader'));
        await Effect.runPromise(insertFeed(202, 'reader-a'));
        await Effect.runPromise(insertFeed(203, 'reader-b'));
        await Effect.runPromise(insertEntry(401, 202, 'reader-a'));
        await Effect.runPromise(insertEntry(402, 203, 'reader-b'));
        await Effect.runPromise(
            d1.run({
                sql: `
                    INSERT INTO subscription_categories (
                        id, user_id, name, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                `,
                bindings: [302, 103, 'Reader category', now, now],
            }),
        );
        await Effect.runPromise(
            d1.run({
                sql: `
                    INSERT INTO feed_subscriptions (
                        user_id, feed_id, category_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                `,
                bindings: [103, 202, 302, now, now],
            }),
        );

        await expect(
            Effect.runPromise(
                d1.run({
                    sql: `
                        UPDATE feed_subscriptions
                        SET read_through_entry_id = ?
                        WHERE user_id = ? AND feed_id = ?
                    `,
                    bindings: [402, 103, 202],
                }),
            ),
        ).rejects.toBeInstanceOf(D1OperationError);

        await expect(
            Effect.runPromise(
                d1.run({
                    sql: `
                        INSERT INTO entry_interactions (
                            user_id, feed_id, entry_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?)
                    `,
                    bindings: [103, 202, 401, now, now],
                }),
            ),
        ).rejects.toBeInstanceOf(D1OperationError);
    });
});

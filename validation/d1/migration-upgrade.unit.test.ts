import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = fileURLToPath(
    new URL('../../migrations', import.meta.url),
);

const field = (row: unknown, name: string): unknown =>
    typeof row === 'object' && row !== null
        ? Reflect.get(row, name)
        : undefined;

describe('D1 migration upgrades', () => {
    it('reconciles duplicate active refresh jobs before adding the fence', async () => {
        const database = new DatabaseSync(':memory:');
        try {
            database.exec('PRAGMA foreign_keys = ON');
            const migrations = (await readdir(migrationsDirectory))
                .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
                .toSorted();

            for (const migration of migrations.filter(
                (name) => name < '0013_terminal_job_retention.sql',
            )) {
                database.exec(
                    await readFile(
                        new URL(
                            `../../migrations/${migration}`,
                            import.meta.url,
                        ),
                        'utf8',
                    ),
                );
            }

            database.exec(`
                INSERT INTO jobs (
                    id, operation_id, kind, state, payload_json, max_attempts,
                    available_at, created_at, updated_at
                ) VALUES
                    (101, 'refresh:pending', 'feed_refresh', 'pending',
                     '{"feedId":1,"trigger":"scheduled"}', 8, 100, 100, 100),
                    (102, 'refresh:queued', 'feed_refresh', 'queued',
                     '{"feedId":1,"trigger":"scheduled"}', 8, 90, 90, 90);
                INSERT INTO outbox_messages (
                    id, job_id, topic, payload_json, state, available_at,
                    created_at, updated_at
                ) VALUES (
                    201, 101, 'feed_refresh',
                    '{"operationId":"refresh:pending"}', 'pending',
                    100, 100, 100
                );
            `);

            for (const migration of migrations.filter(
                (name) => name >= '0013_terminal_job_retention.sql',
            )) {
                database.exec(
                    await readFile(
                        new URL(
                            `../../migrations/${migration}`,
                            import.meta.url,
                        ),
                        'utf8',
                    ),
                );
            }

            const active = database
                .prepare(`SELECT COUNT(*) AS count FROM jobs
                    WHERE kind = 'feed_refresh'
                      AND state IN ('pending', 'queued', 'running', 'failed')
                      AND CAST(json_extract(payload_json, '$.feedId') AS INTEGER) = 1`)
                .get();
            const canceled = database
                .prepare('SELECT state FROM jobs WHERE id = 101')
                .get();
            const outbox = database
                .prepare('SELECT state FROM outbox_messages WHERE job_id = 101')
                .get();

            expect(field(active, 'count')).toBe(1);
            expect(field(canceled, 'state')).toBe('canceled');
            expect(field(outbox, 'state')).toBe('dead_lettered');
            expect(() =>
                database.exec(`INSERT INTO jobs (
                    id, operation_id, kind, state, payload_json, max_attempts,
                    available_at, created_at, updated_at
                ) VALUES (
                    103, 'refresh:third', 'feed_refresh', 'pending',
                    '{"feedId":1,"trigger":"manual"}', 8, 110, 110, 110
                )`),
            ).toThrow('UNIQUE constraint failed');
            expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual(
                [],
            );
        } finally {
            database.close();
        }
    });

    it('backfills the entry counters of existing feeds and subscriptions', async () => {
        const database = new DatabaseSync(':memory:');
        try {
            database.exec('PRAGMA foreign_keys = ON');
            const migrations = (await readdir(migrationsDirectory))
                .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
                .toSorted();
            const apply = async (name: string) =>
                database.exec(
                    await readFile(
                        new URL(`../../migrations/${name}`, import.meta.url),
                        'utf8',
                    ),
                );
            for (const migration of migrations.filter(
                (name) => name < '0029_entry_counters.sql',
            )) {
                await apply(migration);
            }

            database.exec(`
                INSERT INTO users (
                    id, webauthn_user_handle, username, email, display_name,
                    created_at, updated_at
                ) VALUES (1, randomblob(32), 'u', 'u@example.test', 'U', 0, 0);
                INSERT INTO subscription_categories (id, user_id, name, created_at, updated_at)
                VALUES (1, 1, 'News', 0, 0);
                INSERT INTO feeds (id, name, feed_url, next_refresh_at, created_at, updated_at)
                VALUES (1, 'One', 'https://one.example.test/', 0, 0, 0),
                       (2, 'Two', 'https://two.example.test/', 0, 0, 0);
                INSERT INTO entries (
                    id, feed_id, deduplication_key, title, published_at,
                    content_status, created_at, updated_at
                ) VALUES
                    (10, 1, randomblob(32), 'a', 0, 'empty', 0, 0),
                    (11, 1, randomblob(32), 'b', 0, 'empty', 0, 0),
                    (12, 1, randomblob(32), 'c', 0, 'empty', 0, 0),
                    (13, 2, randomblob(32), 'd', 0, 'empty', 0, 0);
                INSERT INTO feed_subscriptions (
                    user_id, feed_id, category_id, read_through_entry_id,
                    created_at, updated_at
                ) VALUES (1, 1, 1, 11, 0, 0), (1, 2, 1, NULL, 0, 0);
            `);

            for (const migration of migrations.filter(
                (name) => name >= '0029_entry_counters.sql',
            )) {
                await apply(migration);
            }

            expect(
                database
                    .prepare('SELECT id, entry_count FROM feeds ORDER BY id')
                    .all()
                    .map((row) => [
                        field(row, 'id'),
                        field(row, 'entry_count'),
                    ]),
            ).toEqual([
                [1, 3],
                [2, 1],
            ]);
            expect(
                database
                    .prepare(
                        'SELECT feed_id, read_through_count FROM feed_subscriptions ORDER BY feed_id',
                    )
                    .all()
                    .map((row) => [
                        field(row, 'feed_id'),
                        field(row, 'read_through_count'),
                    ]),
            ).toEqual([
                [1, 2],
                [2, 0],
            ]);
        } finally {
            database.close();
        }
    });
});

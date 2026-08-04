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
});

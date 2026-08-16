import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = fileURLToPath(
    new URL('../../migrations', import.meta.url),
);

describe('feed favicon source migration', () => {
    it('backfills the advertised URL without changing selected asset state', async () => {
        const database = new DatabaseSync(':memory:');
        try {
            database.exec('PRAGMA foreign_keys = ON');
            const migrations = (await readdir(migrationsDirectory))
                .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
                .toSorted();

            for (const migration of migrations.filter(
                (name) => name < '0021_feed_favicon_url.sql',
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

            const selectedUrl = 'https://migration.example.test/selected.png';
            const assetHash = 'a'.repeat(64);
            database
                .prepare(`INSERT INTO feeds (
                    id, name, feed_url, favicon_url, favicon_asset_hash,
                    favicon_is_dark, favicon_updated_at, next_refresh_at,
                    created_at, updated_at
                ) VALUES (?, 'Migrated feed', ?, ?, ?, 1, ?, ?, ?, ?)`)
                .run(
                    101,
                    'https://migration.example.test/feed.xml',
                    selectedUrl,
                    assetHash,
                    100,
                    200,
                    50,
                    100,
                );

            database.exec(
                await readFile(
                    new URL(
                        '../../migrations/0021_feed_favicon_url.sql',
                        import.meta.url,
                    ),
                    'utf8',
                ),
            );

            expect(
                database
                    .prepare(`SELECT feed_favicon_url, favicon_url,
                        favicon_asset_hash, favicon_is_dark,
                        favicon_updated_at FROM feeds WHERE id = ?`)
                    .get(101),
            ).toEqual({
                feed_favicon_url: selectedUrl,
                favicon_url: selectedUrl,
                favicon_asset_hash: assetHash,
                favicon_is_dark: 1,
                favicon_updated_at: 100,
            });
            expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual(
                [],
            );
        } finally {
            database.close();
        }
    });
});

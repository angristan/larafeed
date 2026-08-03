import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { makeD1 } from '../infrastructure/d1';
import { makeD1FaviconAssetRepository, makeFaviconAssetStore } from './assets';

const d1 = makeD1(env.DB);
const repository = makeD1FaviconAssetRepository(d1);
const transparentPng = Uint8Array.from(
    atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ),
    (character) => character.charCodeAt(0),
);

describe('favicon D1 assets', () => {
    it('stores and deduplicates one normalized PNG', async () => {
        const store = makeFaviconAssetStore({
            repository,
            images: env.IMAGES,
            now: () => 1_900_000_000_000,
        });

        const first = await store.persist(transparentPng);
        const stored = await repository.find(first.hash);

        expect(first.hash).toMatch(/^[a-f0-9]{64}$/u);
        expect(first.isDark).toBe(true);
        expect(stored).not.toBeNull();
        expect(Array.from(stored?.subarray(0, 8) ?? [])).toEqual([
            137, 80, 78, 71, 13, 10, 26, 10,
        ]);

        await expect(store.persist(transparentPng)).resolves.toEqual(first);
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT COUNT(*) AS count FROM favicon_assets WHERE hash = ?',
                        bindings: [first.hash],
                    },
                    'count',
                ),
            ),
        ).resolves.toBe(1);
    });

    it('serves a stored asset through the default public route', async () => {
        const hash = 'e'.repeat(64);
        await repository.put(hash, transparentPng, 2_000);

        const response = await createApp().request(
            `https://larafeedcf.stanislas.cloud/api/public/favicons/v1/${hash}.png`,
            {},
            env,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('cache-control')).toBe(
            'public, max-age=31536000, immutable',
        );
        expect(response.headers.get('etag')).toBe(`"${hash}"`);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
            transparentPng,
        );
    });

    it('deletes only old unreferenced assets in bounded batches', async () => {
        const orphanHash = 'c'.repeat(64);
        const referencedHash = 'd'.repeat(64);
        const createdAt = 1_000;
        await repository.put(orphanHash, transparentPng, createdAt);
        await repository.put(referencedHash, transparentPng, createdAt);
        await Effect.runPromise(
            d1.run({
                sql: `INSERT INTO feeds (
                        id, name, feed_url, favicon_asset_hash,
                        next_refresh_at, created_at, updated_at
                    ) VALUES (?, 'Asset feed', ?, ?, ?, ?, ?)`,
                bindings: [
                    965_001,
                    'https://favicon-assets.example.test/feed.xml',
                    referencedHash,
                    createdAt,
                    createdAt,
                    createdAt,
                ],
            }),
        );

        await expect(repository.deleteOrphans(createdAt + 1, 1)).resolves.toBe(
            1,
        );
        await expect(repository.find(orphanHash)).resolves.toBeNull();
        await expect(repository.find(referencedHash)).resolves.not.toBeNull();
    });
});

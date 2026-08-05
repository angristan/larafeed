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
const contentHash = async (bytes: Uint8Array): Promise<string> => {
    const source = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(source).set(bytes);
    return Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', source)),
        (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
};
const legacyIco = (): Uint8Array => {
    const width = 32;
    const height = 32;
    const xorLength = width * height * 4;
    const maskLength = Math.floor((width + 31) / 32) * 4 * height;
    const frame = new Uint8Array(40 + xorLength + maskLength);
    const frameView = new DataView(frame.buffer);
    frameView.setUint32(0, 40, true);
    frameView.setInt32(4, width, true);
    frameView.setInt32(8, height * 2, true);
    frameView.setUint16(12, 1, true);
    frameView.setUint16(14, 32, true);
    frameView.setUint32(20, xorLength, true);
    for (let offset = 40; offset < 40 + xorLength; offset += 4)
        frame.set([0x10, 0x80, 0xf0, 0xff], offset);

    const source = new Uint8Array(22 + frame.byteLength);
    const sourceView = new DataView(source.buffer);
    sourceView.setUint16(2, 1, true);
    sourceView.setUint16(4, 1, true);
    source[6] = width;
    source[7] = height;
    sourceView.setUint16(10, 1, true);
    sourceView.setUint16(12, 32, true);
    sourceView.setUint32(14, frame.byteLength, true);
    sourceView.setUint32(18, 22, true);
    source.set(frame, 22);
    return source;
};

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
        expect(stored?.contentType).toBe('image/png');
        expect(Array.from(stored?.bytes.subarray(0, 8) ?? [])).toEqual([
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

    it('decodes and stores a legacy ICO inside Workerd', async () => {
        const store = makeFaviconAssetStore({
            repository,
            images: env.IMAGES,
            now: () => 1_900_000_000_001,
        });

        const asset = await store.persist(legacyIco());
        const stored = await repository.find(asset.hash);

        expect(stored).not.toBeNull();
        if (stored === null) throw new Error('Expected stored ICO asset');
        expect(stored.contentType).toBe('image/png');
        expect(Array.from(stored.bytes.subarray(0, 8))).toEqual([
            137, 80, 78, 71, 13, 10, 26, 10,
        ]);
        expect(
            new DataView(
                stored.bytes.buffer,
                stored.bytes.byteOffset,
                stored.bytes.byteLength,
            ).getUint32(16),
        ).toBe(32);
    });

    it('sanitizes and isolates SVG storage without rasterizing it', async () => {
        const source = new TextEncoder().encode(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
                <path fill="#111" d="M0 0h64v64H0z" />
            </svg>`,
        );
        const store = makeFaviconAssetStore({
            repository,
            images: env.IMAGES,
            now: () => 1_900_000_000_002,
        });

        const asset = await store.persist(source);
        const stored = await repository.find(asset.hash);

        expect(asset.isDark).toBeNull();
        expect(stored).not.toBeNull();
        if (stored === null) throw new Error('Expected stored SVG asset');
        expect(stored.contentType).toBe('image/svg+xml');
        expect(new TextDecoder().decode(stored.bytes)).toBe(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#111" d="M0 0h64v64H0z"/></svg>',
        );
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT COUNT(*) AS count FROM favicon_svg_assets WHERE hash = ?',
                        bindings: [asset.hash],
                    },
                    'count',
                ),
            ),
        ).resolves.toBe(1);
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT COUNT(*) AS count FROM favicon_assets WHERE hash = ?',
                        bindings: [asset.hash],
                    },
                    'count',
                ),
            ),
        ).resolves.toBe(0);

        const response = await createApp().request(
            `https://larafeedcf.stanislas.cloud/api/public/favicons/v1/${asset.hash}.png`,
            {},
            env,
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/svg+xml');
        expect(response.headers.get('content-security-policy')).toBe(
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        );
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
            stored.bytes,
        );
    });

    it('serves a stored asset through the default public route', async () => {
        const hash = await contentHash(transparentPng);
        await expect(
            repository.put(
                'e'.repeat(64),
                { bytes: transparentPng, contentType: 'image/png' },
                2_000,
            ),
        ).rejects.toBeDefined();
        await repository.put(
            hash,
            { bytes: transparentPng, contentType: 'image/png' },
            2_000,
        );

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

    it('deletes the oldest unreferenced assets across both formats', async () => {
        const svgOrphanHash = 'b'.repeat(64);
        const pngOrphanHash = 'c'.repeat(64);
        const referencedHash = 'd'.repeat(64);
        const createdAt = 1_000;
        await Effect.runPromise(
            d1.batch([
                {
                    sql: `INSERT INTO favicon_svg_assets (hash, svg, created_at)
                        VALUES (?, ?, ?)`,
                    bindings: [
                        svgOrphanHash,
                        new TextEncoder().encode('<svg/>'),
                        createdAt - 1,
                    ],
                },
                {
                    sql: `INSERT INTO favicon_assets (hash, png, created_at)
                        VALUES (?, ?, ?), (?, ?, ?)`,
                    bindings: [
                        pngOrphanHash,
                        transparentPng,
                        createdAt,
                        referencedHash,
                        transparentPng,
                        createdAt - 2,
                    ],
                },
                {
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
                },
            ]),
        );

        await expect(repository.deleteOrphans(createdAt + 1, 1)).resolves.toBe(
            1,
        );
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: `SELECT COUNT(*) AS count
                            FROM favicon_svg_assets WHERE hash = ?`,
                        bindings: [svgOrphanHash],
                    },
                    'count',
                ),
            ),
        ).resolves.toBe(0);
        await expect(repository.deleteOrphans(createdAt + 1, 1)).resolves.toBe(
            1,
        );
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: `SELECT COUNT(*) AS count FROM favicon_assets
                            WHERE hash IN (?, ?)`,
                        bindings: [pngOrphanHash, referencedHash],
                    },
                    'count',
                ),
            ),
        ).resolves.toBe(1);
    });
});

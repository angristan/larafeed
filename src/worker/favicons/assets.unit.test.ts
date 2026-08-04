import { describe, expect, it, vi } from 'vitest';

import {
    FAVICON_ASSET_CACHE_CONTROL,
    type FaviconAssetRepository,
    faviconAssetPath,
    feedFaviconUrl,
    makeFaviconAssetStore,
} from './assets';

const bytes = (values: ArrayLike<number>): ArrayBuffer =>
    Uint8Array.from(values).buffer;
const normalizedPng = Uint8Array.from(
    atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ),
    (character) => character.charCodeAt(0),
);

const makeImages = (outputBytes = normalizedPng) => {
    const output = vi.fn(async () => ({
        response: () =>
            new Response(bytes(outputBytes), {
                headers: {
                    'content-length': String(outputBytes.byteLength),
                    'content-type': 'image/png',
                },
            }),
    }));
    const transform = vi.fn(() => ({ output }));
    const input = vi.fn(() => ({ transform }));
    return {
        images: { input } as unknown as ImagesBinding,
        input,
        transform,
        output,
    };
};

const makeRepository = () => {
    const put = vi.fn(async () => undefined);
    const find = vi.fn(async () => null);
    const deleteOrphans = vi.fn(async () => 0);
    return {
        repository: {
            put,
            find,
            deleteOrphans,
        } satisfies FaviconAssetRepository,
        put,
    };
};

describe('favicon assets', () => {
    it('builds only versioned same-origin content-addressed paths', () => {
        const hash = 'a'.repeat(64);
        expect(faviconAssetPath(hash)).toBe(
            `/api/public/favicons/v1/${hash}.png`,
        );
        expect(() => faviconAssetPath('../not-a-hash')).toThrow();
    });

    it('uses immutable assets and the legacy proxy only during backfill', () => {
        const hash = 'b'.repeat(64);
        expect(
            feedFaviconUrl({
                feedId: 7,
                upstreamUrl: 'https://publisher.example/icon.ico',
                assetHash: hash,
            }),
        ).toBe(`/api/public/favicons/v1/${hash}.png`);
        expect(
            feedFaviconUrl({
                feedId: 7,
                upstreamUrl: 'https://publisher.example/icon.ico',
                assetHash: null,
            }),
        ).toBe('/api/images/feeds/7/small');
        expect(
            feedFaviconUrl({
                feedId: 7,
                upstreamUrl: null,
                assetHash: null,
            }),
        ).toBeNull();
        expect(FAVICON_ASSET_CACHE_CONTROL).toBe(
            'public, max-age=31536000, immutable',
        );
    });

    it('normalizes once and stores PNG bytes by their digest', async () => {
        const images = makeImages();
        const repository = makeRepository();
        const store = makeFaviconAssetStore({
            repository: repository.repository,
            images: images.images,
            now: () => 1234,
        });

        const asset = await store.persist(Uint8Array.from([9, 8, 7]));

        expect(asset.hash).toMatch(/^[a-f0-9]{64}$/u);
        expect(asset.isDark).toBe(true);
        expect(images.transform).toHaveBeenCalledWith({
            width: 32,
            height: 32,
            fit: 'cover',
        });
        expect(images.output).toHaveBeenCalledWith({
            format: 'image/png',
            quality: 80,
            anim: false,
        });
        expect(repository.put).toHaveBeenCalledWith(
            asset.hash,
            normalizedPng,
            1234,
        );
    });

    it('fails closed for invalid or oversized Images output', async () => {
        const repository = makeRepository();
        const wrongMime = makeImages();
        wrongMime.output.mockResolvedValueOnce({
            response: () =>
                new Response(bytes([1]), {
                    headers: { 'content-type': 'image/svg+xml' },
                }),
        });
        await expect(
            makeFaviconAssetStore({
                repository: repository.repository,
                images: wrongMime.images,
            }).persist(Uint8Array.from([1])),
        ).rejects.toMatchObject({ _tag: 'FaviconAssetStorageError' });

        const oversized = makeImages(new Uint8Array(64 * 1024 + 1));
        await expect(
            makeFaviconAssetStore({
                repository: repository.repository,
                images: oversized.images,
            }).persist(Uint8Array.from([1])),
        ).rejects.toMatchObject({ _tag: 'FaviconAssetStorageError' });
        expect(repository.put).not.toHaveBeenCalled();
    });
});

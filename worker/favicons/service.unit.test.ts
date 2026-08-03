import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { FaviconRepository } from './repository';
import { discoverFaviconLinks, makeFaviconService } from './service';

const bytes = (value: string) => new TextEncoder().encode(value);
const target = {
    feedId: 7,
    feedUrl: 'https://example.test/feed.xml',
    siteUrl: 'https://example.test/articles',
    faviconUrl: null,
    faviconAssetHash: null,
    faviconIsDark: null,
    faviconUpdatedAt: null,
};
const repository = () =>
    ({
        findOwnedTarget: () => Effect.succeed(target),
        findStaleTarget: () => Effect.succeed(target),
        listStaleTargets: () => Effect.succeed([target]),
        update: () => Effect.void,
    }) satisfies FaviconRepository;

describe('favicon service', () => {
    it('ranks safe HTML icon candidates and ignores SVG/private targets', () => {
        const links = discoverFaviconLinks(
            bytes(`<head>
                <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
                <link rel="icon" sizes="32x32" type="image/png" href="/best.png">
                <link rel="icon" type="image/svg+xml" href="/vector.svg">
                <link rel="icon" href="http://127.0.0.1/private.png">
            </head>`),
            new URL('https://example.test/articles'),
        );

        expect(links.map(({ href }) => href)).toEqual([
            'https://example.test/best.png',
            'https://example.test/apple.png',
        ]);
    });

    it('discovers, probes, and persists the first valid image', async () => {
        const accountRepository = repository();
        const update = vi.spyOn(accountRepository, 'update');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    '<link rel="icon" type="image/png" sizes="32x32" href="/icon.png">',
                    { headers: { 'content-type': 'text/html' } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(new Uint8Array([1, 2, 3]), {
                    headers: { 'content-type': 'image/png' },
                }),
            );
        const analyzeDarkness = vi.fn().mockResolvedValue(true);
        const service = makeFaviconService({
            repository: accountRepository,
            fetch: fetchMock,
            analyzeDarkness,
            now: () => 1_900_000_000_000,
        });

        await expect(
            Effect.runPromise(service.refreshOwned(1, target.feedId)),
        ).resolves.toEqual({
            feedId: target.feedId,
            faviconUrl: 'https://example.test/icon.png',
            faviconAssetHash: null,
        });
        expect(update).toHaveBeenCalledWith(
            target.feedId,
            'https://example.test/icon.png',
            null,
            true,
            1_900_000_000_000,
            target.faviconUrl,
            target.faviconUpdatedAt,
        );
        expect(analyzeDarkness).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            new URL('https://example.test/articles'),
            expect.objectContaining({ redirect: 'manual' }),
        );
    });

    it('persists the normalized D1 asset before switching the feed reference', async () => {
        const accountRepository = repository();
        const update = vi.spyOn(accountRepository, 'update');
        const persist = vi.fn().mockResolvedValue({
            hash: 'a'.repeat(64),
            isDark: false,
        });
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response('<link rel="icon" href="/icon.png">', {
                    headers: { 'content-type': 'text/html' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(new Uint8Array([1, 2, 3]), {
                    headers: { 'content-type': 'image/png' },
                }),
            );
        const service = makeFaviconService({
            repository: accountRepository,
            fetch: fetchMock,
            assetStore: { persist },
            now: () => 77,
        });

        await expect(
            Effect.runPromise(service.refreshOwned(1, target.feedId)),
        ).resolves.toEqual({
            feedId: target.feedId,
            faviconUrl: 'https://example.test/icon.png',
            faviconAssetHash: 'a'.repeat(64),
        });
        expect(persist).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
        expect(update).toHaveBeenCalledWith(
            target.feedId,
            'https://example.test/icon.png',
            'a'.repeat(64),
            false,
            77,
            target.faviconUrl,
            target.faviconUpdatedAt,
        );
        expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
            update.mock.invocationCallOrder[0] ?? 0,
        );
    });

    it('keeps the previous feed reference when asset persistence fails', async () => {
        const current = {
            ...target,
            faviconUrl: 'https://example.test/current.png',
            faviconAssetHash: 'b'.repeat(64),
            faviconIsDark: true,
        };
        const accountRepository: FaviconRepository = {
            findOwnedTarget: () => Effect.succeed(current),
            findStaleTarget: () => Effect.succeed(current),
            listStaleTargets: () => Effect.succeed([current]),
            update: () => Effect.void,
        };
        const update = vi.spyOn(accountRepository, 'update');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response('<link rel="icon" href="/replacement.png">', {
                    headers: { 'content-type': 'text/html' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(new Uint8Array([4, 5, 6]), {
                    headers: { 'content-type': 'image/png' },
                }),
            );
        const service = makeFaviconService({
            repository: accountRepository,
            fetch: fetchMock,
            assetStore: {
                persist: vi
                    .fn()
                    .mockRejectedValue(new Error('asset storage unavailable')),
            },
            now: () => 88,
        });

        await expect(
            Effect.runPromise(service.refreshOwned(1, target.feedId)),
        ).rejects.toMatchObject({ _tag: 'FaviconDiscoveryError' });
        expect(update).not.toHaveBeenCalled();
    });

    it('skips a scoped favicon that is already fresh', async () => {
        const accountRepository: FaviconRepository = {
            ...repository(),
            findStaleTarget: () => Effect.succeed(null),
        };
        const fetchMock = vi.fn();
        const service = makeFaviconService({
            repository: accountRepository,
            fetch: fetchMock,
            now: () => 1_900_000_000_000,
        });

        await expect(
            Effect.runPromise(service.refreshIfStale(target.feedId)),
        ).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('preserves the current icon when every probe is inconclusive', async () => {
        const current = {
            ...target,
            faviconUrl: 'https://example.test/current.png',
            faviconIsDark: true,
        };
        const accountRepository: FaviconRepository = {
            findOwnedTarget: () => Effect.succeed(current),
            findStaleTarget: () => Effect.succeed(current),
            listStaleTargets: () => Effect.succeed([current]),
            update: () => Effect.void,
        };
        const update = vi.spyOn(accountRepository, 'update');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response('<html></html>', {
                    headers: { 'content-type': 'text/html' },
                }),
            )
            .mockResolvedValue(new Response('missing', { status: 404 }));
        const service = makeFaviconService({
            repository: accountRepository,
            fetch: fetchMock,
            now: () => 99,
        });

        await expect(
            Effect.runPromise(service.refreshOwned(1, target.feedId)),
        ).resolves.toEqual({
            feedId: target.feedId,
            faviconUrl: current.faviconUrl,
            faviconAssetHash: null,
        });
        expect(update).toHaveBeenCalledWith(
            target.feedId,
            current.faviconUrl,
            null,
            true,
            99,
            current.faviconUrl,
            current.faviconUpdatedAt,
        );
    });

    it('persists light analysis and clears stale darkness for inconclusive new icons', async () => {
        for (const [analysis, expected] of [
            [false, false],
            [null, null],
        ] as const) {
            const current = {
                ...target,
                faviconUrl: 'https://example.test/old.png',
                faviconIsDark: true,
            };
            const accountRepository: FaviconRepository = {
                findOwnedTarget: () => Effect.succeed(current),
                findStaleTarget: () => Effect.succeed(current),
                listStaleTargets: () => Effect.succeed([current]),
                update: () => Effect.void,
            };
            const update = vi.spyOn(accountRepository, 'update');
            const fetchMock = vi
                .fn()
                .mockResolvedValueOnce(
                    new Response('<link rel="icon" href="/replacement.png">', {
                        headers: { 'content-type': 'text/html' },
                    }),
                )
                .mockResolvedValueOnce(
                    new Response(new Uint8Array([4, 5, 6]), {
                        headers: { 'content-type': 'image/png' },
                    }),
                );
            const service = makeFaviconService({
                repository: accountRepository,
                fetch: fetchMock,
                analyzeDarkness: vi.fn().mockResolvedValue(analysis),
                now: () => 101,
            });

            await Effect.runPromise(service.refreshOwned(1, target.feedId));

            expect(update).toHaveBeenCalledWith(
                target.feedId,
                'https://example.test/replacement.png',
                null,
                expected,
                101,
                current.faviconUrl,
                current.faviconUpdatedAt,
            );
        }
    });

    it('preserves known darkness when same-URL analysis fails', async () => {
        const current = {
            ...target,
            faviconUrl: 'https://example.test/current.png',
            faviconIsDark: true,
        };
        const accountRepository: FaviconRepository = {
            findOwnedTarget: () => Effect.succeed(current),
            findStaleTarget: () => Effect.succeed(current),
            listStaleTargets: () => Effect.succeed([current]),
            update: () => Effect.void,
        };
        const update = vi.spyOn(accountRepository, 'update');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response('<link rel="icon" href="/current.png">', {
                    headers: { 'content-type': 'text/html' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(new Uint8Array([7, 8, 9]), {
                    headers: { 'content-type': 'image/png' },
                }),
            );
        const service = makeFaviconService({
            repository: accountRepository,
            fetch: fetchMock,
            analyzeDarkness: vi.fn().mockRejectedValue(new Error('failed')),
            now: () => 102,
        });

        await Effect.runPromise(service.refreshOwned(1, target.feedId));

        expect(update).toHaveBeenCalledWith(
            target.feedId,
            current.faviconUrl,
            null,
            true,
            102,
            current.faviconUrl,
            current.faviconUpdatedAt,
        );
    });

    it('records a completed check when every bounded candidate fails', async () => {
        const accountRepository = repository();
        const update = vi.spyOn(accountRepository, 'update');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response('<html></html>', {
                    headers: { 'content-type': 'text/html' },
                }),
            )
            .mockResolvedValue(new Response('missing', { status: 404 }));
        const service = makeFaviconService({
            repository: accountRepository,
            fetch: fetchMock,
            now: () => 100,
        });

        await expect(
            Effect.runPromise(service.refreshStale(1)),
        ).resolves.toEqual([
            {
                feedId: target.feedId,
                faviconUrl: null,
                faviconAssetHash: null,
            },
        ]);
        expect(update).toHaveBeenCalledWith(
            target.feedId,
            null,
            null,
            null,
            100,
            target.faviconUrl,
            target.faviconUpdatedAt,
        );
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });
});

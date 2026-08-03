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
    faviconIsDark: null,
};
const repository = () =>
    ({
        findOwnedTarget: () => Effect.succeed(target),
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
        });
        expect(update).toHaveBeenCalledWith(
            target.feedId,
            'https://example.test/icon.png',
            true,
            1_900_000_000_000,
        );
        expect(analyzeDarkness).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            new URL('https://example.test/articles'),
            expect.objectContaining({ redirect: 'manual' }),
        );
    });

    it('preserves the current icon when every probe is inconclusive', async () => {
        const current = {
            ...target,
            faviconUrl: 'https://example.test/current.png',
            faviconIsDark: true,
        };
        const accountRepository: FaviconRepository = {
            findOwnedTarget: () => Effect.succeed(current),
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
        });
        expect(update).toHaveBeenCalledWith(
            target.feedId,
            current.faviconUrl,
            true,
            99,
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
                expected,
                101,
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
            true,
            102,
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
        ).resolves.toEqual([{ feedId: target.feedId, faviconUrl: null }]);
        expect(update).toHaveBeenCalledWith(target.feedId, null, null, 100);
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });
});

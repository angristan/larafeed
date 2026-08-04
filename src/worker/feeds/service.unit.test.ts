import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    FeedHttpError,
    FeedNetworkError,
    FeedPolicyError,
    FeedSizeError,
    FeedTimeoutError,
} from './errors';
import { MAX_FEED_ENTRIES } from './parser';
import {
    COMMON_FEED_DISCOVERY_PATHS,
    FEED_FETCH_TIMEOUT_MS,
    FEED_USER_AGENT,
    MAX_FEED_REDIRECTS,
    MAX_FEED_RESPONSE_BYTES,
    makeFeedRefreshService,
} from './service';

const source = {
    url: 'https://feeds.example.com/feed.xml',
    etag: '"version-1"',
    lastModified: 'Sat, 18 Jul 2026 10:00:00 GMT',
} as const;
const rss = `<rss><channel><title>Example</title><item><guid>1</guid><title>One</title><pubDate>2026-07-18T10:00:00Z</pubDate></item></channel></rss>`;
const jsonFeed = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON Feed',
    items: [
        {
            id: 'json-1',
            url: '/posts/1',
            content_html: '<p>JSON body</p>',
        },
    ],
});

const failure = <A>(effect: Effect.Effect<A, unknown>) =>
    Effect.runPromise(Effect.flip(effect));

afterEach(() => {
    vi.useRealTimers();
});

describe('feed refresh service', () => {
    it('sends stable conditional request headers and handles 304', async () => {
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
                new Response(null, {
                    status: 304,
                    headers: { etag: '"version-2"' },
                }),
        );
        const service = makeFeedRefreshService({ fetch: fetchMock });

        const result = await Effect.runPromise(service.refresh(source));

        expect(result).toEqual({
            kind: 'not-modified',
            finalUrl: source.url,
            etag: '"version-2"',
            lastModified: source.lastModified,
            httpStatus: 304,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe(source.url);
        expect(init).toMatchObject({ method: 'GET', redirect: 'manual' });
        const headers = new Headers(init?.headers);
        expect(headers.get('if-none-match')).toBe(source.etag);
        expect(headers.get('if-modified-since')).toBe(source.lastModified);
        expect(headers.get('user-agent')).toBe(FEED_USER_AGENT);
        expect(headers.get('accept')).toContain('application/feed+json');
        expect(headers.get('accept')).toContain('application/json');
        expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('manually validates every redirect and resolves relative locations', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 302,
                    headers: { location: '../next/feed.xml' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(rss, {
                    headers: { 'content-type': 'application/rss+xml' },
                }),
            );
        const service = makeFeedRefreshService({
            fetch: fetchMock,
            now: () => Date.parse('2026-07-18T12:00:00Z'),
        });

        const result = await Effect.runPromise(service.refresh(source));

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            'https://feeds.example.com/next/feed.xml',
        );
        expect(result).toMatchObject({
            kind: 'updated',
            finalUrl: 'https://feeds.example.com/next/feed.xml',
        });
    });

    it.each([
        'http://127.0.0.1/feed',
        'http://metadata.local/feed',
        'https://service/feed',
        'https://feeds.example.com:8443/feed',
        'https://user:password@feeds.example.com/feed',
    ])('rejects an unsafe redirect to %s without fetching it', async (location) => {
        const fetchMock = vi.fn(
            async () =>
                new Response(null, { status: 302, headers: { location } }),
        );
        const service = makeFeedRefreshService({ fetch: fetchMock });

        const error = await failure(service.refresh(source));

        expect(error).toBeInstanceOf(FeedPolicyError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('bounds redirect traversal at five', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(null, {
                    status: 302,
                    headers: { location: '/again' },
                }),
        );
        const service = makeFeedRefreshService({ fetch: fetchMock });

        const error = await failure(service.refresh(source));

        expect(error).toMatchObject({
            _tag: 'FeedPolicyError',
            reason: 'too_many_redirects',
        });
        expect(fetchMock).toHaveBeenCalledTimes(MAX_FEED_REDIRECTS + 1);
    });

    it('applies one exact 15-second deadline to the fetch', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        'abort',
                        () => reject(init.signal?.reason),
                        { once: true },
                    );
                }),
        );
        const service = makeFeedRefreshService({ fetch: fetchMock });

        const result = failure(service.refresh(source));
        await vi.advanceTimersByTimeAsync(FEED_FETCH_TIMEOUT_MS - 1);
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const error = await result;

        expect(error).toBeInstanceOf(FeedTimeoutError);
        expect(error).toMatchObject({
            retryable: true,
            timeoutMs: FEED_FETCH_TIMEOUT_MS,
        });
    });

    it('accepts ten MiB and rejects larger declared or streamed bodies', async () => {
        expect(MAX_FEED_RESPONSE_BYTES).toBe(10 * 1024 * 1024);

        const boundaryService = makeFeedRefreshService({
            fetch: async () =>
                new Response(rss, {
                    headers: {
                        'content-length': String(MAX_FEED_RESPONSE_BYTES),
                    },
                }),
        });
        await expect(
            Effect.runPromise(boundaryService.refresh(source)),
        ).resolves.toMatchObject({ kind: 'updated' });

        const contentLengthService = makeFeedRefreshService({
            fetch: async () =>
                new Response('small', {
                    headers: {
                        'content-length': String(MAX_FEED_RESPONSE_BYTES + 1),
                    },
                }),
        });
        expect(
            await failure(contentLengthService.refresh(source)),
        ).toBeInstanceOf(FeedSizeError);

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(8 * 1024 * 1024));
                controller.enqueue(new Uint8Array(3 * 1024 * 1024));
                controller.close();
            },
        });
        const streamService = makeFeedRefreshService({
            fetch: async () => new Response(stream),
        });
        const error = await failure(streamService.refresh(source));

        expect(error).toBeInstanceOf(FeedSizeError);
        expect(error).toMatchObject({
            retryable: false,
            limitBytes: MAX_FEED_RESPONSE_BYTES,
        });
    });

    it('rejects obvious binary MIME types before reading their bodies', async () => {
        const service = makeFeedRefreshService({
            fetch: async () =>
                new Response(new Uint8Array([0, 1, 2]), {
                    headers: { 'content-type': 'image/png' },
                }),
        });

        expect(await failure(service.refresh(source))).toMatchObject({
            _tag: 'FeedPolicyError',
            reason: 'binary_content_type',
        });
    });

    it('parses valid feeds served as generic octet streams', async () => {
        const service = makeFeedRefreshService({
            fetch: async () =>
                new Response(rss, {
                    headers: { 'content-type': 'application/octet-stream' },
                }),
            now: () => Date.parse('2026-07-18T12:00:00Z'),
        });

        await expect(
            Effect.runPromise(service.refresh(source)),
        ).resolves.toMatchObject({
            kind: 'updated',
            feed: { title: 'Example' },
        });
    });

    it('rejects malformed generic octet streams through feed parsing', async () => {
        const service = makeFeedRefreshService({
            fetch: async () =>
                new Response(new Uint8Array([0, 1, 2]), {
                    headers: { 'content-type': 'application/octet-stream' },
                }),
        });

        expect(await failure(service.refresh(source))).toMatchObject({
            _tag: 'FeedParseError',
        });
    });

    it('refreshes a structurally valid JSON Feed served as application/json', async () => {
        const service = makeFeedRefreshService({
            fetch: async () =>
                new Response(jsonFeed, {
                    headers: { 'content-type': 'application/json' },
                }),
            now: () => Date.parse('2026-07-18T12:00:00Z'),
        });

        const result = await Effect.runPromise(service.refresh(source));

        expect(result).toMatchObject({
            kind: 'updated',
            feed: { title: 'JSON Feed' },
            entries: [
                {
                    sourceId: 'json-1',
                    url: 'https://feeds.example.com/posts/1',
                    contentHtml: '<p>JSON body</p>',
                },
            ],
        });
    });

    it('refreshes oversized source lists with only the newest twenty entries', async () => {
        const count = 1_005;
        const items = Array.from({ length: count }, (_, index) => {
            const date = new Date(
                Date.parse('2026-07-18T11:00:00Z') - index * 60_000,
            ).toISOString();
            return `<item><guid>${index}</guid><title>${index}</title><pubDate>${date}</pubDate></item>`;
        })
            .reverse()
            .join('');
        const service = makeFeedRefreshService({
            fetch: async () =>
                new Response(
                    `<rss><channel><title>Large source</title>${items}</channel></rss>`,
                    { headers: { 'content-type': 'application/rss+xml' } },
                ),
            now: () => Date.parse('2026-07-18T12:00:00Z'),
        });

        const result = await Effect.runPromise(service.refresh(source));

        expect(result).toMatchObject({ kind: 'updated' });
        if (result.kind !== 'updated') throw new Error('Expected updated feed');
        expect(result.entries).toHaveLength(MAX_FEED_ENTRIES);
        expect(result.entries[0]?.sourceId).toBe('19');
        expect(result.entries.at(-1)?.sourceId).toBe('0');
    });

    it('accepts entity-heavy direct feeds without discovery fallback', async () => {
        const description = '&amp;'.repeat(50_000);
        const fetchMock = vi.fn(
            async () =>
                new Response(
                    `<rss><channel><title>Large feed</title><description>${description}</description><item><guid>one</guid><title>One</title></item></channel></rss>`,
                    { headers: { 'content-type': 'application/rss+xml' } },
                ),
        );
        const service = makeFeedRefreshService({ fetch: fetchMock });

        const result = await Effect.runPromise(service.discover(source.url));

        expect(result.feed.title).toBe('Large feed');
        expect(result.entries).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('preserves malformed direct-feed diagnostics without HTML fallback', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response('<rss><channel>', {
                    headers: { 'content-type': 'application/rss+xml' },
                }),
        );
        const service = makeFeedRefreshService({ fetch: fetchMock });

        const error = await failure(service.discover(source.url));

        expect(error).toMatchObject({
            _tag: 'FeedParseError',
            reason: 'malformed_xml',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('discovers and validates a JSON Feed alternate from an HTML page', async () => {
        const html = `<html><head>
            <link rel="alternate" type="application/feed+json" href="/feed.json">
            <link rel="alternate" type="application/feed+json" href="http://127.0.0.1/private">
        </head></html>`;
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(html, {
                    headers: { 'content-type': 'text/html' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(html, {
                    headers: { 'content-type': 'text/html' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(jsonFeed, {
                    headers: { 'content-type': 'application/feed+json' },
                }),
            );
        const service = makeFeedRefreshService({ fetch: fetchMock });

        const result = await Effect.runPromise(
            service.discover('https://example.com/articles'),
        );

        expect(result).toMatchObject({
            kind: 'updated',
            finalUrl: 'https://example.com/feed.json',
            feed: { title: 'JSON Feed' },
        });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
            'https://example.com/feed.json',
        );
    });

    it('probes a bounded common path when a website has no alternate link', async () => {
        const html = '<html><head><title>No links</title></head></html>';
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(html, {
                    headers: { 'content-type': 'text/html' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(html, {
                    headers: { 'content-type': 'text/html' },
                }),
            )
            .mockResolvedValueOnce(
                new Response(rss, {
                    headers: { 'content-type': 'application/rss+xml' },
                }),
            );
        const service = makeFeedRefreshService({ fetch: fetchMock });

        const result = await Effect.runPromise(
            service.discover('https://example.com/'),
        );

        expect(result.finalUrl).toBe('https://example.com/feed');
        expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
            'https://example.com/feed',
        );
    });

    it('probes every bounded common path through feed.json', async () => {
        const html = '<html><head><title>No links</title></head></html>';
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === 'https://example.com/') {
                return new Response(html, {
                    headers: { 'content-type': 'text/html' },
                });
            }
            if (url === 'https://example.com/feed.json') {
                return new Response(jsonFeed, {
                    headers: { 'content-type': 'application/feed+json' },
                });
            }
            return new Response('missing', { status: 404 });
        });
        const service = makeFeedRefreshService({ fetch: fetchMock });

        const result = await Effect.runPromise(
            service.discover('https://example.com/'),
        );

        expect(result.finalUrl).toBe('https://example.com/feed.json');
        expect(
            fetchMock.mock.calls
                .slice(2)
                .map(([input]) => new URL(String(input)).pathname),
        ).toEqual(COMMON_FEED_DISCOVERY_PATHS);
    });

    it('classifies HTTP status and transport failures without retaining causes', async () => {
        const retryableService = makeFeedRefreshService({
            fetch: async () =>
                new Response('later', {
                    status: 503,
                    headers: { 'retry-after': '120' },
                }),
        });
        const terminalService = makeFeedRefreshService({
            fetch: async () => new Response('gone', { status: 410 }),
        });
        const networkService = makeFeedRefreshService({
            fetch: async () => {
                throw new Error(
                    'failed https://user:secret@feeds.example.com/private',
                );
            },
        });

        const retryable = await failure(retryableService.refresh(source));
        const terminal = await failure(terminalService.refresh(source));
        const network = await failure(networkService.refresh(source));

        expect(retryable).toBeInstanceOf(FeedHttpError);
        expect(retryable).toMatchObject({
            status: 503,
            retryable: true,
            retryAfterMs: 120_000,
        });
        expect(terminal).toMatchObject({ status: 410, retryable: false });
        expect(network).toBeInstanceOf(FeedNetworkError);
        expect(network).not.toHaveProperty('cause');
        expect(JSON.stringify(network)).not.toContain('secret');
    });
});

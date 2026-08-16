import { describe, expect, it } from 'vitest';

import {
    makeRefreshProcessor,
    parseRefreshRuntimeConfig,
    resolveFeedFaviconUrl,
} from './runtime';

const input = {
    jobId: 1,
    operationId: 'refresh-operation',
    feedId: 2,
    trigger: 'scheduled' as const,
    attemptCount: 1,
    maxAttempts: 8,
    leaseOwner: 'worker',
    leaseExpiresAt: 2_000_000,
    feedUrl: 'https://feeds.example.test/rss.xml',
    siteUrl: 'https://stored.example.test/path',
    etag: null,
    lastModified: null,
    subscriptionFilters: [],
};

describe('refresh runtime adapter', () => {
    it('maps sanitized feed output into bounded persistence input', async () => {
        const processor = makeRefreshProcessor({
            now: () => 1_900_000_000_000,
            fetch: async () =>
                new Response(
                    `<rss><channel><title>Example</title><link>https://example.test</link><ttl>120</ttl>
                    <item><guid>entry-1</guid><title>One</title>
                    <description><![CDATA[<p>Hello</p><script>alert(1)</script>]]></description>
                    </item></channel></rss>`,
                    {
                        headers: {
                            'cache-control': 'max-age=3600',
                            'content-type': 'application/rss+xml',
                            etag: '"v2"',
                        },
                    },
                ),
        });

        const result = await processor(input);

        expect(result).toMatchObject({
            type: 'success',
            etag: '"v2"',
            feedName: 'Example',
            siteUrl: 'https://example.test/',
            faviconUrl: 'https://example.test/favicon.ico',
            publisherRefreshIntervalMs: 2 * 60 * 60_000,
            entries: [
                {
                    sourceId: 'entry-1',
                    title: 'One',
                    content: { type: 'stored', html: '<p>Hello</p>' },
                },
            ],
        });
        if (result.type === 'success') {
            const entry = result.entries[0];
            expect(entry?.deduplicationKey).toHaveLength(32);
            expect(
                entry?.content.type === 'stored'
                    ? entry.content.hash
                    : new Uint8Array(),
            ).toHaveLength(32);
        }
    });

    it('evaluates subscription filters without writing nonmatches', async () => {
        const result = await makeRefreshProcessor({
            now: () => 1_900_000_000_000,
            fetch: async () =>
                new Response(
                    `<rss><channel><title>Example</title>
                    <item><guid>entry-1</guid><title>Sponsored story</title></item>
                    <item><guid>entry-2</guid><title>Ordinary story</title></item>
                    </channel></rss>`,
                    { headers: { 'content-type': 'application/rss+xml' } },
                ),
        })({
            ...input,
            subscriptionFilters: [
                {
                    userId: 7,
                    filterRevision: 3,
                    rules: {
                        excludeTitle: ['sponsor'],
                        excludeContent: [],
                        excludeAuthor: [],
                    },
                },
            ],
        });

        expect(result).toMatchObject({
            type: 'success',
            entries: [
                { sourceId: 'entry-2', filteredUserIds: [] },
                { sourceId: 'entry-1', filteredUserIds: [7] },
            ],
        });
    });

    it('uses the stored site when refreshed metadata omits site and icon links', async () => {
        const result = await makeRefreshProcessor({
            now: () => 1_900_000_000_000,
            fetch: async () =>
                new Response(
                    '<rss><channel><title>Example</title></channel></rss>',
                    {
                        headers: { 'content-type': 'application/rss+xml' },
                    },
                ),
        })(input);

        expect(result).toMatchObject({
            type: 'success',
            siteUrl: 'https://stored.example.test/path',
            faviconUrl: 'https://stored.example.test/favicon.ico',
        });
    });

    it('prefers safe icon metadata and derives only same-origin fallbacks', () => {
        expect(
            resolveFeedFaviconUrl(
                'https://cdn.example.test/icon.png',
                'https://example.test/articles?view=all',
            ),
        ).toBe('https://cdn.example.test/icon.png');
        expect(
            resolveFeedFaviconUrl(
                'http://127.0.0.1/private.png',
                'https://example.test/articles?view=all',
            ),
        ).toBe('https://example.test/favicon.ico');
        expect(
            resolveFeedFaviconUrl(null, 'https://example.test:8443/site'),
        ).toBeNull();
    });

    it('retries missing responses as gone candidates without provider details', async () => {
        const processor = makeRefreshProcessor({
            now: () => 1_900_000_000_000,
            fetch: async () => new Response('gone', { status: 410 }),
        });

        await expect(processor(input)).resolves.toEqual({
            type: 'failure',
            retryable: true,
            markGone: true,
            errorClass: 'FeedHttpError',
            errorMessage: 'Feed returned HTTP 410',
            httpStatus: 410,
            durationMs: 0,
        });
    });

    it('parses strict rollout controls', () => {
        const env = {
            REFRESH_SCHEDULER_ENABLED: 'false',
            REFRESH_DISPATCH_ENABLED: 'true',
            REFRESH_DUE_LIMIT: '12',
        } as unknown as Env;

        expect(parseRefreshRuntimeConfig(env)).toEqual({
            schedulerEnabled: false,
            dispatchEnabled: true,
            dueLimit: 12,
        });
        expect(() =>
            parseRefreshRuntimeConfig({
                ...env,
                REFRESH_DUE_LIMIT: '101',
            }),
        ).toThrow('REFRESH_DUE_LIMIT');
    });
});

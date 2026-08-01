import { describe, expect, it } from 'vitest';

import { makeRefreshProcessor, parseRefreshRuntimeConfig } from './runtime';

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
    etag: null,
    lastModified: null,
};

describe('refresh runtime adapter', () => {
    it('maps sanitized feed output into bounded persistence input', async () => {
        const processor = makeRefreshProcessor({
            now: () => 1_900_000_000_000,
            fetch: async () =>
                new Response(
                    `<rss><channel><title>Example</title><link>https://example.test</link>
                    <item><guid>entry-1</guid><title>One</title>
                    <description><![CDATA[<p>Hello</p><script>alert(1)</script>]]></description>
                    </item></channel></rss>`,
                    {
                        headers: {
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

    it('marks terminal gone responses without persisting provider details', async () => {
        const processor = makeRefreshProcessor({
            now: () => 1_900_000_000_000,
            fetch: async () => new Response('gone', { status: 410 }),
        });

        await expect(processor(input)).resolves.toEqual({
            type: 'failure',
            retryable: false,
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

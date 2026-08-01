import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeFeedRefreshService } from './service';

const source = {
    url: 'https://feeds.example.com/feed.xml',
    etag: null,
    lastModified: null,
} as const;

describe('feed refresh Workerd compatibility', () => {
    it('streams, parses, hashes, resolves, and sanitizes an Atom feed', async () => {
        const encoder = new TextEncoder();
        const chunks = [
            encoder.encode(
                '<feed xmlns="http://www.w3.org/2005/Atom"><title>Workerd</title>',
            ),
            encoder.encode(`<entry><id>entry-1</id><title>One</title>
                <link href="/one"/><published>2026-07-18T10:00:00Z</published>
                <content type="html">&lt;p onclick="x"&gt;Safe &lt;a href="javascript:bad()"&gt;link&lt;/a&gt;&lt;/p&gt;</content>
                </entry></feed>`),
        ];
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(chunk);
                }
                controller.close();
            },
        });
        const service = makeFeedRefreshService({
            fetch: async (_input, init) => {
                expect(init?.redirect).toBe('manual');
                return new Response(body, {
                    headers: { 'content-type': 'application/atom+xml' },
                });
            },
            now: () => Date.parse('2026-07-18T12:00:00Z'),
        });

        const result = await Effect.runPromise(service.refresh(source));

        expect(result.kind).toBe('updated');
        if (result.kind !== 'updated') {
            throw new Error('Expected updated feed');
        }
        expect(result.feed.title).toBe('Workerd');
        expect(result.entries[0]).toMatchObject({
            sourceIdentity: 'id:entry-1',
            url: 'https://feeds.example.com/one',
            contentStatus: 'stored',
            contentHtml: '<p>Safe <a>link</a></p>',
        });
        expect(result.entries[0].deduplicationKey).toBeInstanceOf(Uint8Array);
        expect(result.entries[0].deduplicationKey).toHaveLength(32);
    });
});

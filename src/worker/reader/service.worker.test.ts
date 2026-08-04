import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ReaderRepository } from './repository';
import { makeReaderService } from './service';

const entry = {
    id: 41,
    feedId: 7,
    title: 'Article',
    url: 'https://publisher.example.test/posts/one',
    author: null,
    publishedAt: 1,
    createdAt: 1,
    feedName: 'Feed',
    customFeedName: null,
    faviconUrl: '/api/images/feeds/7/small',
    faviconIsDark: null,
    read: false,
    starred: false,
    archived: false,
    contentHtml:
        '<p><img src="https://tracker.example/pixel.gif"><img src="/photo.png"></p>',
    readChangedAt: null,
    starredAt: null,
    archivedAt: null,
};

describe('reader service article privacy', () => {
    it('never exposes remote article image sources to the browser', async () => {
        const service = makeReaderService({
            repository: {
                findEntry: () => Effect.succeed(entry),
            } as unknown as ReaderRepository,
        });

        await expect(
            Effect.runPromise(service.findEntry(2, 41)),
        ).resolves.toEqual({
            ...entry,
            contentHtml:
                '<p><img src="/api/images/entries/41/1"><img src="/api/images/entries/41/2"></p>',
        });
    });
});

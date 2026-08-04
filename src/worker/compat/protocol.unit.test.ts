import { describe, expect, it } from 'vitest';

import {
    feverItem,
    googleEntry,
    googleItemTag,
    googleSubscription,
    parseCompatibilityItemId,
} from './protocol';

const entry = {
    id: 4_660,
    feedId: 81,
    title: 'Protocol fixture',
    url: 'https://example.test/item',
    author: 'Author',
    publishedAt: 1_700_000_000_123,
    updatedAt: 1_700_000_001_456,
    feedName: 'Fixture Feed',
    contentHtml: '<p>Safe</p>',
    read: true,
    starredAt: 1_700_000_002_000,
};

describe('compatibility protocol fixtures', () => {
    it('accepts decimal, hexadecimal, and tagged Google item IDs', () => {
        expect(parseCompatibilityItemId('4660')).toBe(4_660);
        expect(parseCompatibilityItemId('0x1234')).toBe(4_660);
        expect(parseCompatibilityItemId('123a')).toBe(4_666);
        expect(parseCompatibilityItemId(googleItemTag(4_660))).toBe(4_660);
        expect(parseCompatibilityItemId('0')).toBeNull();
        expect(parseCompatibilityItemId('not-an-id')).toBeNull();
    });

    it('emits Google Reader categories and timestamp units', () => {
        expect(googleEntry(72, entry)).toMatchObject({
            id: 'tag:google.com,2005:reader/item/0000000000001234',
            timestampUsec: '1700000000123000',
            crawlTimeMsec: '1700000000123',
            published: 1_700_000_000,
            updated: 1_700_000_001,
            categories: [
                'user/72/state/com.google/reading-list',
                'user/72/state/com.google/read',
                'user/72/state/com.google/starred',
            ],
            content: { direction: 'ltr', content: '<p>Safe</p>' },
        });
    });

    it('does not disclose upstream favicons to Google Reader clients', () => {
        expect(
            googleSubscription(72, {
                feedId: 81,
                categoryId: 9,
                categoryName: 'News',
                title: 'Fixture Feed',
                feedUrl: 'https://example.test/feed.xml',
                siteUrl: 'https://example.test',
                faviconUrl: 'https://upstream.example/private-icon.png',
                lastSuccessfulRefreshAt: null,
            }),
        ).toMatchObject({ iconUrl: '' });
    });

    it('emits Fever v3 integer flags and seconds', () => {
        expect(feverItem(entry)).toEqual({
            id: 4_660,
            feed_id: 81,
            title: 'Protocol fixture',
            author: 'Author',
            html: '<p>Safe</p>',
            url: 'https://example.test/item',
            is_saved: 1,
            is_read: 1,
            created_on_time: 1_700_000_000,
        });
    });
});

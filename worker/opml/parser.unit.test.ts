import { describe, expect, it } from 'vitest';

import { OpmlValidationError } from './errors';
import { parseOpml } from './parser';

describe('parseOpml', () => {
    it('flattens nested categories and keeps the first duplicate URL', () => {
        const result = parseOpml(`<?xml version="1.0"?>
            <opml version="2.0"><body>
                <outline text="Technology">
                    <outline title="Web">
                        <outline text="First" xmlUrl="HTTPS://Example.com:443/feed.xml" htmlUrl="https://example.com/" />
                    </outline>
                </outline>
                <outline text="Duplicate" xmlUrl="https://example.com/feed.xml" />
                <outline text="Outside" xmlUrl="https://outside.example.org/rss" />
            </body></opml>`);

        expect(result).toEqual([
            {
                position: 0,
                title: 'First',
                feedUrl: 'HTTPS://Example.com:443/feed.xml',
                normalizedFeedUrl: 'https://example.com/feed.xml',
                siteUrl: 'https://example.com/',
                categoryPath: ['Technology', 'Web'],
            },
            {
                position: 1,
                title: 'Outside',
                feedUrl: 'https://outside.example.org/rss',
                normalizedFeedUrl: 'https://outside.example.org/rss',
                siteUrl: null,
                categoryPath: [],
            },
        ]);
    });

    it.each([
        '<!DOCTYPE opml><opml><body /></opml>',
        '<!ENTITY x "expanded"><opml><body /></opml>',
    ])('rejects DTD and entity declarations', (source) => {
        expect(() => parseOpml(source)).toThrowError(OpmlValidationError);
    });

    it('rejects more than 500 unique feed URLs', () => {
        const feeds = Array.from(
            { length: 501 },
            (_, index) =>
                `<outline xmlUrl="https://feed-${index}.example.test/rss" />`,
        ).join('');
        expect(() => parseOpml(`<opml><body>${feeds}</body></opml>`)).toThrow(
            /too_many_feeds/u,
        );
    });

    it('rejects documents above the character limit before XML parsing', () => {
        expect(() => parseOpml('x'.repeat(2_000_001))).toThrow(
            /document_size/u,
        );
    });
});

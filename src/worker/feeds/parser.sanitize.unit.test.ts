import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pass-through spy: the parser output stays real, the test only counts how
// many item bodies go through the HTML sanitizer.
vi.mock('./sanitize', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./sanitize')>();
    return {
        ...actual,
        sanitizeArticleHtml: vi.fn(actual.sanitizeArticleHtml),
    };
});

import { MAX_FEED_ENTRIES, parseFeedDocument } from './parser';
import { sanitizeArticleHtml } from './sanitize';

const finalUrl = new URL('https://feeds.example.com/feed.xml');
const fetchedAt = Date.parse('2026-07-18T12:00:00Z');
const parse = (document: string) =>
    parseFeedDocument(new TextEncoder().encode(document), {
        finalUrl,
        fetchedAt,
    });
const day = (index: number) =>
    new Date(Date.parse('2026-01-01T00:00:00Z') + index * 86_400_000)
        .toUTCString()
        .replace('GMT', '+0000');

beforeEach(() => {
    vi.mocked(sanitizeArticleHtml).mockClear();
});

describe('feed parser content sanitizing', () => {
    it('sanitizes only the entries that make the cut', async () => {
        // Oldest first in the document, so the kept entries are the last
        // ones, with a duplicate of a kept entry and a future entry mixed in.
        const items = Array.from(
            { length: 120 },
            (_, index) => `<item><guid>${index}</guid><title>${index}</title>
                <pubDate>${day(index)}</pubDate>
                <description><![CDATA[<p>Body ${index}</p><script>x</script>]]></description>
            </item>`,
        ).join('');
        const feed = await parse(`<rss><channel><title>x</title>${items}
            <item><guid>119</guid><title>dup</title><pubDate>${day(119)}</pubDate>
                <description>older copy</description></item>
            <item><guid>future</guid><pubDate>2999-01-01T00:00:00Z</pubDate>
                <description>future</description></item>
        </channel></rss>`);

        expect(feed.entries).toHaveLength(MAX_FEED_ENTRIES);
        expect(feed.entries.map((entry) => entry.sourceId)).toEqual(
            Array.from({ length: MAX_FEED_ENTRIES }, (_, index) =>
                String(100 + index),
            ),
        );
        expect(feed.entries.at(-1)).toMatchObject({
            title: '119',
            contentHtml: '<p>Body 119</p>',
            contentStatus: 'stored',
        });
        expect(sanitizeArticleHtml).toHaveBeenCalledTimes(MAX_FEED_ENTRIES);
    });

    it('still drops anonymous items whose body sanitizes to nothing', async () => {
        const feed = await parse(`<rss><channel><title>x</title>
            <item><description><![CDATA[<script>only</script>]]></description></item>
            <item><description><![CDATA[<p>kept</p>]]></description></item>
        </channel></rss>`);

        expect(feed.entries).toHaveLength(1);
        expect(feed.entries[0]).toMatchObject({
            title: 'Untitled',
            contentHtml: '<p>kept</p>',
        });
    });
});

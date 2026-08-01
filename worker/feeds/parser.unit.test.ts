import { describe, expect, it } from 'vitest';

import { FeedParseError } from './errors';
import { MAX_FEED_ENTRIES, type ParsedFeed, parseFeedDocument } from './parser';
import { MAX_CONTENT_BYTES } from './sanitize';

const finalUrl = new URL('https://feeds.example.com/path/feed.xml');
const fetchedAt = Date.parse('2026-07-18T12:00:00Z');
const bytes = (xml: string) => new TextEncoder().encode(xml);
const parse = (xml: string): Promise<ParsedFeed> =>
    parseFeedDocument(bytes(xml), { finalUrl, fetchedAt });
const hex = (value: Uint8Array) =>
    Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('feed parser', () => {
    it('normalizes RSS 2 namespaces, arrays, relative links, and content', async () => {
        const feed = await parse(`<?xml version="1.0"?>
            <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
              <channel>
                <title>Example &amp; News</title>
                <link>../home</link>
                <description>Updates</description>
                <image><url>icons/favicon.png</url></image>
                <lastBuildDate>Sat, 18 Jul 2026 10:00:00 GMT</lastBuildDate>
                <item>
                  <guid isPermaLink="false">post-2</guid>
                  <title>Second</title>
                  <link>../posts/2</link>
                  <dc:creator>Alice</dc:creator>
                  <pubDate>Sat, 18 Jul 2026 11:00:00 GMT</pubDate>
                  <content:encoded><![CDATA[<p>Read <a href="images/full">more</a><script>bad()</script></p>]]></content:encoded>
                </item>
                <item><guid>post-1</guid><title>First</title><pubDate>Sat, 18 Jul 2026 09:00:00 GMT</pubDate></item>
                <item />
              </channel>
            </rss>`);

        expect(feed.metadata).toEqual({
            title: 'Example & News',
            siteUrl: 'https://feeds.example.com/home',
            faviconUrl: 'https://feeds.example.com/path/icons/favicon.png',
            description: 'Updates',
            sourceUpdatedAt: Date.parse('2026-07-18T10:00:00Z'),
        });
        expect(feed.entries).toHaveLength(2);
        expect(feed.entries[0]).toMatchObject({
            sourceIdentity: 'id:post-2',
            sourceId: 'post-2',
            title: 'Second',
            url: 'https://feeds.example.com/posts/2',
            author: 'Alice',
            publishedAt: Date.parse('2026-07-18T11:00:00Z'),
            sourceUpdatedAt: null,
            contentStatus: 'stored',
            contentHtml:
                '<p>Read <a href="https://feeds.example.com/path/images/full">more</a></p>',
        });
        expect(feed.entries[0].contentEncodedSize).toBe(
            new TextEncoder().encode(feed.entries[0].contentHtml ?? '')
                .byteLength,
        );
        expect(feed.entries[0].deduplicationKey).toHaveLength(32);
    });

    it('normalizes Atom scalar entries, links, authors, and updated dates', async () => {
        const feed = await parse(`<feed xmlns="http://www.w3.org/2005/Atom">
            <title>Atom Feed</title>
            <link rel="self" href="feed.xml"/>
            <link rel="alternate" href="/site"/>
            <icon>/assets/icon.png</icon>
            <updated>2026-07-18T10:00:00Z</updated>
            <entry>
              <id>tag:example.com,2026:1</id>
              <title>Atom entry</title>
              <link href="article/1"/>
              <author><name>Bob</name></author>
              <published>2026-07-18T08:00:00Z</published>
              <updated>2026-07-18T09:00:00Z</updated>
              <content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content>
            </entry>
        </feed>`);

        expect(feed.metadata).toMatchObject({
            siteUrl: 'https://feeds.example.com/site',
            faviconUrl: 'https://feeds.example.com/assets/icon.png',
        });
        expect(feed.entries).toHaveLength(1);
        expect(feed.entries[0]).toMatchObject({
            sourceIdentity: 'id:tag:example.com,2026:1',
            url: 'https://feeds.example.com/path/article/1',
            author: 'Bob',
            publishedAt: Date.parse('2026-07-18T08:00:00Z'),
            sourceUpdatedAt: Date.parse('2026-07-18T09:00:00Z'),
            contentHtml: '<p>Atom body</p>',
        });
    });

    it('normalizes RSS 1 RDF namespaced feeds', async () => {
        const feed =
            await parse(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
            <channel rdf:about="https://feeds.example.com/rdf"><title>RDF Feed</title><link>/</link><description>RDF updates</description></channel>
            <item rdf:about="https://feeds.example.com/rdf/1"><title>RDF entry</title><link>/rdf/1</link><dc:date>2026-07-17T12:00:00Z</dc:date><description><![CDATA[<b>Body</b>]]></description></item>
        </rdf:RDF>`);

        expect(feed.metadata.title).toBe('RDF Feed');
        expect(feed.entries[0]).toMatchObject({
            sourceIdentity: 'id:https://feeds.example.com/rdf/1',
            publishedAt: Date.parse('2026-07-17T12:00:00Z'),
            contentHtml: '<b>Body</b>',
        });
    });

    it('rejects DTD and external entity declarations before parsing', async () => {
        await expect(
            parse(
                `<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><title>&xxe;</title></channel></rss>`,
            ),
        ).rejects.toMatchObject({
            _tag: 'FeedParseError',
            reason: 'forbidden_declaration',
        });
    });

    it('classifies malformed and unsupported documents as terminal parse errors', async () => {
        for (const [xml, reason] of [
            ['<rss><channel>', 'malformed_xml'],
            ['<html><body>not a feed</body></html>', 'unsupported_feed'],
        ] as const) {
            try {
                await parse(xml);
                throw new Error('Expected parse rejection');
            } catch (error) {
                expect(error).toBeInstanceOf(FeedParseError);
                expect(error).toMatchObject({ reason, retryable: false });
            }
        }
    });

    it('uses stable identity hashes across source reordering and skips duplicates', async () => {
        const item = (id: string) =>
            `<item><guid>${id}</guid><title>${id}</title><pubDate>2026-07-18T10:00:00Z</pubDate></item>`;
        const first = await parse(
            `<rss><channel><title>x</title>${item('a')}${item('b')}${item('a')}</channel></rss>`,
        );
        const second = await parse(
            `<rss><channel><title>x</title>${item('b')}${item('a')}</channel></rss>`,
        );

        expect(first.entries).toHaveLength(2);
        expect(
            hex(
                first.entries.find((entry) => entry.sourceId === 'a')
                    ?.deduplicationKey ?? new Uint8Array(),
            ),
        ).toBe(
            hex(
                second.entries.find((entry) => entry.sourceId === 'a')
                    ?.deduplicationKey ?? new Uint8Array(),
            ),
        );
    });

    it('keeps at most the 50 newest entries with source order tie-breaking', async () => {
        const items = Array.from({ length: 52 }, (_, index) => {
            const date = new Date(fetchedAt - index * 60_000).toISOString();
            return `<item><guid>${index}</guid><title>${index}</title><pubDate>${date}</pubDate></item>`;
        })
            .reverse()
            .join('');
        const feed = await parse(
            `<rss><channel><title>x</title>${items}</channel></rss>`,
        );

        expect(feed.entries).toHaveLength(MAX_FEED_ENTRIES);
        expect(feed.entries[0].sourceId).toBe('0');
        expect(feed.entries.at(-1)?.sourceId).toBe('49');
    });

    it('uses a bounded fetch-time fallback for invalid source dates', async () => {
        const feed = await parse(`<rss><channel><title>x</title><item>
            <guid>future</guid><title>Future</title><pubDate>2999-01-01T00:00:00Z</pubDate>
        </item></channel></rss>`);

        expect(feed.entries[0]).toMatchObject({
            publishedAt: fetchedAt,
            sourceUpdatedAt: null,
        });
    });

    it('classifies sanitized content above the D1 bound without returning HTML', async () => {
        const content = 'a'.repeat(MAX_CONTENT_BYTES + 1);
        const feed = await parse(`<rss><channel><title>x</title><item>
            <guid>large</guid><title>Large</title><description><![CDATA[${content}]]></description>
        </item></channel></rss>`);

        expect(feed.entries[0]).toMatchObject({
            contentStatus: 'oversized',
            contentHtml: null,
            contentEncodedSize: MAX_CONTENT_BYTES + 1,
        });
    });
});

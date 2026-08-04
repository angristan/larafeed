import { describe, expect, it } from 'vitest';

import { FeedParseError } from './errors';
import {
    MAX_FEED_ENTRIES,
    MAX_FEED_ITEMS_TO_PARSE,
    type ParsedFeed,
    parseFeedDocument,
} from './parser';
import { MAX_CONTENT_BYTES } from './sanitize';

const finalUrl = new URL('https://feeds.example.com/path/feed.xml');
const fetchedAt = Date.parse('2026-07-18T12:00:00Z');
const bytes = (xml: string) => new TextEncoder().encode(xml);
const parse = (xml: string): Promise<ParsedFeed> =>
    parseFeedDocument(bytes(xml), { finalUrl, fetchedAt });
const hex = (value: Uint8Array) =>
    Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
const digest = async (value: string) =>
    new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    );

const expectBatchAndPublishedOrder = (
    feed: ParsedFeed,
    insertionOrder: readonly string[],
    publishedOrder: readonly string[],
) => {
    const assigned = feed.entries.map((entry, index) => ({
        id: index + 1,
        sourceId: entry.sourceId,
        publishedAt: entry.publishedAt,
    }));
    expect(assigned.map(({ id, sourceId }) => [sourceId, id])).toEqual(
        insertionOrder.map((sourceId, index) => [sourceId, index + 1]),
    );
    expect(
        assigned
            .toSorted(
                (left, right) =>
                    right.publishedAt - left.publishedAt || right.id - left.id,
            )
            .map(({ sourceId }) => sourceId),
    ).toEqual(publishedOrder);
};

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
        const second = feed.entries.find(
            (entry) => entry.sourceId === 'post-2',
        );
        expect(second).toMatchObject({
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
        expect(second?.contentEncodedSize).toBe(
            new TextEncoder().encode(second?.contentHtml ?? '').byteLength,
        );
        expect(second?.deduplicationKey).toHaveLength(32);
    });

    it('decodes RSS title entities once and skips future entries', async () => {
        const feed = await parse(`<rss><channel>
            <title>Here&#8217;s &amp; RSS &amp;amp; &amp;mdash;</title>
            <item>
              <guid>present</guid>
              <title>Here&#x2019;s &amp; present &amp;amp; &amp;lt;b&amp;gt;</title>
              <pubDate>2026-07-18T12:00:00Z</pubDate>
            </item>
            <item>
              <guid>future</guid>
              <title>Future RSS</title>
              <pubDate>2026-07-18T12:00:00.001Z</pubDate>
            </item>
        </channel></rss>`);

        expect(feed.metadata.title).toBe('Here’s & RSS & —');
        expect(feed.entries).toHaveLength(1);
        expect(feed.entries[0]).toMatchObject({
            sourceId: 'present',
            title: 'Here’s & present & <b>',
            publishedAt: fetchedAt,
        });
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

    it('decodes Atom title entities once and skips future updated entries', async () => {
        const feed = await parse(`<feed xmlns="http://www.w3.org/2005/Atom">
            <title>Here&#8217;s &amp; Atom &amp;amp; &amp;mdash;</title>
            <entry>
              <id>present</id>
              <title>Here&#x2019;s &amp; present &amp;amp;</title>
              <updated>2026-07-18T11:00:00Z</updated>
            </entry>
            <entry>
              <id>future</id>
              <title>Future Atom</title>
              <updated>2026-07-18T12:00:00.001Z</updated>
            </entry>
        </feed>`);

        expect(feed.metadata.title).toBe('Here’s & Atom & —');
        expect(feed.entries).toHaveLength(1);
        expect(feed.entries[0]).toMatchObject({
            sourceId: 'present',
            title: 'Here’s & present &',
            publishedAt: Date.parse('2026-07-18T11:00:00Z'),
        });
    });

    it('marks fallback values as omitted for sparse repeated entries', async () => {
        const feed = await parse(`<rss><channel>
            <title>Sparse feed</title>
            <lastBuildDate>Sat, 18 Jul 2026 10:00:00 GMT</lastBuildDate>
            <item><guid>sparse-entry</guid></item>
        </channel></rss>`);

        expect(feed.entries).toHaveLength(1);
        expect(feed.entries[0]).toMatchObject({
            sourceIdentity: 'id:sparse-entry',
            title: 'Untitled',
            url: null,
            author: null,
            publishedAt: fetchedAt,
            sourceUpdatedAt: null,
            contentStatus: 'empty',
            updateMask: {
                title: false,
                url: false,
                author: false,
                publishedAt: false,
                sourceUpdatedAt: false,
                content: false,
            },
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

    it('normalizes JSON Feed 1.1 metadata, authors, URLs, and HTML', async () => {
        const feed = await parse(
            JSON.stringify({
                version: 'https://jsonfeed.org/version/1.1',
                title: 'JSON News',
                home_page_url: '../home',
                description: 'JSON updates',
                icon: '/assets/icon.png',
                favicon: '/assets/favicon.png',
                authors: [{ name: 'Feed Author' }],
                items: [
                    {
                        id: 'post-1',
                        title: 'JSON entry',
                        url: '../posts/1',
                        authors: [{ name: 'Item Author' }],
                        date_published: '2026-07-18T08:00:00Z',
                        date_modified: '2026-07-18T09:00:00Z',
                        content_html:
                            '<p onclick="bad()">Read <a href="images/full">more</a><script>bad()</script></p>',
                    },
                ],
            }),
        );

        expect(feed.metadata).toEqual({
            title: 'JSON News',
            siteUrl: 'https://feeds.example.com/home',
            faviconUrl: 'https://feeds.example.com/assets/favicon.png',
            description: 'JSON updates',
            sourceUpdatedAt: null,
        });
        expect(feed.entries).toHaveLength(1);
        expect(feed.entries[0]).toMatchObject({
            sourceIdentity: 'id:post-1',
            sourceId: 'post-1',
            title: 'JSON entry',
            url: 'https://feeds.example.com/posts/1',
            author: 'Item Author',
            publishedAt: Date.parse('2026-07-18T08:00:00Z'),
            sourceUpdatedAt: Date.parse('2026-07-18T09:00:00Z'),
            contentStatus: 'stored',
            contentHtml:
                '<p>Read <a href="https://feeds.example.com/path/images/full">more</a></p>',
        });
    });

    it('decodes JSON titles once and skips future entries', async () => {
        const feed = await parse(
            JSON.stringify({
                version: 'https://jsonfeed.org/version/1.1',
                title: 'Here&#8217;s &amp; JSON &amp;amp; &mdash; AT&T',
                items: [
                    {
                        id: 'present',
                        title: 'Here&#x2019;s &amp; present &amp;amp; &lt;b&gt;',
                        date_published: '2026-07-18T11:00:00Z',
                        content_text: 'Present',
                    },
                    {
                        id: 'future',
                        title: 'Future JSON',
                        date_published: '2999-01-01T00:00:00Z',
                        content_text: 'Future',
                    },
                ],
            }),
        );

        expect(feed.metadata.title).toBe('Here’s & JSON &amp; — AT&T');
        expect(feed.entries).toHaveLength(1);
        expect(feed.entries[0]).toMatchObject({
            sourceId: 'present',
            title: 'Here’s & present &amp; <b>',
            publishedAt: Date.parse('2026-07-18T11:00:00Z'),
        });
    });

    it('normalizes JSON Feed 1.0 text, authors, and content bounds', async () => {
        const feed = await parse(
            JSON.stringify({
                version: 'https://jsonfeed.org/version/1',
                title: 'JSON 1.0',
                icon: '/icon.png',
                author: { name: 'Feed Author' },
                items: [
                    {
                        id: 'text-entry',
                        external_url: '/external/1',
                        date_modified: '2026-07-18T09:00:00Z',
                        content_text: 'Plain <b>text</b> & safe',
                    },
                    {
                        id: 'oversized-entry',
                        content_html: 'a'.repeat(MAX_CONTENT_BYTES + 1),
                    },
                ],
            }),
        );

        expect(feed.metadata.faviconUrl).toBe(
            'https://feeds.example.com/icon.png',
        );
        expect(
            feed.entries.find((entry) => entry.sourceId === 'text-entry'),
        ).toMatchObject({
            sourceIdentity: 'id:text-entry',
            title: 'Untitled',
            url: 'https://feeds.example.com/external/1',
            author: 'Feed Author',
            publishedAt: Date.parse('2026-07-18T09:00:00Z'),
            sourceUpdatedAt: Date.parse('2026-07-18T09:00:00Z'),
            contentHtml: 'Plain &lt;b&gt;text&lt;/b&gt; &amp; safe',
        });
        expect(
            feed.entries.find((entry) => entry.sourceId === 'oversized-entry'),
        ).toMatchObject({
            sourceIdentity: 'id:oversized-entry',
            contentHtml: null,
            contentEncodedSize: MAX_CONTENT_BYTES + 1,
            contentStatus: 'oversized',
        });
    });

    it('rejects malformed, unsupported, and structurally invalid JSON', async () => {
        await expect(
            parseFeedDocument(bytes('{"version":'), {
                finalUrl,
                fetchedAt,
                contentType: 'application/feed+json; charset=utf-8',
            }),
        ).rejects.toMatchObject({ reason: 'malformed_json' });

        for (const document of [
            { status: 'ok' },
            {
                version: 'https://jsonfeed.org/version/2',
                title: 'Future',
                items: [],
            },
            {
                version: 'https://jsonfeed.org/version/1.1',
                title: 'Missing items',
            },
        ]) {
            await expect(parse(JSON.stringify(document))).rejects.toMatchObject(
                { reason: 'unsupported_feed' },
            );
        }
    });

    it('parses bounded feeds with many built-in entity references', async () => {
        const description = '&amp;'.repeat(50_000);
        const feed = await parse(`<rss><channel>
            <title>Entity-heavy feed</title>
            <description>${description}</description>
            <item><guid>one</guid><title>One</title></item>
        </channel></rss>`);

        expect(feed.metadata.title).toBe('Entity-heavy feed');
        expect(feed.metadata.description).toBe('&'.repeat(4_000));
        expect(feed.entries).toHaveLength(1);
    });

    it('allows inert HTML declarations inside CDATA content', async () => {
        const feed = await parse(`<rss><channel><title>HTML source</title><item>
            <guid>one</guid><title>One</title>
            <description><![CDATA[<!DOCTYPE html><html><body><p>Safe</p></body></html>]]></description>
        </item></channel></rss>`);

        expect(feed.entries[0]?.contentHtml).toBe('<p>Safe</p>');
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

    it('keeps source IDs canonical when an entry also has a URL', async () => {
        const feed = await parse(`<rss><channel><title>x</title>
            <item><guid>guid-1</guid><link>/posts/1</link><title>Linked</title></item>
        </channel></rss>`);
        const linked = feed.entries.find(
            (entry) => entry.sourceId === 'guid-1',
        );

        expect(linked?.sourceIdentity).toBe('id:guid-1');
        expect(hex(linked?.deduplicationKey ?? new Uint8Array())).toBe(
            hex(await digest('id:guid-1')),
        );
    });

    it('orders RSS batches oldest-first and preserves source-order ties for readers', async () => {
        const feed = await parse(`<rss><channel><title>x</title>
            <item><guid>rss-newest</guid><pubDate>2026-07-18T11:00:00Z</pubDate></item>
            <item><guid>rss-equal-first</guid><pubDate>2026-07-18T10:00:00Z</pubDate></item>
            <item><guid>rss-equal-second</guid><pubDate>2026-07-18T10:00:00Z</pubDate></item>
            <item><guid>rss-oldest</guid><pubDate>2026-07-18T09:00:00Z</pubDate></item>
        </channel></rss>`);

        expectBatchAndPublishedOrder(
            feed,
            ['rss-oldest', 'rss-equal-second', 'rss-equal-first', 'rss-newest'],
            ['rss-newest', 'rss-equal-first', 'rss-equal-second', 'rss-oldest'],
        );
    });

    it('orders Atom batches oldest-first and preserves source-order ties for readers', async () => {
        const feed =
            await parse(`<feed xmlns="http://www.w3.org/2005/Atom"><title>x</title>
            <entry><id>atom-newest</id><published>2026-07-18T11:00:00Z</published></entry>
            <entry><id>atom-equal-first</id><published>2026-07-18T10:00:00Z</published></entry>
            <entry><id>atom-equal-second</id><published>2026-07-18T10:00:00Z</published></entry>
            <entry><id>atom-oldest</id><published>2026-07-18T09:00:00Z</published></entry>
        </feed>`);

        expectBatchAndPublishedOrder(
            feed,
            [
                'atom-oldest',
                'atom-equal-second',
                'atom-equal-first',
                'atom-newest',
            ],
            [
                'atom-newest',
                'atom-equal-first',
                'atom-equal-second',
                'atom-oldest',
            ],
        );
    });

    it('orders JSON batches oldest-first and preserves source-order ties for readers', async () => {
        const item = (id: string, date: string) => ({
            id,
            date_published: date,
            content_text: id,
        });
        const feed = await parse(
            JSON.stringify({
                version: 'https://jsonfeed.org/version/1.1',
                title: 'x',
                items: [
                    item('json-newest', '2026-07-18T11:00:00Z'),
                    item('json-equal-first', '2026-07-18T10:00:00Z'),
                    item('json-equal-second', '2026-07-18T10:00:00Z'),
                    item('json-oldest', '2026-07-18T09:00:00Z'),
                ],
            }),
        );

        expectBatchAndPublishedOrder(
            feed,
            [
                'json-oldest',
                'json-equal-second',
                'json-equal-first',
                'json-newest',
            ],
            [
                'json-newest',
                'json-equal-first',
                'json-equal-second',
                'json-oldest',
            ],
        );
    });

    it('keeps every RSS entry when a feed has more than 50', async () => {
        const items = Array.from({ length: 52 }, (_, index) => {
            const date = new Date(fetchedAt - index * 60_000).toISOString();
            return `<item><guid>${index}</guid><title>${index}</title><pubDate>${date}</pubDate></item>`;
        })
            .reverse()
            .join('');
        const feed = await parse(
            `<rss><channel><title>x</title>${items}</channel></rss>`,
        );

        expect(feed.entries).toHaveLength(52);
        expect(feed.entries.map((entry) => entry.sourceId)).toEqual(
            Array.from({ length: 52 }, (_, index) => String(51 - index)),
        );
    });

    it('keeps every Atom entry when a feed has more than 50', async () => {
        const entries = Array.from(
            { length: 51 },
            (_, index) =>
                `<entry><id>atom-${index}</id><title>${index}</title></entry>`,
        ).join('');
        const feed = await parse(
            `<feed xmlns="http://www.w3.org/2005/Atom"><title>x</title>${entries}</feed>`,
        );

        expect(feed.entries).toHaveLength(51);
        expect(feed.entries[0]?.sourceId).toBe('atom-50');
        expect(feed.entries.at(-1)?.sourceId).toBe('atom-0');
    });

    it('keeps every JSON Feed entry when a feed has more than 50', async () => {
        const items = Array.from({ length: 53 }, (_, index) => ({
            id: `json-${index}`,
            title: String(index),
            date_published: new Date(fetchedAt - index * 60_000).toISOString(),
            content_text: `Body ${index}`,
        })).reverse();
        const feed = await parse(
            JSON.stringify({
                version: 'https://jsonfeed.org/version/1.1',
                title: 'x',
                items,
            }),
        );

        expect(feed.entries).toHaveLength(53);
        expect(feed.entries.map((entry) => entry.sourceId)).toEqual(
            Array.from({ length: 53 }, (_, index) => `json-${52 - index}`),
        );
    });

    it('fails atomically above the entry bound after future skips and deduplication', async () => {
        const items = Array.from(
            { length: MAX_FEED_ENTRIES },
            (_, index) =>
                `<item><guid>${index}</guid><title>${index}</title></item>`,
        ).join('');
        const ignored = `
            <item><guid>0</guid><title>duplicate</title></item>
            <item><guid>future</guid><title>future</title><pubDate>2999-01-01T00:00:00Z</pubDate></item>`;
        const document = (extra = '') =>
            `<rss><channel><title>x</title>${items}${ignored}${extra}</channel></rss>`;

        const feed = await parse(document());
        expect(feed.entries).toHaveLength(MAX_FEED_ENTRIES);

        await expect(
            parse(
                document(
                    '<item><guid>overflow</guid><title>overflow</title></item>',
                ),
            ),
        ).rejects.toMatchObject({
            _tag: 'FeedParseError',
            reason: 'too_many_entries',
            retryable: false,
        });
    });

    it.each([
        'RSS',
        'Atom',
        'JSON',
    ] as const)('rejects %s source items above the bounded parsing budget', async (kind) => {
        const count = MAX_FEED_ITEMS_TO_PARSE + 1;
        const document =
            kind === 'RSS'
                ? `<rss><channel><title>x</title>${Array.from(
                      { length: count },
                      (_, index) =>
                          `<item><guid>${index}</guid><pubDate>2999-01-01T00:00:00Z</pubDate></item>`,
                  ).join('')}</channel></rss>`
                : kind === 'Atom'
                  ? `<feed><title>x</title>${Array.from(
                        { length: count },
                        (_, index) =>
                            `<entry><id>${index}</id><updated>2999-01-01T00:00:00Z</updated></entry>`,
                    ).join('')}</feed>`
                  : JSON.stringify({
                        version: 'https://jsonfeed.org/version/1.1',
                        title: 'x',
                        items: Array.from({ length: count }, (_, index) => ({
                            id: String(index),
                            date_published: '2999-01-01T00:00:00Z',
                            content_text: 'future',
                        })),
                    });

        await expect(parse(document)).rejects.toMatchObject({
            _tag: 'FeedParseError',
            reason: 'too_many_entries',
        });
    });

    it('uses fetch time for missing or invalid dates without feed-date leakage', async () => {
        const feed = await parse(`<rss><channel>
            <title>x</title>
            <lastBuildDate>2026-07-18T10:00:00Z</lastBuildDate>
            <item><guid>missing</guid><title>Missing date</title></item>
            <item><guid>invalid</guid><title>Invalid date</title><pubDate>not-a-date</pubDate></item>
            <item><guid>pre-epoch</guid><title>Pre-epoch date</title><pubDate>1960-01-01T00:00:00Z</pubDate></item>
            <item><guid>updated</guid><title>Updated fallback</title><updated>2026-07-18T11:00:00Z</updated></item>
        </channel></rss>`);

        expect(feed.entries.map((entry) => entry.sourceId)).toEqual([
            'pre-epoch',
            'invalid',
            'missing',
            'updated',
        ]);
        expect(feed.entries[0]).toMatchObject({
            publishedAt: fetchedAt,
            sourceUpdatedAt: null,
        });
        expect(feed.entries[1]).toMatchObject({
            publishedAt: fetchedAt,
            sourceUpdatedAt: null,
        });
        expect(feed.entries[2]).toMatchObject({
            publishedAt: fetchedAt,
            sourceUpdatedAt: null,
        });
        expect(feed.entries[3]).toMatchObject({
            publishedAt: Date.parse('2026-07-18T11:00:00Z'),
            sourceUpdatedAt: Date.parse('2026-07-18T11:00:00Z'),
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

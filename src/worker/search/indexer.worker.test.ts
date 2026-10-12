import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { runSearchIndexer } from './indexer';
import { toFtsQuery } from './query';

const d1 = makeD1(env.DB);
const now = 1_970_000_000_000;
const FEED = 7_810_001;
const bytes = (value: number) => new Uint8Array(32).fill(value % 251 || 1);

const insertEntry = async (id: number, title: string, html: string) => {
    await Effect.runPromise(
        d1.batch([
            {
                sql: `INSERT INTO entries (
                    id, feed_id, deduplication_key, title, url, author,
                    published_at, content_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, NULL, 'Ana', ?, 'stored', ?, ?)`,
                bindings: [id, FEED, bytes(id), title, now, now, now],
            },
            {
                sql: `INSERT INTO entry_contents (
                    entry_id, content_html, content_hash,
                    encoded_size_bytes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                bindings: [
                    id,
                    html,
                    bytes(id + 1),
                    new TextEncoder().encode(html).byteLength,
                    now,
                    now,
                ],
            },
        ]),
    );
};

const matches = async (query: string): Promise<number[]> => {
    const result = await env.DB.prepare(
        'SELECT rowid FROM entry_search WHERE entry_search MATCH ? ORDER BY rowid',
    )
        .bind(toFtsQuery(query))
        .all<{ rowid: number }>();
    return result.results.map((row) => row.rowid);
};

const run = () => Effect.runPromise(runSearchIndexer(d1));

describe('search indexer with Workerd D1', () => {
    it('indexes new entries, reindexes changed ones, and drops deleted ones', async () => {
        await env.DB.prepare(
            `INSERT INTO feeds (id, name, feed_url, next_refresh_at, created_at, updated_at)
             VALUES (?, 'Search feed', 'https://search.example/feed.xml', ?, ?, ?)`,
        )
            .bind(FEED, now, now, now)
            .run();
        await insertEntry(
            7_820_001,
            'Volcanoes of Iceland',
            '<p>Lava <b>fields</b> near Reykjavík</p>',
        );
        await insertEntry(
            7_820_002,
            'Gardening',
            '<p>Tomatoes &amp; basil</p>',
        );

        expect(await run()).toMatchObject({ indexed: 2, backlog: false });
        // Body text comes from HTML, without markup, accents folded.
        expect(await matches('reykjavik')).toEqual([7_820_001]);
        expect(await matches('basil')).toEqual([7_820_002]);
        expect(await matches('b')).toEqual([]);
        // Nothing pending: a second run indexes nothing.
        expect(await run()).toMatchObject({ indexed: 0 });

        // A refresh that changes content bumps updated_at.
        await env.DB.batch([
            env.DB.prepare(
                `UPDATE entry_contents SET content_html = '<p>Peppers</p>',
                    encoded_size_bytes = 14 WHERE entry_id = ?`,
            ).bind(7_820_002),
            env.DB.prepare(
                'UPDATE entries SET updated_at = ? WHERE id = ?',
            ).bind(now + 1, 7_820_002),
        ]);
        expect(await run()).toMatchObject({ indexed: 1 });
        expect(await matches('basil')).toEqual([]);
        expect(await matches('peppers')).toEqual([7_820_002]);

        await env.DB.prepare('DELETE FROM entries WHERE id = ?')
            .bind(7_820_001)
            .run();
        expect(await run()).toMatchObject({ indexed: 0 });
        expect(await matches('reykjavik')).toEqual([]);
    });
});

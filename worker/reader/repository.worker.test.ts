import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { ReaderNotFound } from './errors';
import { makeReaderRepository } from './repository';
import { makeReaderService } from './service';

const d1 = makeD1(env.DB);
const repository = makeReaderRepository(d1);
const service = makeReaderService({ repository, now: () => 1_900_000_000_000 });
const now = 1_800_000_000_000;
const bytes = (value: number) => new Uint8Array(32).fill(value % 255 || 1);

const insertUser = (id: number) =>
    d1.run({
        sql: `INSERT INTO users (
                id, webauthn_user_handle, username, email, display_name,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        bindings: [
            id,
            bytes(id),
            `reader-${id}`,
            `reader-${id}@example.test`,
            `Reader ${id}`,
            now,
            now,
        ],
    });

const insertFeed = (id: number) =>
    d1.run({
        sql: `INSERT INTO feeds (
                id, name, feed_url, favicon_is_dark,
                next_refresh_at, created_at, updated_at
            ) VALUES (?, ?, ?, 1, ?, ?, ?)`,
        bindings: [
            id,
            `Feed ${id}`,
            `https://example.test/${id}.xml`,
            now,
            now,
            now,
        ],
    });

const subscribe = (userId: number, feedId: number, categoryId: number) =>
    Effect.gen(function* () {
        yield* d1.run({
            sql: `INSERT INTO subscription_categories (
                    id, user_id, name, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)`,
            bindings: [categoryId, userId, `Category ${categoryId}`, now, now],
        });
        yield* d1.run({
            sql: `INSERT INTO feed_subscriptions (
                    user_id, feed_id, category_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)`,
            bindings: [userId, feedId, categoryId, now, now],
        });
    });

const insertEntry = (
    id: number,
    feedId: number,
    publishedAt: number,
    createdAt = publishedAt,
) =>
    d1.run({
        sql: `INSERT INTO entries (
                id, feed_id, deduplication_key, title, url, author,
                published_at, content_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'empty', ?, ?)`,
        bindings: [
            id,
            feedId,
            bytes(id),
            `Entry ${id}`,
            `https://example.test/entries/${id}`,
            'Author',
            publishedAt,
            createdAt,
            createdAt,
        ],
    });

const interactionCount = (userId: number, feedId?: number) =>
    Effect.runPromise(
        d1.first<number>(
            {
                sql:
                    feedId === undefined
                        ? 'SELECT COUNT(*) AS count FROM entry_interactions WHERE user_id = ?'
                        : 'SELECT COUNT(*) AS count FROM entry_interactions WHERE user_id = ? AND feed_id = ?',
                bindings: feedId === undefined ? [userId] : [userId, feedId],
            },
            'count',
        ),
    );

const list = (
    userId: number,
    overrides: Partial<Parameters<typeof service.listEntries>[1]> = {},
) =>
    Effect.runPromise(
        service.listEntries(userId, {
            scope: { type: 'all' },
            filter: 'all',
            orderBy: 'published_at',
            page: 1,
            pageSize: 20,
            ...overrides,
        }),
    );

describe('reader D1 repository', () => {
    it('uses global and feed ordering indexes for bounded pages', async () => {
        const plans = await Promise.all([
            env.DB.prepare(
                `EXPLAIN QUERY PLAN
                 SELECT id FROM entries
                 ORDER BY published_at DESC, id DESC LIMIT 20`,
            ).all<{ detail: string }>(),
            env.DB.prepare(
                `EXPLAIN QUERY PLAN
                 SELECT id FROM entries WHERE feed_id = ?
                 ORDER BY created_at DESC, id DESC LIMIT 20`,
            )
                .bind(1)
                .all<{ detail: string }>(),
        ]);

        expect(
            plans[0].results.map(({ detail }) => detail).join('\n'),
        ).toContain('entries_published_global');
        expect(
            plans[1].results.map(({ detail }) => detail).join('\n'),
        ).toContain('entries_feed_created');
    });

    it('uses ingestion watermarks with sparse read exceptions and late old publications', async () => {
        const userId = 11_001;
        const feedId = 12_001;
        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(userId);
                yield* insertFeed(feedId);
                yield* subscribe(userId, feedId, 13_001);
                yield* insertEntry(14_001, feedId, 500);
                yield* insertEntry(14_002, feedId, 400);
            }),
        );

        await expect(
            Effect.runPromise(service.advanceReadThrough(userId, feedId)),
        ).resolves.toEqual({ feedId, readThroughEntryId: 14_002 });

        await Effect.runPromise(insertEntry(14_003, feedId, 100));
        await expect(list(userId, { filter: 'unread' })).resolves.toMatchObject(
            {
                entries: [{ id: 14_003, read: false }],
                pagination: { total: 1 },
            },
        );

        await Effect.runPromise(
            repository.setRead(userId, 14_001, false, now + 1),
        );
        await Effect.runPromise(
            repository.setRead(userId, 14_003, true, now + 2),
        );
        const entries = await list(userId);
        expect(entries.entries.map(({ id, read }) => [id, read])).toEqual([
            [14_001, false],
            [14_002, true],
            [14_003, true],
        ]);

        await Effect.runPromise(
            repository.setRead(userId, 14_001, true, now + 3),
        );
        expect(await interactionCount(userId)).toBe(1);
        await expect(
            Effect.runPromise(repository.getCounts(userId)),
        ).resolves.toEqual({ total: 3, unread: 0, read: 3, starred: 0 });
    });

    it('enforces ownership and excludes filtered entries from every reader query', async () => {
        const ownerId = 21_001;
        const otherId = 21_002;
        const feedId = 22_001;
        const entryId = 24_001;
        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(ownerId);
                yield* insertUser(otherId);
                yield* insertFeed(feedId);
                yield* subscribe(ownerId, feedId, 23_001);
                yield* insertEntry(entryId, feedId, 500);
                yield* d1.run({
                    sql: `INSERT INTO entry_interactions (
                            user_id, feed_id, entry_id, starred_at, filtered_at,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    bindings: [ownerId, feedId, entryId, now, now, now, now],
                });
            }),
        );

        await expect(list(ownerId)).resolves.toMatchObject({
            entries: [],
            pagination: { total: 0 },
        });
        await expect(
            Effect.runPromise(repository.getCounts(ownerId)),
        ).resolves.toEqual({ total: 0, unread: 0, read: 0, starred: 0 });
        await expect(
            Effect.runPromise(repository.listSubscriptions(ownerId)),
        ).resolves.toMatchObject([{ totalCount: 0, unreadCount: 0 }]);
        await expect(
            Effect.runPromise(repository.findEntry(ownerId, entryId)),
        ).rejects.toBeInstanceOf(ReaderNotFound);
        await expect(
            Effect.runPromise(
                repository.setStarred(ownerId, entryId, false, now),
            ),
        ).rejects.toBeInstanceOf(ReaderNotFound);

        await expect(
            Effect.runPromise(repository.findEntry(otherId, entryId)),
        ).rejects.toBeInstanceOf(ReaderNotFound);
        await expect(
            Effect.runPromise(repository.setRead(otherId, entryId, true, now)),
        ).rejects.toBeInstanceOf(ReaderNotFound);
        await expect(
            Effect.runPromise(
                repository.advanceReadThrough(otherId, feedId, now),
            ),
        ).rejects.toBeInstanceOf(ReaderNotFound);
        expect(await interactionCount(otherId)).toBe(0);
    });

    it('keeps equal-time numbered pages deterministic for both orders', async () => {
        const userId = 31_001;
        const feedId = 32_001;
        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(userId);
                yield* insertFeed(feedId);
                yield* subscribe(userId, feedId, 33_001);
                yield* insertEntry(34_001, feedId, 777, 888);
                yield* insertEntry(34_002, feedId, 777, 888);
                yield* insertEntry(34_003, feedId, 777, 888);
            }),
        );

        for (const orderBy of ['published_at', 'created_at'] as const) {
            const first = await list(userId, { orderBy, pageSize: 2 });
            const second = await list(userId, {
                orderBy,
                page: 2,
                pageSize: 2,
            });
            expect(first.entries.map(({ id }) => id)).toEqual([34_003, 34_002]);
            expect(second.entries.map(({ id }) => id)).toEqual([34_001]);
            expect(first.pagination).toEqual({
                page: 1,
                pageSize: 2,
                total: 3,
                totalPages: 2,
            });
        }
    });

    it('reads detail content without creating interaction state', async () => {
        const userId = 41_001;
        const feedId = 42_001;
        const entryId = 44_001;
        const content = '<p>Side-effect free</p>';
        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(userId);
                yield* insertFeed(feedId);
                yield* subscribe(userId, feedId, 43_001);
                yield* insertEntry(entryId, feedId, 500);
                yield* d1.run({
                    sql: `INSERT INTO entry_contents (
                            entry_id, content_html, content_hash,
                            encoded_size_bytes, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        entryId,
                        content,
                        bytes(entryId),
                        new TextEncoder().encode(content).byteLength,
                        now,
                        now,
                    ],
                });
            }),
        );

        expect(await interactionCount(userId)).toBe(0);
        await expect(
            Effect.runPromise(repository.findEntry(userId, entryId)),
        ).resolves.toMatchObject({
            id: entryId,
            contentHtml: content,
            read: false,
        });
        expect(await interactionCount(userId)).toBe(0);
    });

    it('cleans sparse desired states and preserves non-read state through one watermark write', async () => {
        const userId = 51_001;
        const feedId = 52_001;
        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(userId);
                yield* insertFeed(feedId);
                yield* subscribe(userId, feedId, 53_001);
                yield* insertEntry(54_001, feedId, 300);
                yield* insertEntry(54_002, feedId, 200);
                yield* insertEntry(54_003, feedId, 100);
            }),
        );

        const firstStar = await Effect.runPromise(
            repository.setStarred(userId, 54_001, true, now + 1),
        );
        const repeatedStar = await Effect.runPromise(
            repository.setStarred(userId, 54_001, true, now + 2),
        );
        expect(repeatedStar.starredAt).toBe(firstStar.starredAt);
        await Effect.runPromise(
            repository.setArchived(userId, 54_001, true, now + 3),
        );
        await Effect.runPromise(
            repository.setRead(userId, 54_001, false, now + 4),
        );
        await Effect.runPromise(
            repository.setRead(userId, 54_002, true, now + 5),
        );
        await Effect.runPromise(
            d1.run({
                sql: `INSERT INTO entry_interactions (
                        user_id, feed_id, entry_id, read_override,
                        read_changed_at, filtered_at, created_at, updated_at
                    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
                bindings: [userId, feedId, 54_003, now, now, now, now],
            }),
        );
        expect(await interactionCount(userId, feedId)).toBe(3);

        await expect(
            Effect.runPromise(
                repository.advanceReadThrough(userId, feedId, now + 6),
            ),
        ).resolves.toEqual({ feedId, readThroughEntryId: 54_003 });
        expect(await interactionCount(userId, feedId)).toBe(2);

        const rows = await Effect.runPromise(
            d1.all<{
                entry_id: number;
                read_override: number | null;
                starred_at: number | null;
                archived_at: number | null;
                filtered_at: number | null;
            }>({
                sql: `SELECT entry_id, read_override, starred_at,
                        archived_at, filtered_at
                    FROM entry_interactions
                    WHERE user_id = ? AND feed_id = ? ORDER BY entry_id`,
                bindings: [userId, feedId],
            }),
        );
        expect(rows.results).toEqual([
            {
                entry_id: 54_001,
                read_override: null,
                starred_at: now + 1,
                archived_at: now + 3,
                filtered_at: null,
            },
            {
                entry_id: 54_003,
                read_override: null,
                starred_at: null,
                archived_at: null,
                filtered_at: now,
            },
        ]);

        await Effect.runPromise(
            repository.advanceReadThrough(userId, feedId, now + 7),
        );
        expect(await interactionCount(userId, feedId)).toBe(2);
        const visible = await list(userId);
        expect(
            visible.entries.map(({ id, read, starred, archived }) => ({
                id,
                read,
                starred,
                archived,
            })),
        ).toEqual([
            { id: 54_001, read: true, starred: true, archived: true },
            { id: 54_002, read: true, starred: false, archived: false },
        ]);

        await Effect.runPromise(
            repository.setStarred(userId, 54_001, false, now + 8),
        );
        expect(await interactionCount(userId, feedId)).toBe(2);
        await Effect.runPromise(
            repository.setArchived(userId, 54_001, false, now + 9),
        );
        expect(await interactionCount(userId, feedId)).toBe(1);
    });
});

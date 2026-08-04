import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { MAX_FEVER_ITEMS, makeCompatibilityRepository } from './repository';

const d1 = makeD1(env.DB);
const repository = makeCompatibilityRepository(d1);
const now = 1_850_000_000_000;
const bytes = (value: number) => new Uint8Array(32).fill(value % 251 || 1);

const insertUser = (id: number) =>
    d1.run({
        sql: `INSERT INTO users (
            id, webauthn_user_handle, username, email, display_name,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        bindings: [
            id,
            bytes(id),
            `compat-${id}`,
            `compat-${id}@example.test`,
            `Compat ${id}`,
            now,
            now,
        ],
    });
const insertFeed = (id: number) =>
    d1.run({
        sql: `INSERT INTO feeds (
            id, name, feed_url, next_refresh_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
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
    d1.batch([
        {
            sql: `INSERT INTO subscription_categories (
                id, user_id, name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)`,
            bindings: [categoryId, userId, `Category ${categoryId}`, now, now],
        },
        {
            sql: `INSERT INTO feed_subscriptions (
                user_id, feed_id, category_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)`,
            bindings: [userId, feedId, categoryId, now, now],
        },
    ]);
const insertEntries = (feedId: number, firstId: number, count: number) =>
    d1
        .batch(
            Array.from({ length: count }, (_, index) => {
                const id = firstId + index;
                return {
                    sql: `INSERT INTO entries (
                    id, feed_id, deduplication_key, title, url, published_at,
                    content_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'stored', ?, ?)`,
                    bindings: [
                        id,
                        feedId,
                        bytes(index + 1),
                        `Entry ${id}`,
                        `https://example.test/items/${id}`,
                        now + index,
                        now + index,
                        now + index,
                    ],
                };
            }),
        )
        .pipe(
            Effect.flatMap(() =>
                d1.batch(
                    Array.from({ length: count }, (_, index) => {
                        const id = firstId + index;
                        const content = `<p>Content ${id}</p>`;
                        return {
                            sql: `INSERT INTO entry_contents (
                            entry_id, content_html, content_hash,
                            encoded_size_bytes, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?)`,
                            bindings: [
                                id,
                                content,
                                bytes(index + 101),
                                new TextEncoder().encode(content).byteLength,
                                now,
                                now,
                            ],
                        };
                    }),
                ),
            ),
        );

describe('compatibility D1 repository', () => {
    it('enforces ownership and uses sparse reader mutations', async () => {
        const ownerId = 7_110_001;
        const otherId = 7_110_002;
        const ownerFeedId = 7_120_001;
        const otherFeedId = 7_120_002;
        const entryId = 7_140_001;
        const otherEntryId = 7_140_002;
        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(ownerId);
                yield* insertUser(otherId);
                yield* insertFeed(ownerFeedId);
                yield* insertFeed(otherFeedId);
                yield* subscribe(ownerId, ownerFeedId, 7_130_001);
                yield* subscribe(otherId, otherFeedId, 7_130_002);
                yield* insertEntries(ownerFeedId, entryId, 1);
                yield* insertEntries(otherFeedId, otherEntryId, 1);
            }),
        );

        await expect(
            Effect.runPromise(
                repository.findEntries(ownerId, [entryId, otherEntryId]),
            ),
        ).resolves.toMatchObject([{ id: entryId }]);
        await expect(
            Effect.runPromise(repository.listItemIds(ownerId, 'all', 1)),
        ).resolves.toEqual([entryId]);

        await Effect.runPromise(
            repository.setStarred(ownerId, entryId, true, now + 1),
        );
        expect(
            await env.DB.prepare(
                'SELECT COUNT(*) AS count FROM entry_interactions WHERE user_id = ?',
            )
                .bind(ownerId)
                .first<number>('count'),
        ).toBe(1);
        await Effect.runPromise(
            repository.setStarred(ownerId, entryId, false, now + 2),
        );
        expect(
            await env.DB.prepare(
                'SELECT COUNT(*) AS count FROM entry_interactions WHERE user_id = ?',
            )
                .bind(ownerId)
                .first<number>('count'),
        ).toBe(0);
        expect(
            await env.DB.prepare(
                'SELECT COUNT(*) AS count FROM entry_interactions WHERE user_id = ?',
            )
                .bind(otherId)
                .first<number>('count'),
        ).toBe(0);
    });

    it('bounds Fever content pages and honors since_id and max_id', async () => {
        const userId = 7_210_001;
        const feedId = 7_220_001;
        const firstId = 7_240_001;
        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(userId);
                yield* insertFeed(feedId);
                yield* subscribe(userId, feedId, 7_230_001);
                yield* insertEntries(feedId, firstId, MAX_FEVER_ITEMS + 2);
            }),
        );

        const latest = await Effect.runPromise(
            repository.listFeverItems(userId, {}),
        );
        expect(latest.total).toBe(MAX_FEVER_ITEMS + 2);
        expect(latest.entries).toHaveLength(MAX_FEVER_ITEMS);
        expect(latest.entries[0]?.id).toBe(firstId + MAX_FEVER_ITEMS + 1);

        const since = await Effect.runPromise(
            repository.listFeverItems(userId, {
                sinceId: firstId + MAX_FEVER_ITEMS - 1,
            }),
        );
        expect(since.entries.map(({ id }) => id)).toEqual([
            firstId + MAX_FEVER_ITEMS,
            firstId + MAX_FEVER_ITEMS + 1,
        ]);
        const before = await Effect.runPromise(
            repository.listFeverItems(userId, { maxId: firstId + 1 }),
        );
        expect(before.entries.map(({ id }) => id)).toEqual([
            firstId + 1,
            firstId,
        ]);
    });
});

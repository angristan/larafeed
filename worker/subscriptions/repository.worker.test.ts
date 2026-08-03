import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { SubscriptionConflict, SubscriptionNotFound } from './errors';
import { makeSubscriptionRepository } from './repository';
import { makeSubscriptionService } from './service';

const d1 = makeD1(env.DB);
const repository = makeSubscriptionRepository(d1);
const now = 2_200_000_000_000;
const bytes = (value: number) => new Uint8Array(32).fill(value % 255 || 1);

const insertUser = (id: number) =>
    Effect.runPromise(
        d1.run({
            sql: `INSERT INTO users (
                    id, webauthn_user_handle, username, email, display_name,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            bindings: [
                id,
                bytes(id),
                `subscription-${id}`,
                `subscription-${id}@example.test`,
                `Subscription ${id}`,
                now,
                now,
            ],
        }),
    );

const insertEntry = (id: number, feedId: number, title: string) =>
    Effect.runPromise(
        d1.run({
            sql: `INSERT INTO entries (
                    id, feed_id, deduplication_key, title, author,
                    published_at, content_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'Author', ?, 'empty', ?, ?)`,
            bindings: [id, feedId, bytes(id), title, now, now, now],
        }),
    );

describe('subscription management D1 repository', () => {
    it('creates owned categories and reuses a shared feed safely', async () => {
        const firstUser = 810_001;
        const secondUser = 810_002;
        await insertUser(firstUser);
        await insertUser(secondUser);
        await expect(
            Effect.runPromise(
                repository.createCategory(
                    811_001,
                    firstUser,
                    'Engineering',
                    now,
                ),
            ),
        ).resolves.toMatchObject({
            id: 811_001,
            name: 'Engineering',
            subscriptionCount: 0,
        });
        await Effect.runPromise(
            repository.createCategory(811_002, secondUser, 'News', now),
        );

        const first = await Effect.runPromise(
            repository.subscribeDiscovered({
                proposedId: 812_001,
                feedUrl: 'https://subscriptions.example.test/feed.xml',
                name: 'Shared feed',
                siteUrl: 'https://subscriptions.example.test/',
                faviconUrl: null,
                categoryId: 811_001,
                userId: firstUser,
                now,
            }),
        );
        const second = await Effect.runPromise(
            repository.subscribeDiscovered({
                proposedId: 812_002,
                feedUrl: 'https://subscriptions.example.test/feed.xml',
                name: 'Ignored duplicate name',
                siteUrl: null,
                faviconUrl: null,
                categoryId: 811_002,
                userId: secondUser,
                now,
            }),
        );

        expect(first).toEqual({
            feedId: 812_001,
            createdFeed: true,
            createdSubscription: true,
        });
        expect(second).toEqual({
            feedId: 812_001,
            createdFeed: false,
            createdSubscription: true,
        });
        await Effect.runPromise(
            d1.run({
                sql: `UPDATE feeds
                    SET last_failed_refresh_at = ?
                    WHERE id = ?`,
                bindings: [now - 1, 812_001],
            }),
        );
        await expect(
            Effect.runPromise(repository.listManagement(firstUser)),
        ).resolves.toMatchObject({
            categories: [{ subscriptionCount: 1 }],
            subscriptions: [
                {
                    feedId: 812_001,
                    categoryName: 'Engineering',
                    feedName: 'Shared feed',
                    entryCount: 0,
                    lastFailedRefreshAt: now - 1,
                    refreshes: [],
                },
            ],
        });

        await Effect.runPromise(repository.unsubscribe(firstUser, 812_001));
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT COUNT(*) AS total FROM feeds WHERE id = ?',
                        bindings: [812_001],
                    },
                    'total',
                ),
            ),
        ).resolves.toBe(1);
        await Effect.runPromise(repository.unsubscribe(secondUser, 812_001));
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT COUNT(*) AS total FROM feeds WHERE id = ?',
                        bindings: [812_001],
                    },
                    'total',
                ),
            ),
        ).resolves.toBe(0);
    });

    it('finds or creates a category by case-insensitive name', async () => {
        const userId = 830_001;
        await insertUser(userId);

        await expect(
            Effect.runPromise(
                repository.findOrCreateCategory(
                    831_001,
                    userId,
                    'Technology',
                    now,
                ),
            ),
        ).resolves.toMatchObject({
            id: 831_001,
            name: 'Technology',
            subscriptionCount: 0,
        });
        await expect(
            Effect.runPromise(
                repository.findOrCreateCategory(
                    831_002,
                    userId,
                    'technology',
                    now + 1,
                ),
            ),
        ).resolves.toMatchObject({
            id: 831_001,
            name: 'Technology',
            subscriptionCount: 0,
        });
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: `SELECT COUNT(*) AS total
                            FROM subscription_categories
                            WHERE user_id = ?`,
                        bindings: [userId],
                    },
                    'total',
                ),
            ),
        ).resolves.toBe(1);
    });

    it('rebuilds all 10,001 entries and preserves sparse state', async () => {
        const owner = 840_001;
        const categoryId = 841_001;
        const feedId = 842_001;
        const firstEntryId = 8_400_000;
        const lastEntryId = firstEntryId + 10_000;
        await insertUser(owner);
        await Effect.runPromise(
            repository.createCategory(categoryId, owner, 'Large feed', now),
        );
        await Effect.runPromise(
            repository.subscribeDiscovered({
                proposedId: feedId,
                feedUrl: 'https://large-filters.example.test/feed.xml',
                name: 'Large filter feed',
                siteUrl: null,
                faviconUrl: null,
                categoryId,
                userId: owner,
                now,
            }),
        );
        await Effect.runPromise(
            d1.run({
                sql: `WITH digits(value) AS (
                        VALUES (0), (1), (2), (3), (4),
                               (5), (6), (7), (8), (9)
                    ), offsets(value) AS (
                        SELECT ones.value
                            + 10 * tens.value
                            + 100 * hundreds.value
                            + 1000 * thousands.value
                        FROM digits ones
                        CROSS JOIN digits tens
                        CROSS JOIN digits hundreds
                        CROSS JOIN digits thousands
                        UNION ALL SELECT 10000
                    )
                    INSERT INTO entries (
                        id, feed_id, deduplication_key, title, author,
                        published_at, content_status, created_at, updated_at
                    )
                    SELECT ? + value, ?, CAST(printf('%032d', value) AS BLOB),
                        CASE
                            WHEN value = 0 THEN 'Old blocked entry'
                            WHEN value = 10000 THEN 'Recent blocked entry'
                            ELSE 'Ordinary entry ' || value
                        END,
                        'Author', ?, 'empty', ?, ?
                    FROM offsets`,
                bindings: [firstEntryId, feedId, now, now, now],
            }),
        );
        await Effect.runPromise(
            d1.batch([
                {
                    sql: `INSERT INTO entry_interactions (
                            user_id, feed_id, entry_id, read_override,
                            read_changed_at, starred_at, archived_at,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
                    bindings: [
                        owner,
                        feedId,
                        firstEntryId,
                        now,
                        now,
                        now,
                        now,
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO entry_interactions (
                            user_id, feed_id, entry_id, read_override,
                            read_changed_at, archived_at, created_at, updated_at
                        ) VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
                    bindings: [owner, feedId, lastEntryId, now, now, now, now],
                },
            ]),
        );

        const service = makeSubscriptionService({
            repository,
            discoverFeed: () => Effect.die('unused'),
            scheduleRefresh: () => Effect.die('unused'),
            now: () => now + 1,
        });
        await expect(
            Effect.runPromise(
                service.updateSubscription(owner, feedId, {
                    categoryId,
                    customFeedName: 'Filtered large feed',
                    filterRules: {
                        excludeTitle: ['blocked'],
                        excludeContent: [],
                        excludeAuthor: [],
                    },
                }),
            ),
        ).resolves.toMatchObject({
            subscription: {
                customFeedName: 'Filtered large feed',
                filterRules: { excludeTitle: ['blocked'] },
            },
        });

        await expect(
            Effect.runPromise(
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
                        WHERE user_id = ? AND feed_id = ?
                        ORDER BY entry_id`,
                    bindings: [owner, feedId],
                }),
            ).then((result) => result.results),
        ).resolves.toEqual([
            {
                entry_id: firstEntryId,
                read_override: 1,
                starred_at: now,
                archived_at: now,
                filtered_at: now + 1,
            },
            {
                entry_id: lastEntryId,
                read_override: 0,
                starred_at: null,
                archived_at: now,
                filtered_at: now + 1,
            },
        ]);
    });

    it('enforces ownership and preserves read/star state while replacing sparse filters', async () => {
        const owner = 820_001;
        const otherUser = 820_002;
        const categoryId = 821_001;
        const feedId = 822_001;
        await insertUser(owner);
        await insertUser(otherUser);
        await Effect.runPromise(
            repository.createCategory(categoryId, owner, 'Security', now),
        );
        await Effect.runPromise(
            repository.subscribeDiscovered({
                proposedId: feedId,
                feedUrl: 'https://filters.example.test/feed.xml',
                name: 'Filter feed',
                siteUrl: null,
                faviconUrl: null,
                categoryId,
                userId: owner,
                now,
            }),
        );
        await insertEntry(823_001, feedId, 'Sponsored post');
        await insertEntry(823_002, feedId, 'Ordinary post');
        await Effect.runPromise(
            d1.run({
                sql: `INSERT INTO entry_interactions (
                        user_id, feed_id, entry_id, starred_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                bindings: [owner, feedId, 823_001, now, now, now],
            }),
        );

        await Effect.runPromise(
            repository.updateSubscriptionWithFilterRebuild(
                owner,
                feedId,
                categoryId,
                null,
                {
                    excludeTitle: ['Sponsored'],
                    excludeContent: [],
                    excludeAuthor: [],
                },
                823_002,
                [823_001, 823_002],
                now + 1,
            ),
        );
        await expect(
            Effect.runPromise(
                d1.all<{ entry_id: number; starred_at: number | null }>({
                    sql: `SELECT entry_id, starred_at
                            FROM entry_interactions
                            WHERE user_id = ? AND filtered_at IS NOT NULL
                            ORDER BY entry_id`,
                    bindings: [owner],
                }),
            ).then((result) => result.results),
        ).resolves.toEqual([
            { entry_id: 823_001, starred_at: now },
            { entry_id: 823_002, starred_at: null },
        ]);

        await expect(
            Effect.runPromise(
                repository.updateSubscriptionWithFilterRebuild(
                    owner,
                    feedId,
                    999_999,
                    'Must not persist',
                    {
                        excludeTitle: [],
                        excludeContent: [],
                        excludeAuthor: [],
                    },
                    823_002,
                    [],
                    now + 2,
                ),
            ),
        ).rejects.toBeInstanceOf(SubscriptionNotFound);
        await expect(
            Effect.runPromise(repository.findSubscription(owner, feedId)),
        ).resolves.toMatchObject({
            customFeedName: null,
            filterRules: {
                excludeTitle: ['Sponsored'],
                excludeContent: [],
                excludeAuthor: [],
            },
        });
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: `SELECT COUNT(*) AS total
                            FROM entry_interactions
                            WHERE user_id = ? AND filtered_at IS NOT NULL`,
                        bindings: [owner],
                    },
                    'total',
                ),
            ),
        ).resolves.toBe(2);

        await Effect.runPromise(
            repository.updateSubscriptionWithFilterRebuild(
                owner,
                feedId,
                categoryId,
                'Renamed filter feed',
                {
                    excludeTitle: [],
                    excludeContent: [],
                    excludeAuthor: [],
                },
                823_002,
                [],
                now + 2,
            ),
        );
        await expect(
            Effect.runPromise(
                d1.all<{
                    entry_id: number;
                    starred_at: number | null;
                    filtered_at: number | null;
                }>({
                    sql: `SELECT entry_id, starred_at, filtered_at
                        FROM entry_interactions WHERE user_id = ?`,
                    bindings: [owner],
                }),
            ).then((result) => result.results),
        ).resolves.toEqual([
            { entry_id: 823_001, starred_at: now, filtered_at: null },
        ]);
        await expect(
            Effect.runPromise(repository.findSubscription(owner, feedId)),
        ).resolves.toMatchObject({
            customFeedName: 'Renamed filter feed',
            filterRules: {
                excludeTitle: [],
                excludeContent: [],
                excludeAuthor: [],
            },
        });

        await insertEntry(823_003, feedId, 'Late entry');
        await expect(
            Effect.runPromise(
                repository.updateSubscriptionWithFilterRebuild(
                    owner,
                    feedId,
                    categoryId,
                    'Stale rebuild',
                    {
                        excludeTitle: ['Late'],
                        excludeContent: [],
                        excludeAuthor: [],
                    },
                    823_002,
                    [],
                    now + 3,
                ),
            ),
        ).rejects.toEqual(
            new SubscriptionConflict({ reason: 'filter_rebuild_stale' }),
        );
        await expect(
            Effect.runPromise(repository.findSubscription(owner, feedId)),
        ).resolves.toMatchObject({
            customFeedName: 'Renamed filter feed',
            filterRules: {
                excludeTitle: [],
                excludeContent: [],
                excludeAuthor: [],
            },
        });

        await expect(
            Effect.runPromise(
                repository.updateSubscription(
                    otherUser,
                    feedId,
                    categoryId,
                    null,
                    {
                        excludeTitle: [],
                        excludeContent: [],
                        excludeAuthor: [],
                    },
                    now,
                ),
            ),
        ).rejects.toBeInstanceOf(SubscriptionNotFound);
    });
});

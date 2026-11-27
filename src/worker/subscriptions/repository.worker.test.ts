import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import type { ProcessedRefreshEntry } from '../jobs';
import { SubscriptionConflict, SubscriptionNotFound } from './errors';
import {
    type DiscoveredFeedInput,
    makeSubscriptionRepository,
} from './repository';
import { makeSubscriptionService } from './service';

const d1 = makeD1(env.DB);
const repository = makeSubscriptionRepository(d1);
const now = 2_200_000_000_000;
const bytes = (value: number) => new Uint8Array(32).fill(value % 255 || 1);
let nextHistoryId = 8_000_000;
const discoveredInput = (
    input: Pick<
        DiscoveredFeedInput,
        | 'feedUrl'
        | 'name'
        | 'siteUrl'
        | 'faviconUrl'
        | 'categoryId'
        | 'userId'
        | 'now'
    > & {
        readonly etag?: string | null;
        readonly lastModified?: string | null;
        readonly httpStatus?: number;
        readonly durationMs?: number;
        readonly entries?: readonly ProcessedRefreshEntry[];
        readonly nextRefreshAt?: number;
    },
): DiscoveredFeedInput => ({
    etag: null,
    lastModified: null,
    httpStatus: 200,
    durationMs: 0,
    entries: [],
    historyId: nextHistoryId++,
    nextRefreshAt: input.now + 15 * 60_000,
    ...input,
});

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

interface MoveFixtureEntry {
    readonly id: number;
    readonly feedId: number;
    readonly key: number;
    readonly url?: string;
    readonly publishedAt?: number;
}

/** Creates a user, a category, and feeds with the given entries. */
const insertMoveFixture = async (input: {
    readonly userId: number;
    readonly categoryId: number;
    readonly feeds: readonly {
        readonly id: number;
        readonly lastSuccessAt?: number;
    }[];
    readonly entries: readonly MoveFixtureEntry[];
}) => {
    await insertUser(input.userId);
    await Effect.runPromise(
        d1.batch([
            {
                sql: `INSERT INTO subscription_categories (
                    id, user_id, name, created_at, updated_at
                ) VALUES (?, ?, 'Moves', ?, ?)`,
                bindings: [input.categoryId, input.userId, now, now],
            },
            ...input.feeds.map((feed) => ({
                sql: `INSERT INTO feeds (
                    id, name, feed_url, next_refresh_at,
                    last_successful_refresh_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                bindings: [
                    feed.id,
                    `Feed ${feed.id}`,
                    `https://moves.example.test/${feed.id}.xml`,
                    now,
                    feed.lastSuccessAt ?? null,
                    now,
                    now,
                ],
            })),
            ...input.entries.map((entry) => ({
                sql: `INSERT INTO entries (
                    id, feed_id, deduplication_key, title, url,
                    published_at, content_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'empty', ?, ?)`,
                bindings: [
                    entry.id,
                    entry.feedId,
                    bytes(entry.key),
                    `Entry ${entry.id}`,
                    entry.url ?? null,
                    entry.publishedAt ?? now,
                    now,
                    now,
                ],
            })),
        ]),
    );
};

const subscribeTo = (
    userId: number,
    feedId: number,
    categoryId: number,
    readThroughEntryId: number | null = null,
) =>
    Effect.runPromise(
        d1.run({
            sql: `INSERT INTO feed_subscriptions (
                user_id, feed_id, category_id, read_through_entry_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            bindings: [
                userId,
                feedId,
                categoryId,
                readThroughEntryId,
                now,
                now,
            ],
        }),
    );

const setInteraction = (
    userId: number,
    feedId: number,
    entryId: number,
    state: {
        readonly read?: 0 | 1;
        readonly starredAt?: number;
        readonly archivedAt?: number;
    },
) =>
    Effect.runPromise(
        d1.run({
            sql: `INSERT INTO entry_interactions (
                user_id, feed_id, entry_id, read_override, read_changed_at,
                starred_at, archived_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            bindings: [
                userId,
                feedId,
                entryId,
                state.read ?? null,
                state.read === undefined ? null : now - 1,
                state.starredAt ?? null,
                state.archivedAt ?? null,
                now,
                now,
            ],
        }),
    );

const interactions = async (userId: number, feedId: number) =>
    (
        await Effect.runPromise(
            d1.all<{
                entry_id: number;
                read_override: number | null;
                starred_at: number | null;
                archived_at: number | null;
            }>({
                sql: `SELECT entry_id, read_override, starred_at, archived_at
                    FROM entry_interactions
                    WHERE user_id = ? AND feed_id = ?
                    ORDER BY entry_id`,
                bindings: [userId, feedId],
            }),
        )
    ).results;

const subscribedFeedIds = async (userId: number) =>
    (
        await Effect.runPromise(
            d1.all<{ feed_id: number }>({
                sql: `SELECT feed_id FROM feed_subscriptions
                    WHERE user_id = ? ORDER BY feed_id`,
                bindings: [userId],
            }),
        )
    ).results.map((row) => row.feed_id);

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
            repository.subscribeDiscovered(
                discoveredInput({
                    feedUrl: 'https://subscriptions.example.test/feed.xml',
                    name: 'Shared feed',
                    siteUrl: 'https://subscriptions.example.test/',
                    faviconUrl: null,
                    categoryId: 811_001,
                    userId: firstUser,
                    now,
                }),
            ),
        );
        const second = await Effect.runPromise(
            repository.subscribeDiscovered(
                discoveredInput({
                    feedUrl: 'https://subscriptions.example.test/feed.xml',
                    name: 'Ignored duplicate name',
                    siteUrl: null,
                    faviconUrl: null,
                    categoryId: 811_002,
                    userId: secondUser,
                    now,
                }),
            ),
        );

        expect(first).toEqual({
            feedId: 1,
            createdFeed: true,
            createdSubscription: true,
        });
        expect(second).toEqual({
            feedId: 1,
            createdFeed: false,
            createdSubscription: true,
        });
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT next_id FROM feed_id_sequence WHERE singleton = 1',
                    },
                    'next_id',
                ),
            ),
        ).resolves.toBe(2);
        await Effect.runPromise(
            d1.run({
                sql: `UPDATE feeds
                    SET last_failed_refresh_at = ?
                    WHERE id = ?`,
                bindings: [now - 1, first.feedId],
            }),
        );
        await expect(
            Effect.runPromise(repository.listManagement(firstUser)),
        ).resolves.toMatchObject({
            categories: [{ subscriptionCount: 1 }],
            subscriptions: [
                {
                    feedId: first.feedId,
                    categoryName: 'Engineering',
                    feedName: 'Shared feed',
                    entryCount: 0,
                    lastFailedRefreshAt: now - 1,
                    lastSuccessfulRefreshAt: now,
                    refreshes: [
                        {
                            successful: true,
                            entriesCreated: 0,
                        },
                    ],
                },
            ],
        });

        const hash = 'd'.repeat(64);
        await Effect.runPromise(
            d1.run({
                sql: `UPDATE feeds SET favicon_url = ?,
                        favicon_asset_hash = ? WHERE id = ?`,
                bindings: [
                    'https://publisher.example.test/favicon.ico',
                    hash,
                    first.feedId,
                ],
            }),
        );
        const assetRepository = makeSubscriptionRepository(d1);
        await expect(
            Effect.runPromise(
                assetRepository.findSubscription(firstUser, first.feedId),
            ),
        ).resolves.toMatchObject({
            faviconUrl: `/api/public/favicons/v1/${hash}.png`,
        });

        const interactedEntryId = 810_101;
        await insertEntry(interactedEntryId, first.feedId, 'Interacted entry');
        await Effect.runPromise(
            d1.run({
                sql: `INSERT INTO entry_interactions (
                        user_id, feed_id, entry_id, starred_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                bindings: [
                    firstUser,
                    first.feedId,
                    interactedEntryId,
                    now,
                    now,
                    now,
                ],
            }),
        );

        await Effect.runPromise(
            repository.unsubscribe(firstUser, first.feedId),
        );
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT COUNT(*) AS total FROM feeds WHERE id = ?',
                        bindings: [first.feedId],
                    },
                    'total',
                ),
            ),
        ).resolves.toBe(1);
        await Effect.runPromise(
            repository.unsubscribe(secondUser, first.feedId),
        );
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT COUNT(*) AS total FROM feeds WHERE id = ?',
                        bindings: [first.feedId],
                    },
                    'total',
                ),
            ),
        ).resolves.toBe(0);

        await expect(
            Effect.runPromise(
                repository.subscribeDiscovered(
                    discoveredInput({
                        feedUrl:
                            'https://subscriptions.example.test/second.xml',
                        name: 'Second feed',
                        siteUrl: null,
                        faviconUrl: null,
                        categoryId: 811_001,
                        userId: firstUser,
                        now: now + 1,
                    }),
                ),
            ),
        ).resolves.toEqual({
            feedId: 2,
            createdFeed: true,
            createdSubscription: true,
        });
    });

    it('persists initial entries without creating refresh work', async () => {
        const userId = 816_001;
        const categoryId = 816_101;
        const completedAt = now + 10;
        await insertUser(userId);
        await Effect.runPromise(
            repository.createCategory(
                categoryId,
                userId,
                'Inline discovery',
                completedAt,
            ),
        );
        const nextEntryId = await Effect.runPromise(
            d1.first<number>(
                {
                    sql: `SELECT next_id FROM entry_id_sequence
                        WHERE singleton = 1`,
                },
                'next_id',
            ),
        );
        if (nextEntryId === null) throw new Error('Expected entry sequence');
        const workBefore = await Effect.runPromise(
            d1.first<{ jobs: number; outbox: number }>({
                sql: `SELECT
                    (SELECT COUNT(*) FROM jobs) AS jobs,
                    (SELECT COUNT(*) FROM outbox_messages) AS outbox`,
            }),
        );
        const input = discoveredInput({
            feedUrl: 'https://inline-discovery.example.test/feed.xml',
            name: 'Inline discovery feed',
            siteUrl: 'https://inline-discovery.example.test/',
            faviconUrl: 'https://inline-discovery.example.test/favicon.ico',
            etag: '"inline"',
            lastModified: 'Sat, 18 Jul 2026 10:00:00 GMT',
            durationMs: 125,
            entries: [
                {
                    deduplicationKey: bytes(91),
                    sourceId: 'stored-entry',
                    title: 'Stored entry',
                    url: 'https://inline-discovery.example.test/stored',
                    author: 'Author',
                    publishedAt: completedAt - 2,
                    sourceUpdatedAt: completedAt - 1,
                    updateMask: {
                        title: true,
                        url: true,
                        author: true,
                        publishedAt: true,
                        sourceUpdatedAt: true,
                        content: true,
                    },
                    content: {
                        type: 'stored',
                        html: '<p>Stored body</p>',
                        hash: bytes(92),
                    },
                    filteredUserIds: [],
                },
                {
                    deduplicationKey: bytes(93),
                    sourceId: 'empty-entry',
                    title: 'Empty entry',
                    url: null,
                    author: null,
                    publishedAt: completedAt,
                    sourceUpdatedAt: null,
                    updateMask: {
                        title: true,
                        url: true,
                        author: true,
                        publishedAt: true,
                        sourceUpdatedAt: true,
                        content: true,
                    },
                    content: { type: 'empty' },
                    filteredUserIds: [],
                },
            ],
            categoryId,
            userId,
            now: completedAt,
        });

        await expect(
            Effect.runPromise(repository.subscribeDiscovered(input)),
        ).resolves.toMatchObject({
            createdFeed: true,
            createdSubscription: true,
        });

        const feed = await Effect.runPromise(
            d1.first<{
                id: number;
                etag: string | null;
                last_modified: string | null;
                last_attempt_at: number | null;
                last_successful_refresh_at: number | null;
                latest_entry_at: number | null;
                next_refresh_at: number;
                favicon_url: string | null;
                feed_favicon_url: string | null;
            }>({
                sql: `SELECT id, etag, last_modified, last_attempt_at,
                        last_successful_refresh_at, latest_entry_at,
                        next_refresh_at, favicon_url, feed_favicon_url
                    FROM feeds WHERE feed_url = ?`,
                bindings: [input.feedUrl],
            }),
        );
        expect(feed).toMatchObject({
            etag: '"inline"',
            last_modified: 'Sat, 18 Jul 2026 10:00:00 GMT',
            last_attempt_at: completedAt,
            last_successful_refresh_at: completedAt,
            latest_entry_at: completedAt,
            next_refresh_at: input.nextRefreshAt,
            favicon_url: input.faviconUrl,
            feed_favicon_url: input.faviconUrl,
        });
        if (feed === null) throw new Error('Expected feed');

        await expect(
            Effect.runPromise(
                d1.all<{
                    id: number;
                    source_id: string | null;
                    content_status: string;
                }>({
                    sql: `SELECT id, source_id, content_status FROM entries
                        WHERE feed_id = ? ORDER BY id`,
                    bindings: [feed.id],
                }),
            ).then((result) => result.results),
        ).resolves.toEqual([
            {
                id: nextEntryId,
                source_id: 'stored-entry',
                content_status: 'stored',
            },
            {
                id: nextEntryId + 1,
                source_id: 'empty-entry',
                content_status: 'empty',
            },
        ]);
        await expect(
            Effect.runPromise(
                d1.first<string>(
                    {
                        sql: `SELECT content_html FROM entry_contents
                            WHERE entry_id = ?`,
                        bindings: [nextEntryId],
                    },
                    'content_html',
                ),
            ),
        ).resolves.toBe('<p>Stored body</p>');
        await expect(
            Effect.runPromise(
                d1.first<{
                    job_id: number | null;
                    entries_seen: number;
                    entries_created: number;
                    entries_updated: number;
                }>({
                    sql: `SELECT job_id, entries_seen, entries_created,
                            entries_updated
                        FROM feed_refreshes WHERE id = ?`,
                    bindings: [input.historyId],
                }),
            ),
        ).resolves.toEqual({
            job_id: null,
            entries_seen: 2,
            entries_created: 2,
            entries_updated: 0,
        });
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: `SELECT entries_created_count
                            FROM chart_daily_refreshes WHERE feed_id = ?`,
                        bindings: [feed.id],
                    },
                    'entries_created_count',
                ),
            ),
        ).resolves.toBe(2);
        await expect(
            Effect.runPromise(repository.findSubscription(userId, feed.id)),
        ).resolves.toMatchObject({
            entryCount: 2,
            unreadCount: 2,
            lastSuccessfulRefreshAt: completedAt,
            refreshes: [
                {
                    successful: true,
                    entriesCreated: 2,
                },
            ],
        });
        await expect(
            Effect.runPromise(
                d1.first<{ jobs: number; outbox: number }>({
                    sql: `SELECT
                        (SELECT COUNT(*) FROM jobs) AS jobs,
                        (SELECT COUNT(*) FROM outbox_messages) AS outbox`,
                }),
            ),
        ).resolves.toEqual(workBefore);
    });

    it('counts entries per subscription with read state and filters', async () => {
        const userId = 817_001;
        const otherUserId = 817_002;
        const [busyFeed, quietFeed, emptyFeed] = [817_101, 817_102, 817_103];
        const busyEntry = 817_201;
        const quietEntry = 817_301;
        await insertUser(userId);
        await insertUser(otherUserId);
        await Effect.runPromise(
            d1.batch([
                ...[busyFeed, quietFeed, emptyFeed].map((feedId) => ({
                    sql: `INSERT INTO feeds (
                        id, name, feed_url, next_refresh_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        feedId,
                        `Feed ${feedId}`,
                        `https://counts.example.test/${feedId}.xml`,
                        now,
                        now,
                        now,
                    ],
                })),
                ...[userId, otherUserId].map((owner, index) => ({
                    sql: `INSERT INTO subscription_categories (
                        id, user_id, name, created_at, updated_at
                    ) VALUES (?, ?, 'Counts', ?, ?)`,
                    bindings: [817_401 + index, owner, now, now],
                })),
            ]),
        );
        for (let index = 0; index < 4; index += 1) {
            await insertEntry(busyEntry + index, busyFeed, `Busy ${index}`);
        }
        for (let index = 0; index < 2; index += 1) {
            await insertEntry(quietEntry + index, quietFeed, `Quiet ${index}`);
        }
        await Effect.runPromise(
            d1.batch([
                ...[busyFeed, quietFeed, emptyFeed].map((feedId) => ({
                    sql: `INSERT INTO feed_subscriptions (
                        user_id, feed_id, category_id, read_through_entry_id,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        userId,
                        feedId,
                        817_401,
                        // The watermark marks the third busy entry read.
                        feedId === busyFeed ? busyEntry + 2 : null,
                        now,
                        now,
                    ],
                })),
                {
                    sql: `INSERT INTO feed_subscriptions (
                        user_id, feed_id, category_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)`,
                    bindings: [otherUserId, busyFeed, 817_402, now, now],
                },
                {
                    // The first busy entry is explicitly unread, so only the
                    // watermark and the second entry's override apply.
                    sql: `INSERT INTO entry_interactions (
                        user_id, feed_id, entry_id, read_override,
                        read_changed_at, filtered_at, created_at, updated_at
                    ) VALUES
                        (?, ?, ?, 0, ?, NULL, ?, ?),
                        (?, ?, ?, 1, ?, NULL, ?, ?),
                        (?, ?, ?, NULL, NULL, ?, ?, ?)`,
                    bindings: [
                        userId,
                        busyFeed,
                        busyEntry,
                        now,
                        now,
                        now,
                        userId,
                        busyFeed,
                        busyEntry + 1,
                        now,
                        now,
                        now,
                        userId,
                        busyFeed,
                        busyEntry + 3,
                        now,
                        now,
                        now,
                    ],
                },
            ]),
        );

        const counts = (
            await Effect.runPromise(repository.listManagement(userId))
        ).subscriptions.map(({ feedId, entryCount, unreadCount }) => ({
            feedId,
            entryCount,
            unreadCount,
        }));

        // Busy: 4 entries, 1 filtered; of the other 3, 2 are read.
        expect(counts).toEqual([
            { feedId: busyFeed, entryCount: 3, unreadCount: 1 },
            { feedId: quietFeed, entryCount: 2, unreadCount: 2 },
            { feedId: emptyFeed, entryCount: 0, unreadCount: 0 },
        ]);
        await expect(
            Effect.runPromise(
                repository.findSubscription(otherUserId, busyFeed),
            ),
        ).resolves.toMatchObject({ entryCount: 4, unreadCount: 4 });
    });

    it('does not allocate a feed ID for an invalid category', async () => {
        const userId = 815_001;
        await insertUser(userId);
        const nextFeedId = await Effect.runPromise(
            d1.first<number>(
                {
                    sql: 'SELECT next_id FROM feed_id_sequence WHERE singleton = 1',
                },
                'next_id',
            ),
        );

        await expect(
            Effect.runPromise(
                repository.subscribeDiscovered(
                    discoveredInput({
                        feedUrl:
                            'https://invalid-category.example.test/feed.xml',
                        name: 'Invalid category feed',
                        siteUrl: null,
                        faviconUrl: null,
                        categoryId: 815_999,
                        userId,
                        now,
                    }),
                ),
            ),
        ).rejects.toBeInstanceOf(SubscriptionNotFound);
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT next_id FROM feed_id_sequence WHERE singleton = 1',
                    },
                    'next_id',
                ),
            ),
        ).resolves.toBe(nextFeedId);
    });

    it('advances past explicit fixture IDs without rewinding', async () => {
        const nextFeedId = await Effect.runPromise(
            d1.first<number>(
                {
                    sql: 'SELECT next_id FROM feed_id_sequence WHERE singleton = 1',
                },
                'next_id',
            ),
        );
        if (nextFeedId === null) throw new Error('Expected feed sequence');
        const highId = nextFeedId + 10;

        await Effect.runPromise(
            d1.run({
                sql: `INSERT INTO feeds (
                        id, name, feed_url, next_refresh_at, created_at, updated_at
                    ) VALUES
                        (?, 'High fixture', 'https://high-fixture.example.test/feed', ?, ?, ?),
                        (?, 'Lower fixture', 'https://lower-fixture.example.test/feed', ?, ?, ?)`,
                bindings: [
                    highId,
                    now,
                    now,
                    now,
                    nextFeedId + 5,
                    now,
                    now,
                    now,
                ],
            }),
        );

        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT next_id FROM feed_id_sequence WHERE singleton = 1',
                    },
                    'next_id',
                ),
            ),
        ).resolves.toBe(highId + 1);
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
        const firstEntryId = 8_400_000;
        const lastEntryId = firstEntryId + 10_000;
        await insertUser(owner);
        await Effect.runPromise(
            repository.createCategory(categoryId, owner, 'Large feed', now),
        );
        const feedId = (
            await Effect.runPromise(
                repository.subscribeDiscovered(
                    discoveredInput({
                        feedUrl: 'https://large-filters.example.test/feed.xml',
                        name: 'Large filter feed',
                        siteUrl: null,
                        faviconUrl: null,
                        categoryId,
                        userId: owner,
                        now,
                    }),
                ),
            )
        ).feedId;
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
            discoverFeeds: () => Effect.die('unused'),
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
        await insertUser(owner);
        await insertUser(otherUser);
        await Effect.runPromise(
            repository.createCategory(categoryId, owner, 'Security', now),
        );
        const feedId = (
            await Effect.runPromise(
                repository.subscribeDiscovered(
                    discoveredInput({
                        feedUrl: 'https://filters.example.test/feed.xml',
                        name: 'Filter feed',
                        siteUrl: null,
                        faviconUrl: null,
                        categoryId,
                        userId: owner,
                        now,
                    }),
                ),
            )
        ).feedId;
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
                0,
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
                    1,
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
                1,
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
                    2,
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
                    now,
                ),
            ),
        ).rejects.toBeInstanceOf(SubscriptionNotFound);
    });

    it('rejects a concurrent rebuild without mixing interaction sets', async () => {
        const owner = 850_001;
        const categoryId = 851_001;
        const appleEntryId = 853_001;
        const bananaEntryId = 853_002;
        await insertUser(owner);
        await Effect.runPromise(
            repository.createCategory(categoryId, owner, 'Concurrent', now),
        );
        const feedId = (
            await Effect.runPromise(
                repository.subscribeDiscovered(
                    discoveredInput({
                        feedUrl:
                            'https://concurrent-filters.example.test/feed.xml',
                        name: 'Concurrent filters',
                        siteUrl: null,
                        faviconUrl: null,
                        categoryId,
                        userId: owner,
                        now,
                    }),
                ),
            )
        ).feedId;
        await insertEntry(appleEntryId, feedId, 'Apple update');
        await insertEntry(bananaEntryId, feedId, 'Banana update');

        const [firstSnapshot, concurrentSnapshot] = await Promise.all([
            Effect.runPromise(repository.filterEntryWindow(owner, feedId)),
            Effect.runPromise(repository.filterEntryWindow(owner, feedId)),
        ]);
        expect(firstSnapshot).toEqual(concurrentSnapshot);
        expect(firstSnapshot.filterRevision).toBe(0);

        await Effect.runPromise(
            repository.updateSubscriptionWithFilterRebuild(
                owner,
                feedId,
                categoryId,
                'Apple feed',
                {
                    excludeTitle: ['Apple'],
                    excludeContent: [],
                    excludeAuthor: [],
                },
                firstSnapshot.filterRevision,
                firstSnapshot.throughId ?? 0,
                [appleEntryId],
                now + 1,
            ),
        );
        await expect(
            Effect.runPromise(
                repository.updateSubscriptionWithFilterRebuild(
                    owner,
                    feedId,
                    categoryId,
                    'Banana feed',
                    {
                        excludeTitle: ['Banana'],
                        excludeContent: [],
                        excludeAuthor: [],
                    },
                    concurrentSnapshot.filterRevision,
                    concurrentSnapshot.throughId ?? 0,
                    [bananaEntryId],
                    now + 2,
                ),
            ),
        ).rejects.toEqual(
            new SubscriptionConflict({ reason: 'filter_rebuild_stale' }),
        );

        await expect(
            Effect.runPromise(repository.findSubscription(owner, feedId)),
        ).resolves.toMatchObject({
            customFeedName: 'Apple feed',
            filterRules: {
                excludeTitle: ['Apple'],
                excludeContent: [],
                excludeAuthor: [],
            },
        });
        await expect(
            Effect.runPromise(
                d1.all<{ entry_id: number }>({
                    sql: `SELECT entry_id FROM entry_interactions
                        WHERE user_id = ? AND filtered_at IS NOT NULL
                        ORDER BY entry_id`,
                    bindings: [owner],
                }),
            ).then((result) => result.results),
        ).resolves.toEqual([{ entry_id: appleEntryId }]);
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: `SELECT filter_revision AS revision
                            FROM feed_subscriptions
                            WHERE user_id = ? AND feed_id = ?`,
                        bindings: [owner, feedId],
                    },
                    'revision',
                ),
            ),
        ).resolves.toBe(1);
    });
    it('moves read, starred and archived state to the matching new entries', async () => {
        const userId = 870_001;
        const categoryId = 870_101;
        const [oldFeed, newFeed] = [870_201, 870_202];
        const lastSuccessAt = now - 10_000;
        await insertMoveFixture({
            userId,
            categoryId,
            feeds: [{ id: oldFeed, lastSuccessAt }, { id: newFeed }],
            entries: [
                // Read through the old watermark; matched by identity.
                { id: 870_301, feedId: oldFeed, key: 11 },
                // Starred, explicitly read; the new feed changed its GUID
                // but kept the link.
                {
                    id: 870_302,
                    feedId: oldFeed,
                    key: 12,
                    url: 'https://moves.example.test/post-2',
                },
                // Archived and explicitly unread.
                { id: 870_303, feedId: oldFeed, key: 13 },
                // Unread and untouched.
                { id: 870_304, feedId: oldFeed, key: 14 },
                { id: 870_401, feedId: newFeed, key: 11 },
                {
                    id: 870_402,
                    feedId: newFeed,
                    key: 22,
                    url: 'https://moves.example.test/post-2',
                },
                { id: 870_403, feedId: newFeed, key: 13 },
                { id: 870_404, feedId: newFeed, key: 14 },
                // Not in the old feed: one older than its last success, one
                // newer.
                {
                    id: 870_405,
                    feedId: newFeed,
                    key: 25,
                    publishedAt: lastSuccessAt - 1,
                },
                {
                    id: 870_406,
                    feedId: newFeed,
                    key: 26,
                    publishedAt: lastSuccessAt + 1,
                },
            ],
        });
        await subscribeTo(userId, oldFeed, categoryId, 870_301);
        await subscribeTo(userId, newFeed, categoryId);
        await setInteraction(userId, oldFeed, 870_302, {
            read: 1,
            starredAt: now - 5,
        });
        await setInteraction(userId, oldFeed, 870_303, {
            read: 0,
            archivedAt: now - 6,
        });
        // The user already marked this new entry unread; that choice wins.
        await setInteraction(userId, newFeed, 870_401, { read: 0 });

        await expect(
            Effect.runPromise(
                repository.moveSubscriptionState({
                    userId,
                    oldFeedId: oldFeed,
                    newFeedId: newFeed,
                    readUnmatchedPublishedThrough: lastSuccessAt,
                    now: now + 1,
                }),
            ),
        ).resolves.toEqual({ keptOldSubscription: false });

        await expect(interactions(userId, newFeed)).resolves.toEqual([
            {
                entry_id: 870_401,
                read_override: 0,
                starred_at: null,
                archived_at: null,
            },
            {
                entry_id: 870_402,
                read_override: 1,
                starred_at: now - 5,
                archived_at: null,
            },
            {
                entry_id: 870_403,
                read_override: null,
                starred_at: null,
                archived_at: now - 6,
            },
            {
                entry_id: 870_405,
                read_override: 1,
                starred_at: null,
                archived_at: null,
            },
        ]);
        await expect(subscribedFeedIds(userId)).resolves.toEqual([newFeed]);
        // Nobody else followed the old feed, so it is gone with its entries.
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: `SELECT COUNT(*) AS count FROM entries
                            WHERE feed_id = ?`,
                        bindings: [oldFeed],
                    },
                    'count',
                ),
            ),
        ).resolves.toBe(0);
    });

    it('keeps the old subscription when a starred entry has no match', async () => {
        // insertUser derives a unique key from `id % 255`.
        const userId = 871_003;
        const categoryId = 871_101;
        const [oldFeed, newFeed] = [871_201, 871_202];
        await insertMoveFixture({
            userId,
            categoryId,
            feeds: [{ id: oldFeed }, { id: newFeed }],
            entries: [
                { id: 871_301, feedId: oldFeed, key: 31 },
                { id: 871_302, feedId: oldFeed, key: 32 },
                { id: 871_401, feedId: newFeed, key: 31 },
            ],
        });
        await subscribeTo(userId, oldFeed, categoryId);
        await subscribeTo(userId, newFeed, categoryId);
        await setInteraction(userId, oldFeed, 871_301, { starredAt: now - 1 });
        await setInteraction(userId, oldFeed, 871_302, { starredAt: now - 2 });

        await expect(
            Effect.runPromise(
                repository.moveSubscriptionState({
                    userId,
                    oldFeedId: oldFeed,
                    newFeedId: newFeed,
                    readUnmatchedPublishedThrough: null,
                    now: now + 1,
                }),
            ),
        ).resolves.toEqual({ keptOldSubscription: true });
        await expect(subscribedFeedIds(userId)).resolves.toEqual([
            oldFeed,
            newFeed,
        ]);
        await expect(interactions(userId, newFeed)).resolves.toEqual([
            {
                entry_id: 871_401,
                read_override: null,
                starred_at: now - 1,
                archived_at: null,
            },
        ]);
        await expect(interactions(userId, oldFeed)).resolves.toHaveLength(2);
    });

    it('moves a subscription to a new URL with its settings', async () => {
        const userId = 872_001;
        const categoryId = 872_101;
        const [oldFeed, newFeed] = [872_201, 872_202];
        const newFeedUrl = `https://moves.example.test/${newFeed}.xml`;
        await insertMoveFixture({
            userId,
            categoryId,
            feeds: [{ id: oldFeed, lastSuccessAt: now - 100 }, { id: newFeed }],
            entries: [
                { id: 872_301, feedId: oldFeed, key: 41 },
                { id: 872_401, feedId: newFeed, key: 41 },
                // Older than the old feed's last success, so it starts read.
                {
                    id: 872_402,
                    feedId: newFeed,
                    key: 42,
                    publishedAt: now - 200,
                },
            ],
        });
        await subscribeTo(userId, oldFeed, categoryId, 872_301);
        await Effect.runPromise(
            d1.run({
                sql: `UPDATE feeds SET moved_to_url = ? WHERE id = ?`,
                bindings: [newFeedUrl, oldFeed],
            }),
        );
        const service = makeSubscriptionService({
            repository,
            // The new URL is already a known feed, so nothing is fetched.
            discoverFeeds: () => Effect.die('unused'),
            now: () => now + 1,
        });
        await Effect.runPromise(
            service.updateSubscription(userId, oldFeed, {
                categoryId,
                customFeedName: 'My blog',
                filterRules: {
                    excludeTitle: ['Sponsored'],
                    excludeContent: [],
                    excludeAuthor: [],
                },
            }),
        );

        // Dismissing hides the notice for this URL only.
        await expect(
            Effect.runPromise(
                service.dismissMovedFeed(userId, oldFeed, newFeedUrl),
            ),
        ).resolves.toMatchObject({ subscription: { movedToUrl: null } });
        await Effect.runPromise(
            d1.run({
                sql: `UPDATE feeds SET moved_to_url = ? WHERE id = ?`,
                bindings: [`${newFeedUrl}?v=2`, oldFeed],
            }),
        );
        await expect(
            Effect.runPromise(repository.findSubscription(userId, oldFeed)),
        ).resolves.toMatchObject({ movedToUrl: `${newFeedUrl}?v=2` });

        await expect(
            Effect.runPromise(
                service.moveSubscription(
                    userId,
                    oldFeed,
                    `https://moves.example.test/${oldFeed}.xml`,
                ),
            ),
        ).rejects.toMatchObject({ reason: 'same_feed' });

        await expect(
            Effect.runPromise(
                service.moveSubscription(userId, oldFeed, newFeedUrl),
            ),
        ).resolves.toMatchObject({
            kind: 'moved',
            keptOldSubscription: false,
            subscription: {
                feedId: newFeed,
                categoryId,
                customFeedName: 'My blog',
                filterRules: { excludeTitle: ['Sponsored'] },
                entryCount: 2,
                unreadCount: 0,
            },
        });
        await expect(subscribedFeedIds(userId)).resolves.toEqual([newFeed]);
    });
});

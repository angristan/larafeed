import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { makeChartRepository } from '../charts/repository';
import { makeD1 } from '../infrastructure/d1';
import { makeSubscriptionRepository } from '../subscriptions/repository';
import {
    READER_FIXTURE,
    referenceSubscriptionCounts,
    seedReaderFixture,
} from '../test/reader-fixture';
import { makeReaderRepository } from './repository';

const d1 = makeD1(env.DB);
const reader = makeReaderRepository(d1);
const subscriptions = makeSubscriptionRepository(d1);
const charts = makeChartRepository(d1);
const { now } = READER_FIXTURE;

const expectCountsMatchReference = async (userId: number) => {
    const reference = await referenceSubscriptionCounts(userId);
    const listed = await Effect.runPromise(reader.listSubscriptions(userId));
    expect(
        listed
            .map(({ feedId, totalCount, unreadCount }) => ({
                feedId,
                totalCount,
                unreadCount,
            }))
            .toSorted((left, right) => left.feedId - right.feedId),
    ).toEqual(
        reference.map((row) => ({
            feedId: row.feed_id,
            totalCount: row.total,
            unreadCount: row.unread,
        })),
    );

    const managed = await Effect.runPromise(
        subscriptions.listManagement(userId),
    );
    expect(
        managed.subscriptions
            .map(({ feedId, entryCount, unreadCount }) => ({
                feedId,
                entryCount,
                unreadCount,
            }))
            .toSorted((left, right) => left.feedId - right.feedId),
    ).toEqual(
        reference.map((row) => ({
            feedId: row.feed_id,
            entryCount: row.total,
            unreadCount: row.unread,
        })),
    );

    const sum = (rows: typeof reference, key: 'total' | 'unread' | 'starred') =>
        rows.reduce((total, row) => total + row[key], 0);
    const total = sum(reference, 'total');
    const unread = sum(reference, 'unread');
    expect(await Effect.runPromise(reader.getCounts(userId))).toEqual({
        total,
        unread,
        read: total - unread,
        starred: sum(reference, 'starred'),
    });

    const chart = await Effect.runPromise(
        charts.load({
            userId,
            startAt: now - 86_400_000,
            endAt: now + 86_400_000,
            scope: { type: 'all' },
        }),
    );
    expect(chart.currentUnread).toBe(unread);
    return reference;
};

const listTotal = (
    userId: number,
    scope: Parameters<typeof reader.listEntries>[1]['scope'],
    filter: Parameters<typeof reader.listEntries>[1]['filter'],
) =>
    Effect.runPromise(
        reader.listEntries(userId, {
            scope,
            filter,
            orderBy: 'published_at',
            cursor: null,
            pageSize: 1,
        }),
    ).then((page) => page.total);

describe('stored entry counters', () => {
    beforeAll(seedReaderFixture);

    it('give the same counts as reading every entry', async () => {
        const reference = await expectCountsMatchReference(1);
        await expectCountsMatchReference(2);

        // List totals for every scope and filter.
        const inCategory = (categoryId: number) =>
            reference.filter((row) => row.category_id === categoryId);
        const scopes = [
            { scope: { type: 'all' } as const, rows: reference },
            {
                scope: { type: 'category', id: 10 } as const,
                rows: inCategory(10),
            },
            {
                scope: { type: 'category', id: 11 } as const,
                rows: inCategory(11),
            },
            {
                scope: { type: 'feed', id: 3 } as const,
                rows: reference.filter((row) => row.feed_id === 3),
            },
        ];
        for (const { scope, rows } of scopes) {
            const total = rows.reduce((sum, row) => sum + row.total, 0);
            const unread = rows.reduce((sum, row) => sum + row.unread, 0);
            const starred = rows.reduce((sum, row) => sum + row.starred, 0);
            expect(await listTotal(1, scope, 'all')).toBe(total);
            expect(await listTotal(1, scope, 'unread')).toBe(unread);
            expect(await listTotal(1, scope, 'read')).toBe(total - unread);
            expect(await listTotal(1, scope, 'favorites')).toBe(starred);
        }
    });

    it('stay exact through mark-as-read, new entries, and feed deletion', async () => {
        await Effect.runPromise(reader.advanceReadThrough(1, 6, now));
        await Effect.runPromise(
            reader.advanceReadThroughScope(1, { type: 'feed', id: 19 }, now),
        );
        await expectCountsMatchReference(1);

        // Entries above and below the watermark of feed 9.
        await env.DB.batch(
            [5_000, 5_001].map((id) =>
                env.DB.prepare(
                    `INSERT INTO entries (
                        id, feed_id, deduplication_key, title, published_at,
                        content_status, created_at, updated_at
                    ) VALUES (?, 9, randomblob(32), 'Late', ?, 'empty', ?, ?)`,
                ).bind(id, now, now, now),
            ),
        );
        await env.DB.prepare(
            `UPDATE feed_subscriptions SET read_through_entry_id = 5000
             WHERE user_id = 1 AND feed_id = 9`,
        ).run();
        await expectCountsMatchReference(1);
        await env.DB.prepare(
            `UPDATE feed_subscriptions SET read_through_entry_id = NULL
             WHERE user_id = 1 AND feed_id = 12`,
        ).run();
        await expectCountsMatchReference(1);

        await Effect.runPromise(subscriptions.unsubscribe(1, 4));
        await Effect.runPromise(subscriptions.unsubscribe(2, 4));
        await expectCountsMatchReference(1);
        await expectCountsMatchReference(2);
        const stale = await env.DB.prepare(
            `SELECT
                (SELECT COUNT(*) FROM feeds f
                 WHERE f.entry_count <> (SELECT COUNT(*) FROM entries e WHERE e.feed_id = f.id))
              + (SELECT COUNT(*) FROM feed_subscriptions fs
                 WHERE fs.read_through_count <> (
                    SELECT COUNT(*) FROM entries e
                    WHERE e.feed_id = fs.feed_id AND e.id <= fs.read_through_entry_id))
              AS stale`,
        ).first<{ stale: number }>();
        expect(stale?.stale).toBe(0);
    });

    it('marks a whole category or library as read in one call', async () => {
        const rows = await Effect.runPromise(
            reader.advanceReadThroughScope(
                1,
                { type: 'category', id: READER_FIXTURE.bigCategory },
                now,
            ),
        );
        expect(rows.map(({ feedId }) => feedId)).toEqual(
            (await referenceSubscriptionCounts(1))
                .filter((row) => row.category_id === 10)
                .map((row) => row.feed_id),
        );
        const counts = await expectCountsMatchReference(1);
        expect(
            counts.filter((row) => row.category_id === 10 && row.unread > 0),
        ).toEqual([]);
        expect(
            counts.some((row) => row.category_id === 11 && row.unread > 0),
        ).toBe(true);
        // User 2's subscriptions to the same feeds are untouched.
        expect(
            (await referenceSubscriptionCounts(2)).some((row) => row.unread),
        ).toBe(true);

        await Effect.runPromise(
            reader.advanceReadThroughScope(1, { type: 'all' }, now),
        );
        expect(
            (await expectCountsMatchReference(1)).every(
                (row) => row.unread === 0,
            ),
        ).toBe(true);
    });
});

import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { type D1, makeD1 } from '../infrastructure/d1';
import {
    insertFixtureEntries,
    READER_FIXTURE,
    referenceEntryIds,
    seedReaderFixture,
} from '../test/reader-fixture';
import { makeReaderRepository, type ReaderEntryQuery } from './repository';

/** A D1 that adds up the rows each statement reads. */
const measuredD1 = (inner: D1) => {
    let rowsRead = 0;
    const add = (result: D1Result<unknown>) => {
        rowsRead += result.meta.rows_read;
    };
    const d1: D1 = {
        ...inner,
        all: <T>(statement: Parameters<D1['all']>[0]) =>
            inner.all<T>(statement).pipe(
                Effect.map((result) => {
                    add(result);
                    return result;
                }),
            ),
        batch: <T>(statements: Parameters<D1['batch']>[0]) =>
            inner.batch<T>(statements).pipe(
                Effect.map((results) => {
                    results.forEach(add);
                    return results;
                }),
            ),
        first: ((statement: Parameters<D1['all']>[0], column?: string) =>
            inner.all<Record<string, unknown>>(statement).pipe(
                Effect.map((result) => {
                    add(result);
                    const row = result.results[0] ?? null;
                    return column === undefined ? row : (row?.[column] ?? null);
                }),
            )) as D1['first'],
    };
    return {
        d1,
        take: () => {
            const value = rowsRead;
            rowsRead = 0;
            return value;
        },
    };
};

const measured = measuredD1(makeD1(env.DB));
const repository = makeReaderRepository(measured.d1);

const readAll = async (
    userId: number,
    query: Omit<ReaderEntryQuery, 'cursor' | 'pageSize'>,
): Promise<number[]> => {
    const first = await Effect.runPromise(
        repository.listEntries(userId, { ...query, cursor: null, pageSize: 7 }),
    );
    const ids = first.entries.map(({ id }) => id);
    let cursor = first.nextCursor;
    while (cursor !== null) {
        const page = await Effect.runPromise(
            repository.listEntriesUncounted(userId, {
                ...query,
                cursor,
                pageSize: 7,
            }),
        );
        ids.push(...page.entries.map(({ id }) => id));
        cursor = page.nextCursor;
    }
    return ids;
};

describe('reader entry pages', () => {
    beforeAll(seedReaderFixture);

    it('return every entry once, in order, for each scope, filter, and order', async () => {
        const scopes = [
            // 20 and 18 feeds walk the global ordering index.
            { userId: 1, scope: { type: 'all' } as const, reference: null },
            {
                userId: 1,
                scope: { type: 'category', id: 10 } as const,
                reference: { column: 'category_id', id: 10 } as const,
            },
            // 2 and 5 feeds read each feed's index.
            {
                userId: 1,
                scope: { type: 'category', id: 11 } as const,
                reference: { column: 'category_id', id: 11 } as const,
            },
            { userId: 2, scope: { type: 'all' } as const, reference: null },
            {
                userId: 1,
                scope: { type: 'feed', id: 3 } as const,
                reference: { column: 'feed_id', id: 3 } as const,
            },
        ];
        for (const { userId, scope, reference } of scopes) {
            for (const filter of [
                'all',
                'unread',
                'read',
                'favorites',
            ] as const) {
                for (const orderBy of ['published_at', 'created_at'] as const) {
                    const expected = await referenceEntryIds(
                        userId,
                        reference,
                        filter,
                        orderBy,
                    );
                    expect(expected.length).toBeGreaterThan(0);
                    expect(
                        await readAll(userId, { scope, filter, orderBy }),
                        `${JSON.stringify(scope)} ${filter} ${orderBy}`,
                    ).toEqual(expected);
                }
            }
        }
    });

    it('counts only the entries inside a range', async () => {
        const createdFrom = READER_FIXTURE.now - 5 * 60_000;
        const expected = (
            await env.DB.prepare(
                `SELECT COUNT(*) AS total FROM entries e
                 JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
                 LEFT JOIN entry_interactions ei
                   ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                 WHERE fs.user_id = 1 AND ei.filtered_at IS NULL
                   AND e.created_at >= ?`,
            )
                .bind(createdFrom)
                .first<{ total: number }>()
        )?.total;
        const page = await Effect.runPromise(
            repository.listEntries(1, {
                scope: { type: 'all' },
                filter: 'all',
                orderBy: 'created_at',
                cursor: null,
                pageSize: 1,
                range: { from: createdFrom },
            }),
        );
        expect(expected).toBeGreaterThan(0);
        expect(page.total).toBe(expected);
    });

    it('reads about one page of rows, not the whole library', async () => {
        // Grow the library with entries nobody interacted with, which is
        // what most of a real library looks like.
        for (let round = 0; round < 3; round += 1) {
            await insertFixtureEntries(
                Array.from({ length: READER_FIXTURE.feeds }, (_, i) => i + 1),
                10_000 + round * 1_000,
            );
        }
        const entries = (
            await env.DB.prepare(
                'SELECT COUNT(*) AS total FROM entries',
            ).first<{ total: number }>()
        )?.total;
        expect(entries).toBeGreaterThan(1_000);
        // Each request reads under a third of the entries. Before, every
        // one of them read each entry at least once.
        const budget = (entries ?? 0) / 3;

        measured.take();
        await Effect.runPromise(
            repository.listEntries(1, {
                scope: { type: 'all' },
                filter: 'all',
                orderBy: 'published_at',
                cursor: null,
                pageSize: 20,
            }),
        );
        expect(measured.take()).toBeLessThan(budget);

        await Effect.runPromise(
            repository.listEntries(1, {
                scope: { type: 'category', id: READER_FIXTURE.smallCategory },
                filter: 'unread',
                orderBy: 'created_at',
                cursor: null,
                pageSize: 20,
            }),
        );
        expect(measured.take()).toBeLessThan(budget);

        await Effect.runPromise(repository.listSubscriptions(1));
        expect(measured.take()).toBeLessThan(budget);

        await Effect.runPromise(repository.getCounts(1));
        expect(measured.take()).toBeLessThan(budget);
    });
});

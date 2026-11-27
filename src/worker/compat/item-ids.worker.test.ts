import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { makeReaderRepository } from '../reader/repository';
import { measuredD1 } from '../test/measured-d1';
import {
    insertFixtureEntries,
    READER_FIXTURE,
    referenceEntryIds,
    seedReaderFixture,
} from '../test/reader-fixture';
import { makeCompatibilityRepository } from './repository';

const measured = measuredD1(makeD1(env.DB));
const repository = makeCompatibilityRepository(measured.d1);

const referenceIds = async (
    userId: number,
    filter: 'all' | 'unread' | 'starred',
    where = '1 = 1',
) => {
    const ids = await referenceEntryIds(
        userId,
        null,
        filter === 'starred' ? 'favorites' : filter,
        'published_at',
    );
    const { results } = await env.DB.prepare(
        `SELECT id FROM entries e WHERE ${where}
         AND id IN (SELECT value FROM json_each(?))`,
    )
        .bind(JSON.stringify(ids))
        .all<{ id: number }>();
    return results.map(({ id }) => id).toSorted((left, right) => right - left);
};

describe('compatibility item IDs', () => {
    beforeAll(seedReaderFixture);

    it('list the same IDs as reading every entry', async () => {
        for (const userId of READER_FIXTURE.users) {
            for (const filter of ['all', 'unread', 'starred'] as const) {
                const expected = await referenceIds(userId, filter);
                expect(expected.length).toBeGreaterThan(5);
                expect(
                    await Effect.runPromise(
                        repository.listItemIds(userId, filter),
                    ),
                ).toEqual(expected);
                expect(
                    await Effect.runPromise(
                        repository.listItemIds(userId, filter, 5),
                    ),
                ).toEqual(expected.slice(0, 5));
            }
        }
    });

    it('bounds item IDs by fetch time', async () => {
        const from = READER_FIXTURE.now - 8 * 60_000;
        const before = READER_FIXTURE.now - 2 * 60_000;
        for (const filter of ['all', 'unread', 'starred'] as const) {
            expect(
                await Effect.runPromise(
                    repository.listItemIds(1, filter, undefined, {
                        createdFrom: from,
                        createdBefore: before,
                    }),
                ),
            ).toEqual(
                await referenceIds(
                    1,
                    filter,
                    `created_at >= ${from} AND created_at < ${before}`,
                ),
            );
        }
    });

    it('counts Fever items from the stored counters', async () => {
        const page = await Effect.runPromise(repository.listFeverItems(1, {}));
        expect(page.total).toBe((await referenceIds(1, 'all')).length);
        expect(page.entries.map(({ id }) => id)).toEqual(
            (await referenceIds(1, 'all')).slice(0, 50),
        );
    });

    it('reads only the unread part of a library that was marked read', async () => {
        await Effect.runPromise(
            makeReaderRepository(makeD1(env.DB)).advanceReadThroughScope(
                1,
                { type: 'all' },
                READER_FIXTURE.now,
            ),
        );
        await insertFixtureEntries([2], 20_000);
        const entries =
            (
                await env.DB.prepare(
                    'SELECT COUNT(*) AS total FROM entries',
                ).first<{ total: number }>()
            )?.total ?? 0;

        measured.take();
        const unread = await Effect.runPromise(
            repository.listItemIds(1, 'unread'),
        );
        expect(unread).toEqual(await referenceIds(1, 'unread'));
        expect(unread.length).toBeGreaterThan(0);
        expect(measured.take()).toBeLessThan(entries / 4);
    });
});

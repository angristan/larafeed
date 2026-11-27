import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { READER_FIXTURE, seedReaderFixture } from '../test/reader-fixture';
import { ReaderNotFound } from './errors';
import { makeReaderRepository } from './repository';

const repository = makeReaderRepository(makeD1(env.DB));
const { now } = READER_FIXTURE;
// User 1 gets per-entry changes, user 3 the same changes in bulk.
const single = 1;
const bulk = 3;

const copyUser = async () => {
    await env.DB.batch([
        env.DB.prepare(
            `INSERT INTO users (id, webauthn_user_handle, username, email,
                display_name, created_at, updated_at)
             VALUES (3, randomblob(32), 'bulk', 'bulk@example.test', 'Bulk', ?, ?)`,
        ).bind(now, now),
        env.DB.prepare(
            `INSERT INTO subscription_categories (id, user_id, name, created_at, updated_at)
             SELECT id + 100, 3, name, created_at, updated_at
             FROM subscription_categories WHERE user_id = 1`,
        ),
        env.DB.prepare(
            `INSERT INTO feed_subscriptions (user_id, feed_id, category_id,
                read_through_entry_id, created_at, updated_at)
             SELECT 3, feed_id, category_id + 100, read_through_entry_id,
                created_at, updated_at
             FROM feed_subscriptions WHERE user_id = 1`,
        ),
        env.DB.prepare(
            `INSERT INTO entry_interactions (user_id, feed_id, entry_id,
                read_override, read_changed_at, starred_at, archived_at,
                filtered_at, created_at, updated_at)
             SELECT 3, feed_id, entry_id, read_override, read_changed_at,
                starred_at, archived_at, filtered_at, created_at, updated_at
             FROM entry_interactions WHERE user_id = 1`,
        ),
    ]);
};

const state = async (userId: number) => {
    const [interactions, activity] = await env.DB.batch([
        env.DB.prepare(
            `SELECT entry_id, read_override, read_changed_at, starred_at,
                archived_at, filtered_at, updated_at
             FROM entry_interactions WHERE user_id = ? ORDER BY entry_id`,
        ).bind(userId),
        env.DB.prepare(
            `SELECT feed_id, day_start, marked_read_count, marked_unread_count,
                saved_count, unsaved_count
             FROM chart_daily_activity WHERE user_id = ? ORDER BY feed_id, day_start`,
        ).bind(userId),
    ]);
    return { interactions: interactions?.results, activity: activity?.results };
};

describe('bulk entry changes', () => {
    beforeAll(async () => {
        await seedReaderFixture();
        await copyUser();
    });

    it('match the same changes made one entry at a time', async () => {
        const { results } = await env.DB.prepare(
            'SELECT id FROM entries WHERE id % 3 = 0 ORDER BY id',
        ).all<{ id: number }>();
        // Visible, filtered, and missing entries, with a duplicate.
        const ids = [...results.map(({ id }) => id), 999_999, 1_002, 1_002];

        const steps = [
            { kind: 'read', desired: true },
            { kind: 'star', desired: true },
            { kind: 'read', desired: false },
            { kind: 'archive', desired: true },
            { kind: 'star', desired: false },
            { kind: 'read', desired: true },
            { kind: 'archive', desired: false },
        ] as const;
        for (const [index, { kind, desired }] of steps.entries()) {
            const at = now + index;
            let found = 0;
            for (const id of new Set(ids)) {
                const change =
                    kind === 'read'
                        ? repository.setRead(single, id, desired, at)
                        : kind === 'star'
                          ? repository.setStarred(single, id, desired, at)
                          : repository.setArchived(single, id, desired, at);
                found += await Effect.runPromise(
                    change.pipe(
                        Effect.as(1),
                        Effect.catchIf(
                            (error) => error instanceof ReaderNotFound,
                            () => Effect.succeed(0),
                        ),
                    ),
                );
            }
            const many =
                kind === 'read'
                    ? repository.setReadMany(bulk, ids, desired, at)
                    : kind === 'star'
                      ? repository.setStarredMany(bulk, ids, desired, at)
                      : repository.setArchivedMany(bulk, ids, desired, at);
            expect(await Effect.runPromise(many), `${kind} ${desired}`).toBe(
                found,
            );
            expect(await state(bulk), `${kind} ${desired}`).toEqual(
                await state(single),
            );
        }

        const interactions = await Effect.runPromise(
            repository.findInteractions(bulk, ids),
        );
        expect(interactions).toHaveLength(
            await Effect.runPromise(
                repository.setReadMany(bulk, ids, true, now),
            ),
        );
        expect(interactions.every(({ read }) => read)).toBe(true);
    });
});

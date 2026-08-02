import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { ChartNotFound } from './errors';
import { makeChartRepository } from './repository';

const d1 = makeD1(env.DB);
const repository = makeChartRepository(d1);
const bytes = (value: number) => new Uint8Array(32).fill(value % 255 || 1);
const day = 24 * 60 * 60_000;
const start = Date.parse('2026-07-17T00:00:00.000Z');

describe('chart D1 repository', () => {
    it('isolates scopes and returns truthful cohort, refresh, and activity rows', async () => {
        const userId = 910_001;
        const otherUserId = 910_002;
        const categoryId = 911_001;
        const feedId = 912_001;
        await Effect.runPromise(
            d1.batch([
                {
                    sql: `INSERT INTO users (
                            id, webauthn_user_handle, username, email,
                            display_name, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        userId,
                        bytes(1),
                        'chart-reader',
                        'chart-reader@example.test',
                        'Chart Reader',
                        start,
                        start,
                    ],
                },
                {
                    sql: `INSERT INTO users (
                            id, webauthn_user_handle, username, email,
                            display_name, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        otherUserId,
                        bytes(2),
                        'other-chart-reader',
                        'other-chart-reader@example.test',
                        'Other Reader',
                        start,
                        start,
                    ],
                },
                {
                    sql: `INSERT INTO feeds (
                            id, name, feed_url, next_refresh_at,
                            created_at, updated_at
                        ) VALUES (?, 'Chart feed', ?, ?, ?, ?)`,
                    bindings: [
                        feedId,
                        'https://charts.example.test/feed.xml',
                        start,
                        start,
                        start,
                    ],
                },
                {
                    sql: `INSERT INTO subscription_categories (
                            id, user_id, name, created_at, updated_at
                        ) VALUES (?, ?, 'Charts', ?, ?)`,
                    bindings: [categoryId, userId, start, start],
                },
                {
                    sql: `INSERT INTO subscription_categories (
                            id, user_id, name, created_at, updated_at
                        ) VALUES (?, ?, 'Other', ?, ?)`,
                    bindings: [911_002, otherUserId, start, start],
                },
                {
                    sql: `INSERT INTO feed_subscriptions (
                            user_id, feed_id, category_id,
                            read_through_entry_id, created_at, updated_at
                        ) VALUES (?, ?, ?, NULL, ?, ?)`,
                    bindings: [userId, feedId, categoryId, start, start],
                },
                {
                    sql: `INSERT INTO feed_subscriptions (
                            user_id, feed_id, category_id,
                            read_through_entry_id, created_at, updated_at
                        ) VALUES (?, ?, ?, NULL, ?, ?)`,
                    bindings: [otherUserId, feedId, 911_002, start, start],
                },
            ]),
        );
        await Effect.runPromise(
            d1.batch([
                {
                    sql: `INSERT INTO entries (
                            id, feed_id, deduplication_key, title,
                            published_at, content_status, created_at, updated_at
                        ) VALUES (?, ?, ?, 'Read entry', ?, 'empty', ?, ?)`,
                    bindings: [913_001, feedId, bytes(3), start, start, start],
                },
                {
                    sql: `INSERT INTO entries (
                            id, feed_id, deduplication_key, title,
                            published_at, content_status, created_at, updated_at
                        ) VALUES (?, ?, ?, 'Unread entry', ?, 'empty', ?, ?)`,
                    bindings: [
                        913_002,
                        feedId,
                        bytes(4),
                        start + day,
                        start + day,
                        start + day,
                    ],
                },
                {
                    sql: `INSERT INTO entries (
                            id, feed_id, deduplication_key, title,
                            published_at, content_status, created_at, updated_at
                        ) VALUES (?, ?, ?, 'Filtered entry', ?, 'empty', ?, ?)`,
                    bindings: [
                        913_003,
                        feedId,
                        bytes(5),
                        start + day,
                        start + day,
                        start + day,
                    ],
                },
                {
                    sql: `UPDATE feed_subscriptions
                        SET read_through_entry_id = ?
                        WHERE user_id = ? AND feed_id = ?`,
                    bindings: [913_001, userId, feedId],
                },
                {
                    sql: `INSERT INTO entry_interactions (
                            user_id, feed_id, entry_id, starred_at,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        userId,
                        feedId,
                        913_001,
                        start + 1,
                        start,
                        start + 1,
                    ],
                },
                {
                    sql: `INSERT INTO entry_interactions (
                            user_id, feed_id, entry_id, filtered_at,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        userId,
                        feedId,
                        913_003,
                        start + day,
                        start + day,
                        start + day,
                    ],
                },
                {
                    sql: `INSERT INTO chart_daily_refreshes (
                            feed_id, day_start, attempts_count,
                            successes_count, failures_count,
                            entries_created_count, created_at, updated_at
                        ) VALUES (?, ?, 1, 1, 0, 2, ?, ?),
                                 (?, ?, 1, 0, 1, 0, ?, ?)`,
                    bindings: [
                        feedId,
                        start,
                        start,
                        start,
                        feedId,
                        start + day,
                        start + day,
                        start + day,
                    ],
                },
                {
                    sql: `INSERT INTO chart_daily_activity (
                            user_id, feed_id, day_start, marked_read_count,
                            marked_unread_count, saved_count, unsaved_count,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, 3, 1, 2, 0, ?, ?)`,
                    bindings: [
                        userId,
                        feedId,
                        start + day,
                        start + day,
                        start + day,
                    ],
                },
            ]),
        );

        await expect(
            Effect.runPromise(
                repository.load({
                    userId,
                    startAt: start,
                    endAt: start + 2 * day,
                    scope: { type: 'category', id: categoryId },
                }),
            ),
        ).resolves.toMatchObject({
            scope: { type: 'category', id: categoryId, name: 'Charts' },
            cohorts: [
                {
                    date: '2026-07-17',
                    received: 1,
                    currently_read: 1,
                    currently_saved: 1,
                },
                {
                    date: '2026-07-18',
                    received: 1,
                    currently_read: 0,
                    currently_saved: 0,
                },
            ],
            currentUnread: 1,
            refreshes: [
                {
                    date: '2026-07-17',
                    successes: 1,
                    failures: 0,
                    entries_created: 2,
                },
                {
                    date: '2026-07-18',
                    successes: 0,
                    failures: 1,
                    entries_created: 0,
                },
            ],
            activity: [
                {
                    date: '2026-07-18',
                    marked_read: 3,
                    marked_unread: 1,
                    saved: 2,
                    unsaved: 0,
                },
            ],
            activityCoverageStart: '2026-07-18',
        });

        await expect(
            Effect.runPromise(
                repository.load({
                    userId: otherUserId,
                    startAt: start,
                    endAt: start + 2 * day,
                    scope: { type: 'category', id: categoryId },
                }),
            ),
        ).rejects.toBeInstanceOf(ChartNotFound);
    });

    it('uses the activity day index for bounded user windows', async () => {
        const plan = await env.DB.prepare(
            `EXPLAIN QUERY PLAN
             SELECT day_start FROM chart_daily_activity
             WHERE user_id = ? AND day_start >= ? AND day_start < ?
             ORDER BY day_start`,
        )
            .bind(1, start, start + day)
            .all<{ detail: string }>();

        expect(plan.results.map(({ detail }) => detail).join('\n')).toContain(
            'chart_daily_activity_user_day',
        );
    });
});

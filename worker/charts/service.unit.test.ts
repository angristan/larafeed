import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ChartRepository } from './repository';
import { makeChartService } from './service';

const day = 24 * 60 * 60_000;

describe('chart service', () => {
    it('densifies UTC days and reports unavailable pre-coverage activity', async () => {
        const repository: ChartRepository = {
            load: () =>
                Effect.succeed({
                    scope: {
                        type: 'all' as const,
                        id: null,
                        name: 'All subscriptions',
                    },
                    cohorts: [
                        {
                            date: '2026-07-17',
                            received: 4,
                            currently_read: 3,
                            currently_saved: 1,
                        },
                    ],
                    currentUnread: 5,
                    refreshes: [
                        {
                            date: '2026-07-18',
                            successes: 2,
                            failures: 1,
                            entries_created: 7,
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
                }),
        };
        const service = makeChartService({ repository });
        const startAt = Date.parse('2026-07-17T00:00:00.000Z');

        await expect(
            Effect.runPromise(
                service.getCharts({
                    userId: 1,
                    startAt,
                    endAt: startAt + 2 * day,
                    scope: { type: 'all' },
                }),
            ),
        ).resolves.toMatchObject({
            window: {
                startDate: '2026-07-17',
                endDate: '2026-07-18',
                dayCount: 2,
            },
            summary: {
                received: 4,
                currentlyRead: 3,
                currentUnread: 5,
                cohortReadThroughRate: 75,
                refreshAttempts: 3,
                refreshSuccessRate: 66.67,
                refreshEntriesCreated: 7,
            },
            days: [
                {
                    date: '2026-07-17',
                    currentlyUnread: 1,
                    markedRead: null,
                },
                {
                    date: '2026-07-18',
                    received: 0,
                    markedRead: 3,
                    saved: 2,
                },
            ],
            activityCoverageStart: '2026-07-18',
        });
    });
});

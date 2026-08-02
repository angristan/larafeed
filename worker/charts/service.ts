import { ChartResponse } from '@shared/schemas/charts';
import { Effect } from 'effect';

import type { ChartRepository, ChartScopeInput } from './repository';

const DAY_MS = 24 * 60 * 60_000;

export interface ChartServiceInput {
    readonly userId: number;
    readonly startAt: number;
    readonly endAt: number;
    readonly scope: ChartScopeInput;
}

export interface ChartServiceDependencies {
    readonly repository: ChartRepository;
}

const date = (timestamp: number): string =>
    new Date(timestamp).toISOString().slice(0, 10);
const rate = (numerator: number, denominator: number): number | null =>
    denominator === 0
        ? null
        : Math.round((numerator / denominator) * 10_000) / 100;

export const makeChartService = (dependencies: ChartServiceDependencies) => ({
    getCharts: (input: ChartServiceInput) =>
        dependencies.repository.load(input).pipe(
            Effect.map((result) => {
                const cohorts = new Map(
                    result.cohorts.map((row) => [row.date, row]),
                );
                const refreshes = new Map(
                    result.refreshes.map((row) => [row.date, row]),
                );
                const activity = new Map(
                    result.activity.map((row) => [row.date, row]),
                );
                const days = [];
                for (
                    let timestamp = input.startAt;
                    timestamp < input.endAt;
                    timestamp += DAY_MS
                ) {
                    const currentDate = date(timestamp);
                    const cohort = cohorts.get(currentDate);
                    const refresh = refreshes.get(currentDate);
                    const actions = activity.get(currentDate);
                    const received = cohort?.received ?? 0;
                    const currentlyRead = cohort?.currently_read ?? 0;
                    const activityCovered =
                        result.activityCoverageStart !== null &&
                        currentDate >= result.activityCoverageStart;
                    days.push({
                        date: currentDate,
                        received,
                        currentlyRead,
                        currentlyUnread: received - currentlyRead,
                        currentlySaved: cohort?.currently_saved ?? 0,
                        cohortReadThroughRate: rate(currentlyRead, received),
                        markedRead: activityCovered
                            ? (actions?.marked_read ?? 0)
                            : null,
                        markedUnread: activityCovered
                            ? (actions?.marked_unread ?? 0)
                            : null,
                        saved: activityCovered ? (actions?.saved ?? 0) : null,
                        unsaved: activityCovered
                            ? (actions?.unsaved ?? 0)
                            : null,
                        refreshSuccesses: refresh?.successes ?? 0,
                        refreshFailures: refresh?.failures ?? 0,
                        refreshEntriesCreated: refresh?.entries_created ?? 0,
                    });
                }
                const totals = days.reduce(
                    (summary, day) => ({
                        received: summary.received + day.received,
                        currentlyRead:
                            summary.currentlyRead + day.currentlyRead,
                        currentlySaved:
                            summary.currentlySaved + day.currentlySaved,
                        refreshSuccesses:
                            summary.refreshSuccesses + day.refreshSuccesses,
                        refreshFailures:
                            summary.refreshFailures + day.refreshFailures,
                        refreshEntriesCreated:
                            summary.refreshEntriesCreated +
                            day.refreshEntriesCreated,
                    }),
                    {
                        received: 0,
                        currentlyRead: 0,
                        currentlySaved: 0,
                        refreshSuccesses: 0,
                        refreshFailures: 0,
                        refreshEntriesCreated: 0,
                    },
                );
                const refreshAttempts =
                    totals.refreshSuccesses + totals.refreshFailures;
                return ChartResponse.make({
                    window: {
                        startDate: date(input.startAt),
                        endDate: date(input.endAt - DAY_MS),
                        timeZone: 'UTC',
                        dayCount: days.length,
                    },
                    scope: result.scope,
                    summary: {
                        received: totals.received,
                        currentlyRead: totals.currentlyRead,
                        currentlySaved: totals.currentlySaved,
                        currentUnread: result.currentUnread,
                        cohortReadThroughRate: rate(
                            totals.currentlyRead,
                            totals.received,
                        ),
                        refreshAttempts,
                        refreshSuccesses: totals.refreshSuccesses,
                        refreshFailures: totals.refreshFailures,
                        refreshSuccessRate: rate(
                            totals.refreshSuccesses,
                            refreshAttempts,
                        ),
                        refreshEntriesCreated: totals.refreshEntriesCreated,
                    },
                    days,
                    activityCoverageStart: result.activityCoverageStart,
                });
            }),
        ),
});

export type ChartService = ReturnType<typeof makeChartService>;

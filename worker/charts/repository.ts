import type { ChartScope } from '@shared/schemas/charts';
import { Effect, Schema } from 'effect';

import type { D1, D1OperationError } from '../infrastructure/d1';
import {
    ChartInvariantError,
    ChartNotFound,
    ChartStorageError,
} from './errors';

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const DateString = Schema.String;
const CohortRow = Schema.Struct({
    date: DateString,
    received: Count,
    currently_read: Count,
    currently_saved: Count,
});
const UnreadRow = Schema.Struct({ current_unread: Count });
const RefreshRow = Schema.Struct({
    date: DateString,
    successes: Count,
    failures: Count,
    entries_created: Count,
});
const ActivityRow = Schema.Struct({
    date: DateString,
    marked_read: Count,
    marked_unread: Count,
    saved: Count,
    unsaved: Count,
});
const CoverageRow = Schema.Struct({ date: Schema.NullOr(DateString) });
const ScopeNameRow = Schema.Struct({ name: Schema.String });

export type ChartScopeInput =
    | { readonly type: 'all' }
    | { readonly type: 'feed'; readonly id: number }
    | { readonly type: 'category'; readonly id: number };

export interface ChartQueryInput {
    readonly userId: number;
    readonly startAt: number;
    readonly endAt: number;
    readonly scope: ChartScopeInput;
}

export interface ChartRepositoryResult {
    readonly scope: ChartScope;
    readonly cohorts: readonly (typeof CohortRow.Type)[];
    readonly currentUnread: number;
    readonly refreshes: readonly (typeof RefreshRow.Type)[];
    readonly activity: readonly (typeof ActivityRow.Type)[];
    readonly activityCoverageStart: string | null;
}

export interface ChartRepository {
    readonly load: (
        input: ChartQueryInput,
    ) => Effect.Effect<
        ChartRepositoryResult,
        ChartNotFound | ChartStorageError | ChartInvariantError
    >;
}

const effectiveRead = `CASE
    WHEN ei.read_override IS NOT NULL THEN ei.read_override
    WHEN fs.read_through_entry_id IS NOT NULL AND e.id <= fs.read_through_entry_id THEN 1
    ELSE 0 END`;
const dayExpression = (column: string) =>
    `strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`;
const invariant = (operation: string) => new ChartInvariantError({ operation });
const withStorage = <A, R>(
    operation: string,
    effect: Effect.Effect<A, D1OperationError, R>,
): Effect.Effect<A, ChartStorageError, R> =>
    effect.pipe(
        Effect.mapError((cause) => new ChartStorageError({ operation, cause })),
    );
const decode = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    value: unknown,
): Effect.Effect<S['Type'], ChartInvariantError> =>
    Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(value),
        catch: () => invariant(operation),
    });
const decodeRows = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    rows: readonly unknown[],
) => Effect.forEach(rows, (row) => decode(operation, schema, row));

const scopeSql = (
    scope: ChartScopeInput,
    userId: number,
): { readonly clause: string; readonly bindings: readonly number[] } => {
    switch (scope.type) {
        case 'feed':
            return {
                clause: 'fs.user_id = ? AND fs.feed_id = ?',
                bindings: [userId, scope.id],
            };
        case 'category':
            return {
                clause: 'fs.user_id = ? AND fs.category_id = ?',
                bindings: [userId, scope.id],
            };
        case 'all':
            return { clause: 'fs.user_id = ?', bindings: [userId] };
    }
};

const resolveScope = (
    d1: D1,
    userId: number,
    scope: ChartScopeInput,
): Effect.Effect<
    ChartScope,
    ChartNotFound | ChartStorageError | ChartInvariantError
> => {
    if (scope.type === 'all') {
        return Effect.succeed({
            type: 'all' as const,
            id: null,
            name: 'All subscriptions',
        });
    }
    const operation = 'charts.scope';
    const statement =
        scope.type === 'feed'
            ? {
                  sql: `SELECT COALESCE(fs.custom_feed_name, f.name) AS name
                      FROM feed_subscriptions fs
                      JOIN feeds f ON f.id = fs.feed_id
                      WHERE fs.user_id = ? AND fs.feed_id = ?`,
                  bindings: [userId, scope.id],
              }
            : {
                  sql: `SELECT name FROM subscription_categories
                      WHERE user_id = ? AND id = ?`,
                  bindings: [userId, scope.id],
              };
    return Effect.gen(function* () {
        const row = yield* withStorage(operation, d1.first(statement));
        if (row === null) return yield* Effect.fail(new ChartNotFound());
        const name = (yield* decode(operation, ScopeNameRow, row)).name;
        return { type: scope.type, id: scope.id, name };
    });
};

export const makeChartRepository = (d1: D1): ChartRepository => ({
    load: (input) =>
        Effect.gen(function* () {
            const operation = 'charts.load';
            const scope = yield* resolveScope(d1, input.userId, input.scope);
            const scoped = scopeSql(input.scope, input.userId);
            const cohortBindings = [
                ...scoped.bindings,
                input.startAt,
                input.endAt,
            ];
            const refreshBindings = [
                ...scoped.bindings,
                input.startAt,
                input.endAt,
            ];
            const results = yield* withStorage(
                operation,
                d1.batch([
                    {
                        sql: `SELECT ${dayExpression('e.created_at')} AS date,
                            COUNT(*) AS received,
                            SUM(CASE WHEN ${effectiveRead} = 1 THEN 1 ELSE 0 END) AS currently_read,
                            SUM(CASE WHEN ei.starred_at IS NOT NULL THEN 1 ELSE 0 END) AS currently_saved
                        FROM entries e
                        JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
                        LEFT JOIN entry_interactions ei
                          ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                        WHERE ${scoped.clause} AND ei.filtered_at IS NULL
                          AND e.created_at >= ? AND e.created_at < ?
                        GROUP BY date ORDER BY date`,
                        bindings: cohortBindings,
                    },
                    {
                        sql: `SELECT COUNT(*) AS current_unread
                        FROM entries e
                        JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
                        LEFT JOIN entry_interactions ei
                          ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                        WHERE ${scoped.clause} AND ei.filtered_at IS NULL
                          AND ${effectiveRead} = 0`,
                        bindings: scoped.bindings,
                    },
                    {
                        sql: `SELECT ${dayExpression('r.day_start')} AS date,
                            SUM(r.successes_count) AS successes,
                            SUM(r.failures_count) AS failures,
                            SUM(r.entries_created_count) AS entries_created
                        FROM chart_daily_refreshes r
                        JOIN feed_subscriptions fs ON fs.feed_id = r.feed_id
                        WHERE ${scoped.clause}
                          AND r.day_start >= ? AND r.day_start < ?
                        GROUP BY date ORDER BY date`,
                        bindings: refreshBindings,
                    },
                    {
                        sql: `SELECT ${dayExpression('a.day_start')} AS date,
                            SUM(a.marked_read_count) AS marked_read,
                            SUM(a.marked_unread_count) AS marked_unread,
                            SUM(a.saved_count) AS saved,
                            SUM(a.unsaved_count) AS unsaved
                        FROM chart_daily_activity a
                        JOIN feed_subscriptions fs
                          ON fs.user_id = a.user_id AND fs.feed_id = a.feed_id
                        WHERE ${scoped.clause}
                          AND a.day_start >= ? AND a.day_start < ?
                        GROUP BY date ORDER BY date`,
                        bindings: cohortBindings,
                    },
                    {
                        sql: `SELECT MIN(${dayExpression('a.day_start')}) AS date
                        FROM chart_daily_activity a
                        JOIN feed_subscriptions fs
                          ON fs.user_id = a.user_id AND fs.feed_id = a.feed_id
                        WHERE ${scoped.clause}`,
                        bindings: scoped.bindings,
                    },
                ]),
            );
            const cohorts = yield* decodeRows(
                operation,
                CohortRow,
                results[0]?.results ?? [],
            );
            const unreadRows = yield* decodeRows(
                operation,
                UnreadRow,
                results[1]?.results ?? [],
            );
            const refreshes = yield* decodeRows(
                operation,
                RefreshRow,
                results[2]?.results ?? [],
            );
            const activity = yield* decodeRows(
                operation,
                ActivityRow,
                results[3]?.results ?? [],
            );
            const coverageRows = yield* decodeRows(
                operation,
                CoverageRow,
                results[4]?.results ?? [],
            );
            if (unreadRows.length !== 1 || coverageRows.length !== 1) {
                return yield* Effect.fail(invariant(operation));
            }
            return {
                scope,
                cohorts,
                currentUnread: unreadRows[0]?.current_unread ?? 0,
                refreshes,
                activity,
                activityCoverageStart: coverageRows[0]?.date ?? null,
            };
        }),
});

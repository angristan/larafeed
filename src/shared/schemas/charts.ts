import { Schema } from 'effect';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Rate = Schema.Number.check(
    Schema.isBetween({ minimum: 0, maximum: 100 }),
);
const DateString = Schema.String.check(
    Schema.isMinLength(10),
    Schema.isMaxLength(10),
);

export const ChartRange = Schema.Literals(['30', '90', '365', 'custom']);
export type ChartRange = typeof ChartRange.Type;

export const ChartScope = Schema.Union([
    Schema.Struct({
        type: Schema.Literal('all'),
        id: Schema.Null,
        name: Schema.String,
    }),
    Schema.Struct({
        type: Schema.Literals(['feed', 'category']),
        id: SafeId,
        name: Schema.String,
    }),
]);
export type ChartScope = typeof ChartScope.Type;

export class ChartWindow extends Schema.Class<ChartWindow>('ChartWindow')({
    startDate: DateString,
    endDate: DateString,
    timeZone: Schema.Literal('UTC'),
    dayCount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 366 })),
}) {}

export class ChartSummary extends Schema.Class<ChartSummary>('ChartSummary')({
    received: Count,
    currentlyRead: Count,
    currentlySaved: Count,
    currentUnread: Count,
    cohortReadThroughRate: Schema.NullOr(Rate),
    refreshAttempts: Count,
    refreshSuccesses: Count,
    refreshFailures: Count,
    refreshSuccessRate: Schema.NullOr(Rate),
    refreshEntriesCreated: Count,
}) {}

export class ChartDay extends Schema.Class<ChartDay>('ChartDay')({
    date: DateString,
    received: Count,
    currentlyRead: Count,
    currentlyUnread: Count,
    currentlySaved: Count,
    cohortReadThroughRate: Schema.NullOr(Rate),
    markedRead: Schema.NullOr(Count),
    markedUnread: Schema.NullOr(Count),
    saved: Schema.NullOr(Count),
    unsaved: Schema.NullOr(Count),
    refreshSuccesses: Count,
    refreshFailures: Count,
    refreshEntriesCreated: Count,
}) {}

export class ChartResponse extends Schema.Class<ChartResponse>('ChartResponse')(
    {
        window: ChartWindow,
        scope: ChartScope,
        summary: ChartSummary,
        days: Schema.Array(ChartDay).check(Schema.isMaxLength(366)),
        activityCoverageStart: Schema.NullOr(DateString),
    },
) {}

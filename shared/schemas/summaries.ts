import { Schema } from 'effect';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const EntrySummary = Schema.Struct({
    id: SafeId,
    entryId: SafeId,
    html: Schema.String.check(Schema.isLengthBetween(1, 32_000)),
    model: Schema.String.check(Schema.isLengthBetween(1, 100)),
    promptVersion: Schema.String.check(Schema.isLengthBetween(1, 100)),
    generatedAt: Timestamp,
});
export type EntrySummary = typeof EntrySummary.Type;

export class EntrySummaryResponse extends Schema.Class<EntrySummaryResponse>(
    'EntrySummaryResponse',
)({
    summary: Schema.NullOr(EntrySummary),
}) {}

import { Schema } from 'effect';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const EntryFullContentSummary = Schema.Struct({
    html: Schema.String.check(Schema.isLengthBetween(1, 32_000)),
    model: Schema.String.check(Schema.isLengthBetween(1, 100)),
    promptVersion: Schema.String.check(Schema.isLengthBetween(1, 100)),
    generatedAt: Timestamp,
});
export type EntryFullContentSummary = typeof EntryFullContentSummary.Type;

export const EntryFullContent = Schema.Struct({
    entryId: SafeId,
    html: Schema.String.check(Schema.isLengthBetween(1, 2_000_000)),
    sourceUrl: Schema.String.check(Schema.isLengthBetween(1, 2_048)),
    fetchedAt: Timestamp,
    summary: Schema.NullOr(EntryFullContentSummary),
});
export type EntryFullContent = typeof EntryFullContent.Type;

export class EntryFullContentResponse extends Schema.Class<EntryFullContentResponse>(
    'EntryFullContentResponse',
)({
    fullContent: Schema.NullOr(EntryFullContent),
}) {}

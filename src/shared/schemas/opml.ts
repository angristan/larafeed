import { Schema } from 'effect';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NonEmptyString = Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
);

export const OpmlImportState = Schema.Literals([
    'pending',
    'processing',
    'completed',
    'failed',
    'canceled',
]);
export type OpmlImportState = typeof OpmlImportState.Type;

export class CreateOpmlImportRequest extends Schema.Class<CreateOpmlImportRequest>(
    'CreateOpmlImportRequest',
)({
    opml: Schema.String.check(
        Schema.isMinLength(1),
        Schema.isMaxLength(2_000_000),
    ),
    filename: Schema.optionalKey(
        Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(255)),
    ),
}) {}

export class OpmlImportItemError extends Schema.Class<OpmlImportItemError>(
    'OpmlImportItemError',
)({
    position: Count,
    title: Schema.NullOr(Schema.String),
    feedUrl: NonEmptyString,
    errorClass: NonEmptyString,
}) {}

export class OpmlImportResponse extends Schema.Class<OpmlImportResponse>(
    'OpmlImportResponse',
)({
    id: SafeId,
    state: OpmlImportState,
    filename: Schema.NullOr(Schema.String),
    totalItems: Count,
    succeededItems: Count,
    failedItems: Count,
    skippedItems: Count,
    startedAt: Schema.NullOr(Timestamp),
    completedAt: Schema.NullOr(Timestamp),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    errors: Schema.Array(OpmlImportItemError),
}) {}

export class OpmlImportListResponse extends Schema.Class<OpmlImportListResponse>(
    'OpmlImportListResponse',
)({
    imports: Schema.Array(OpmlImportResponse),
}) {}

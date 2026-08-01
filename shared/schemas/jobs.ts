import { Schema } from 'effect';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NonEmptyString = Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
);

export const JobState = Schema.Literals([
    'pending',
    'queued',
    'running',
    'succeeded',
    'failed',
    'dead_lettered',
    'canceled',
]);
export type JobState = typeof JobState.Type;

export class RefreshCommandResponse extends Schema.Class<RefreshCommandResponse>(
    'RefreshCommandResponse',
)({
    jobId: SafeId,
    operationId: NonEmptyString,
    state: JobState,
}) {}

export class JobStatusResponse extends Schema.Class<JobStatusResponse>(
    'JobStatusResponse',
)({
    jobId: SafeId,
    operationId: NonEmptyString,
    kind: NonEmptyString,
    state: JobState,
    attemptCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    maxAttempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    availableAt: Timestamp,
    startedAt: Schema.NullOr(Timestamp),
    completedAt: Schema.NullOr(Timestamp),
    lastErrorClass: Schema.NullOr(Schema.String),
}) {}

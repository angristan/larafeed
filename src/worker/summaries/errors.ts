import { Schema } from 'effect';

export class SummaryConfigError extends Schema.TaggedError<SummaryConfigError>()(
    'SummaryConfigError',
    {},
) {}

export class SummaryValidationError extends Schema.TaggedError<SummaryValidationError>()(
    'SummaryValidationError',
    {},
) {}

export class SummaryNotFound extends Schema.TaggedError<SummaryNotFound>()(
    'SummaryNotFound',
    {},
) {}

export class SummaryContentUnavailable extends Schema.TaggedError<SummaryContentUnavailable>()(
    'SummaryContentUnavailable',
    {},
) {}

export class SummaryFeatureDisabled extends Schema.TaggedError<SummaryFeatureDisabled>()(
    'SummaryFeatureDisabled',
    {},
) {}

export class SummaryRateLimited extends Schema.TaggedError<SummaryRateLimited>()(
    'SummaryRateLimited',
    {},
) {}

export class SummaryGenerationInProgress extends Schema.TaggedError<SummaryGenerationInProgress>()(
    'SummaryGenerationInProgress',
    {},
) {}

export class SummaryContentChanged extends Schema.TaggedError<SummaryContentChanged>()(
    'SummaryContentChanged',
    {},
) {}

export class SummaryStorageError extends Schema.TaggedError<SummaryStorageError>()(
    'SummaryStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class SummaryInvariantError extends Schema.TaggedError<SummaryInvariantError>()(
    'SummaryInvariantError',
    {
        operation: Schema.String,
    },
) {}

export const SummaryProviderFailureKind = Schema.Literals([
    'transport',
    'timeout',
    'rate_limited',
    'unavailable',
    'rejected',
    'invalid_response',
    'output_too_large',
]);
export type SummaryProviderFailureKind = typeof SummaryProviderFailureKind.Type;

export class SummaryProviderError extends Schema.TaggedError<SummaryProviderError>()(
    'SummaryProviderError',
    {
        kind: SummaryProviderFailureKind,
        status: Schema.optional(Schema.Int),
    },
) {}

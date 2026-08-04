import { Schema } from 'effect';

export class SummaryConfigError extends Schema.TaggedErrorClass<SummaryConfigError>()(
    'SummaryConfigError',
    {},
) {}

export class SummaryValidationError extends Schema.TaggedErrorClass<SummaryValidationError>()(
    'SummaryValidationError',
    {},
) {}

export class SummaryNotFound extends Schema.TaggedErrorClass<SummaryNotFound>()(
    'SummaryNotFound',
    {},
) {}

export class SummaryContentUnavailable extends Schema.TaggedErrorClass<SummaryContentUnavailable>()(
    'SummaryContentUnavailable',
    {},
) {}

export class SummaryFeatureDisabled extends Schema.TaggedErrorClass<SummaryFeatureDisabled>()(
    'SummaryFeatureDisabled',
    {},
) {}

export class SummaryRateLimited extends Schema.TaggedErrorClass<SummaryRateLimited>()(
    'SummaryRateLimited',
    {},
) {}

export class SummaryGenerationInProgress extends Schema.TaggedErrorClass<SummaryGenerationInProgress>()(
    'SummaryGenerationInProgress',
    {},
) {}

export class SummaryContentChanged extends Schema.TaggedErrorClass<SummaryContentChanged>()(
    'SummaryContentChanged',
    {},
) {}

export class SummaryStorageError extends Schema.TaggedErrorClass<SummaryStorageError>()(
    'SummaryStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class SummaryInvariantError extends Schema.TaggedErrorClass<SummaryInvariantError>()(
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

export class SummaryProviderError extends Schema.TaggedErrorClass<SummaryProviderError>()(
    'SummaryProviderError',
    {
        kind: SummaryProviderFailureKind,
        status: Schema.optional(Schema.Int),
    },
) {}

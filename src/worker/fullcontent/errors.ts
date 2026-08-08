import { Schema } from 'effect';

export class FullContentConfigError extends Schema.TaggedError<FullContentConfigError>()(
    'FullContentConfigError',
    {},
) {}

export class FullContentValidationError extends Schema.TaggedError<FullContentValidationError>()(
    'FullContentValidationError',
    {},
) {}

export class FullContentNotFound extends Schema.TaggedError<FullContentNotFound>()(
    'FullContentNotFound',
    {},
) {}

export class FullContentDisabled extends Schema.TaggedError<FullContentDisabled>()(
    'FullContentDisabled',
    {},
) {}

export class FullContentSummaryDisabled extends Schema.TaggedError<FullContentSummaryDisabled>()(
    'FullContentSummaryDisabled',
    {},
) {}

export class FullContentRateLimited extends Schema.TaggedError<FullContentRateLimited>()(
    'FullContentRateLimited',
    {},
) {}

export class FullContentSourceMissing extends Schema.TaggedError<FullContentSourceMissing>()(
    'FullContentSourceMissing',
    {},
) {}

export class FullContentUnavailable extends Schema.TaggedError<FullContentUnavailable>()(
    'FullContentUnavailable',
    {},
) {}

export class FullContentTooLarge extends Schema.TaggedError<FullContentTooLarge>()(
    'FullContentTooLarge',
    {},
) {}

export class FullContentExtractError extends Schema.TaggedError<FullContentExtractError>()(
    'FullContentExtractError',
    {},
) {}

export const FullContentFetchFailureKind = Schema.Literals([
    'network',
    'timeout',
    'http',
    'policy',
    'unsupported_content',
    'too_large',
]);
export type FullContentFetchFailureKind =
    typeof FullContentFetchFailureKind.Type;

export class FullContentFetchError extends Schema.TaggedError<FullContentFetchError>()(
    'FullContentFetchError',
    {
        kind: FullContentFetchFailureKind,
        status: Schema.optional(Schema.Int),
    },
) {}

export class FullContentStorageError extends Schema.TaggedError<FullContentStorageError>()(
    'FullContentStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class FullContentInvariantError extends Schema.TaggedError<FullContentInvariantError>()(
    'FullContentInvariantError',
    {
        operation: Schema.String,
    },
) {}

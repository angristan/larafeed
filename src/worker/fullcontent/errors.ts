import { Schema } from 'effect';

export class FullContentConfigError extends Schema.TaggedErrorClass<FullContentConfigError>()(
    'FullContentConfigError',
    {},
) {}

export class FullContentValidationError extends Schema.TaggedErrorClass<FullContentValidationError>()(
    'FullContentValidationError',
    {},
) {}

export class FullContentNotFound extends Schema.TaggedErrorClass<FullContentNotFound>()(
    'FullContentNotFound',
    {},
) {}

export class FullContentDisabled extends Schema.TaggedErrorClass<FullContentDisabled>()(
    'FullContentDisabled',
    {},
) {}

export class FullContentSummaryDisabled extends Schema.TaggedErrorClass<FullContentSummaryDisabled>()(
    'FullContentSummaryDisabled',
    {},
) {}

export class FullContentRateLimited extends Schema.TaggedErrorClass<FullContentRateLimited>()(
    'FullContentRateLimited',
    {},
) {}

export class FullContentSourceMissing extends Schema.TaggedErrorClass<FullContentSourceMissing>()(
    'FullContentSourceMissing',
    {},
) {}

export class FullContentUnavailable extends Schema.TaggedErrorClass<FullContentUnavailable>()(
    'FullContentUnavailable',
    {},
) {}

export class FullContentTooLarge extends Schema.TaggedErrorClass<FullContentTooLarge>()(
    'FullContentTooLarge',
    {},
) {}

export class FullContentExtractError extends Schema.TaggedErrorClass<FullContentExtractError>()(
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

export class FullContentFetchError extends Schema.TaggedErrorClass<FullContentFetchError>()(
    'FullContentFetchError',
    {
        kind: FullContentFetchFailureKind,
        status: Schema.optional(Schema.Int),
    },
) {}

export class FullContentStorageError extends Schema.TaggedErrorClass<FullContentStorageError>()(
    'FullContentStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class FullContentInvariantError extends Schema.TaggedErrorClass<FullContentInvariantError>()(
    'FullContentInvariantError',
    {
        operation: Schema.String,
    },
) {}

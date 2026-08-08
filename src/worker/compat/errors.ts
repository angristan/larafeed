import { Schema } from 'effect';

export class CompatibilityValidationError extends Schema.TaggedError<CompatibilityValidationError>()(
    'CompatibilityValidationError',
    {},
) {}

export class CompatibilityStorageError extends Schema.TaggedError<CompatibilityStorageError>()(
    'CompatibilityStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class CompatibilityInvariantError extends Schema.TaggedError<CompatibilityInvariantError>()(
    'CompatibilityInvariantError',
    { operation: Schema.String },
) {}

export class CompatibilityRateLimited extends Schema.TaggedError<CompatibilityRateLimited>()(
    'CompatibilityRateLimited',
    {},
) {}

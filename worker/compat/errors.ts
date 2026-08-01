import { Schema } from 'effect';

export class CompatibilityValidationError extends Schema.TaggedErrorClass<CompatibilityValidationError>()(
    'CompatibilityValidationError',
    {},
) {}

export class CompatibilityStorageError extends Schema.TaggedErrorClass<CompatibilityStorageError>()(
    'CompatibilityStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class CompatibilityInvariantError extends Schema.TaggedErrorClass<CompatibilityInvariantError>()(
    'CompatibilityInvariantError',
    { operation: Schema.String },
) {}

export class CompatibilityRateLimited extends Schema.TaggedErrorClass<CompatibilityRateLimited>()(
    'CompatibilityRateLimited',
    {},
) {}

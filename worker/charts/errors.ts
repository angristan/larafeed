import { Schema } from 'effect';

export class ChartValidationError extends Schema.TaggedErrorClass<ChartValidationError>()(
    'ChartValidationError',
    {},
) {}

export class ChartNotFound extends Schema.TaggedErrorClass<ChartNotFound>()(
    'ChartNotFound',
    {},
) {}

export class ChartStorageError extends Schema.TaggedErrorClass<ChartStorageError>()(
    'ChartStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class ChartInvariantError extends Schema.TaggedErrorClass<ChartInvariantError>()(
    'ChartInvariantError',
    {
        operation: Schema.String,
    },
) {}

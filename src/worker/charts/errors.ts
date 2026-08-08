import { Schema } from 'effect';

export class ChartValidationError extends Schema.TaggedError<ChartValidationError>()(
    'ChartValidationError',
    {},
) {}

export class ChartNotFound extends Schema.TaggedError<ChartNotFound>()(
    'ChartNotFound',
    {},
) {}

export class ChartStorageError extends Schema.TaggedError<ChartStorageError>()(
    'ChartStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class ChartInvariantError extends Schema.TaggedError<ChartInvariantError>()(
    'ChartInvariantError',
    {
        operation: Schema.String,
    },
) {}

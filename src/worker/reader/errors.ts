import { Schema } from 'effect';

export class ReaderValidationError extends Schema.TaggedError<ReaderValidationError>()(
    'ReaderValidationError',
    {},
) {}

export class ReaderNotFound extends Schema.TaggedError<ReaderNotFound>()(
    'ReaderNotFound',
    {},
) {}

export class ReaderStorageError extends Schema.TaggedError<ReaderStorageError>()(
    'ReaderStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class ReaderInvariantError extends Schema.TaggedError<ReaderInvariantError>()(
    'ReaderInvariantError',
    {
        operation: Schema.String,
    },
) {}

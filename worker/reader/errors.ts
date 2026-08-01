import { Schema } from 'effect';

export class ReaderValidationError extends Schema.TaggedErrorClass<ReaderValidationError>()(
    'ReaderValidationError',
    {},
) {}

export class ReaderNotFound extends Schema.TaggedErrorClass<ReaderNotFound>()(
    'ReaderNotFound',
    {},
) {}

export class ReaderStorageError extends Schema.TaggedErrorClass<ReaderStorageError>()(
    'ReaderStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class ReaderInvariantError extends Schema.TaggedErrorClass<ReaderInvariantError>()(
    'ReaderInvariantError',
    {
        operation: Schema.String,
    },
) {}

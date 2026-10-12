import { Schema } from 'effect';

export class McpStorageError extends Schema.TaggedError<McpStorageError>()(
    'McpStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

/** The OAuth store (Workers KV) failed while listing or revoking grants. */
export class McpGrantStoreError extends Schema.TaggedError<McpGrantStoreError>()(
    'McpGrantStoreError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class McpValidationError extends Schema.TaggedError<McpValidationError>()(
    'McpValidationError',
    {},
) {}

export class McpNotFound extends Schema.TaggedError<McpNotFound>()(
    'McpNotFound',
    {},
) {}

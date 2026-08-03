import { Schema } from 'effect';

export class AccountValidationError extends Schema.TaggedErrorClass<AccountValidationError>()(
    'AccountValidationError',
    {
        field: Schema.optionalKey(
            Schema.Literals(['email', 'displayName', 'confirmation']),
        ),
    },
) {}

export class AccountNotFound extends Schema.TaggedErrorClass<AccountNotFound>()(
    'AccountNotFound',
    {},
) {}

export class AccountConflict extends Schema.TaggedErrorClass<AccountConflict>()(
    'AccountConflict',
    { field: Schema.optionalKey(Schema.Literal('email')) },
) {}

export class AccountForbidden extends Schema.TaggedErrorClass<AccountForbidden>()(
    'AccountForbidden',
    {},
) {}

export class AccountStorageError extends Schema.TaggedErrorClass<AccountStorageError>()(
    'AccountStorageError',
    { operation: Schema.String, cause: Schema.Defect() },
) {}

export class AccountInvariantError extends Schema.TaggedErrorClass<AccountInvariantError>()(
    'AccountInvariantError',
    { operation: Schema.String },
) {}

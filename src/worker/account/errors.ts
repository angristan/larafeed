import { Schema } from 'effect';

export class AccountValidationError extends Schema.TaggedError<AccountValidationError>()(
    'AccountValidationError',
    {
        field: Schema.optionalKey(
            Schema.Literals(['email', 'displayName', 'confirmation']),
        ),
    },
) {}

export class AccountNotFound extends Schema.TaggedError<AccountNotFound>()(
    'AccountNotFound',
    {},
) {}

export class AccountConflict extends Schema.TaggedError<AccountConflict>()(
    'AccountConflict',
    { field: Schema.optionalKey(Schema.Literal('email')) },
) {}

export class AccountForbidden extends Schema.TaggedError<AccountForbidden>()(
    'AccountForbidden',
    {},
) {}

export class AccountFreshAuthenticationRequired extends Schema.TaggedError<AccountFreshAuthenticationRequired>()(
    'AccountFreshAuthenticationRequired',
    {},
) {}

export class AccountStorageError extends Schema.TaggedError<AccountStorageError>()(
    'AccountStorageError',
    { operation: Schema.String, cause: Schema.Defect() },
) {}

export class AccountInvariantError extends Schema.TaggedError<AccountInvariantError>()(
    'AccountInvariantError',
    { operation: Schema.String },
) {}

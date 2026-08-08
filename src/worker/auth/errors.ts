import { Schema } from 'effect';

export class AuthValidationError extends Schema.TaggedError<AuthValidationError>()(
    'AuthValidationError',
    {},
) {}

export class AuthenticationFailed extends Schema.TaggedError<AuthenticationFailed>()(
    'AuthenticationFailed',
    {},
) {}

export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
    'Unauthenticated',
    {},
) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()(
    'Forbidden',
    {},
) {}

export class CsrfInvalid extends Schema.TaggedError<CsrfInvalid>()(
    'CsrfInvalid',
    {},
) {}

export class AccessLinkInvalid extends Schema.TaggedError<AccessLinkInvalid>()(
    'AccessLinkInvalid',
    {},
) {}

export class AuthNotFound extends Schema.TaggedError<AuthNotFound>()(
    'AuthNotFound',
    {},
) {}

export class AuthConflict extends Schema.TaggedError<AuthConflict>()(
    'AuthConflict',
    {},
) {}

export class AuthRateLimited extends Schema.TaggedError<AuthRateLimited>()(
    'AuthRateLimited',
    {},
) {}

export class AuthStorageError extends Schema.TaggedError<AuthStorageError>()(
    'AuthStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class AuthInvariantError extends Schema.TaggedError<AuthInvariantError>()(
    'AuthInvariantError',
    {
        operation: Schema.String,
    },
) {}

export class WebAuthnOperationError extends Schema.TaggedError<WebAuthnOperationError>()(
    'WebAuthnOperationError',
    {
        operation: Schema.Literals([
            'authenticationOptions',
            'authenticationVerify',
            'registrationOptions',
            'registrationVerify',
        ]),
        cause: Schema.Defect(),
    },
) {}

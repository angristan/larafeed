import { Schema } from 'effect';

export class AuthValidationError extends Schema.TaggedErrorClass<AuthValidationError>()(
    'AuthValidationError',
    {},
) {}

export class AuthenticationFailed extends Schema.TaggedErrorClass<AuthenticationFailed>()(
    'AuthenticationFailed',
    {},
) {}

export class Unauthenticated extends Schema.TaggedErrorClass<Unauthenticated>()(
    'Unauthenticated',
    {},
) {}

export class Forbidden extends Schema.TaggedErrorClass<Forbidden>()(
    'Forbidden',
    {},
) {}

export class CsrfInvalid extends Schema.TaggedErrorClass<CsrfInvalid>()(
    'CsrfInvalid',
    {},
) {}

export class AccessLinkInvalid extends Schema.TaggedErrorClass<AccessLinkInvalid>()(
    'AccessLinkInvalid',
    {},
) {}

export class AuthNotFound extends Schema.TaggedErrorClass<AuthNotFound>()(
    'AuthNotFound',
    {},
) {}

export class AuthConflict extends Schema.TaggedErrorClass<AuthConflict>()(
    'AuthConflict',
    {},
) {}

export class AuthRateLimited extends Schema.TaggedErrorClass<AuthRateLimited>()(
    'AuthRateLimited',
    {},
) {}

export class AuthStorageError extends Schema.TaggedErrorClass<AuthStorageError>()(
    'AuthStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class AuthInvariantError extends Schema.TaggedErrorClass<AuthInvariantError>()(
    'AuthInvariantError',
    {
        operation: Schema.String,
    },
) {}

export class WebAuthnOperationError extends Schema.TaggedErrorClass<WebAuthnOperationError>()(
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

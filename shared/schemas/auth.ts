import { Schema } from 'effect';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NonEmptyString = Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
);
const Token = Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2048),
);
const WebAuthnJson = Schema.Record(Schema.String, Schema.Unknown);

export const AccessLinkPurpose = Schema.Literals(['enrollment', 'recovery']);
export type AccessLinkPurpose = typeof AccessLinkPurpose.Type;

export class AuthUser extends Schema.Class<AuthUser>('AuthUser')({
    id: SafeId,
    username: NonEmptyString,
    displayName: NonEmptyString,
    isAdmin: Schema.Boolean,
}) {}

export class AuthConfigResponse extends Schema.Class<AuthConfigResponse>(
    'AuthConfigResponse',
)({
    turnstileSiteKey: NonEmptyString,
}) {}

export class UnauthenticatedSessionResponse extends Schema.Class<UnauthenticatedSessionResponse>(
    'UnauthenticatedSessionResponse',
)({
    authenticated: Schema.Literal(false),
}) {}

export class AuthenticatedSessionResponse extends Schema.Class<AuthenticatedSessionResponse>(
    'AuthenticatedSessionResponse',
)({
    authenticated: Schema.Literal(true),
    user: AuthUser,
    expiresAt: NonNegativeInt,
}) {}

export const AuthSessionResponse = Schema.Union([
    UnauthenticatedSessionResponse,
    AuthenticatedSessionResponse,
]);
export type AuthSessionResponse = typeof AuthSessionResponse.Type;

export class AuthenticationOptionsRequest extends Schema.Class<AuthenticationOptionsRequest>(
    'AuthenticationOptionsRequest',
)({
    turnstileToken: Token,
}) {}

export class AuthenticationOptionsResponse extends Schema.Class<AuthenticationOptionsResponse>(
    'AuthenticationOptionsResponse',
)({
    challengeId: SafeId,
    options: WebAuthnJson,
}) {}

export class AuthenticationVerifyRequest extends Schema.Class<AuthenticationVerifyRequest>(
    'AuthenticationVerifyRequest',
)({
    challengeId: SafeId,
    turnstileToken: Token,
    response: WebAuthnJson,
}) {}

export class AccessRegistrationOptionsRequest extends Schema.Class<AccessRegistrationOptionsRequest>(
    'AccessRegistrationOptionsRequest',
)({
    accessToken: Token,
    turnstileToken: Token,
}) {}

export class RegistrationOptionsResponse extends Schema.Class<RegistrationOptionsResponse>(
    'RegistrationOptionsResponse',
)({
    challengeId: SafeId,
    purpose: AccessLinkPurpose,
    options: WebAuthnJson,
}) {}

export class AccessRegistrationVerifyRequest extends Schema.Class<AccessRegistrationVerifyRequest>(
    'AccessRegistrationVerifyRequest',
)({
    accessToken: Token,
    challengeId: SafeId,
    name: NonEmptyString.check(Schema.isMaxLength(100)),
    turnstileToken: Token,
    response: WebAuthnJson,
}) {}

export class PasskeyRegistrationOptionsRequest extends Schema.Class<PasskeyRegistrationOptionsRequest>(
    'PasskeyRegistrationOptionsRequest',
)({
    turnstileToken: Token,
}) {}

export class PasskeyRegistrationVerifyRequest extends Schema.Class<PasskeyRegistrationVerifyRequest>(
    'PasskeyRegistrationVerifyRequest',
)({
    challengeId: SafeId,
    name: NonEmptyString.check(Schema.isMaxLength(100)),
    turnstileToken: Token,
    response: WebAuthnJson,
}) {}

export class Passkey extends Schema.Class<Passkey>('Passkey')({
    id: SafeId,
    name: NonEmptyString,
    transports: Schema.Array(Schema.String),
    backedUp: Schema.Boolean,
    createdAt: NonNegativeInt,
    lastUsedAt: Schema.NullOr(NonNegativeInt),
}) {}

export class PasskeyListResponse extends Schema.Class<PasskeyListResponse>(
    'PasskeyListResponse',
)({
    passkeys: Schema.Array(Passkey),
}) {}

export class PasskeyResponse extends Schema.Class<PasskeyResponse>(
    'PasskeyResponse',
)({
    passkey: Passkey,
}) {}

export class CreateEnrollmentLinkRequest extends Schema.Class<CreateEnrollmentLinkRequest>(
    'CreateEnrollmentLinkRequest',
)({
    username: NonEmptyString.check(Schema.isMaxLength(100)),
    email: NonEmptyString.check(Schema.isMaxLength(320)),
    displayName: NonEmptyString.check(Schema.isMaxLength(200)),
    isAdmin: Schema.Boolean,
}) {}

export class CreateRecoveryLinkRequest extends Schema.Class<CreateRecoveryLinkRequest>(
    'CreateRecoveryLinkRequest',
)({}) {}

export class AccessLinkResponse extends Schema.Class<AccessLinkResponse>(
    'AccessLinkResponse',
)({
    id: SafeId,
    userId: SafeId,
    purpose: AccessLinkPurpose,
    url: NonEmptyString,
    expiresAt: NonNegativeInt,
}) {}

export const AppTokenScope = Schema.Literals(['google-reader', 'fever']);
export type AppTokenScope = typeof AppTokenScope.Type;

export class CreateAppTokenRequest extends Schema.Class<CreateAppTokenRequest>(
    'CreateAppTokenRequest',
)({
    name: NonEmptyString.check(Schema.isMaxLength(100)),
    scopes: Schema.Array(AppTokenScope).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(2),
    ),
}) {}

export class AppToken extends Schema.Class<AppToken>('AppToken')({
    id: SafeId,
    name: NonEmptyString,
    prefix: NonEmptyString,
    scopes: Schema.Array(AppTokenScope),
    createdAt: NonNegativeInt,
    lastUsedAt: Schema.NullOr(NonNegativeInt),
    expiresAt: Schema.NullOr(NonNegativeInt),
}) {}

export class AppTokenListResponse extends Schema.Class<AppTokenListResponse>(
    'AppTokenListResponse',
)({
    tokens: Schema.Array(AppToken),
}) {}

export class CreatedAppTokenResponse extends Schema.Class<CreatedAppTokenResponse>(
    'CreatedAppTokenResponse',
)({
    token: AppToken,
    plaintextToken: NonEmptyString,
}) {}

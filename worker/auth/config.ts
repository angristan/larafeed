import { Effect, Schema } from 'effect';

export const PRODUCTION_RP_ID = 'larafeed.stanislas.cloud';
export const PRODUCTION_ORIGIN = 'https://larafeed.stanislas.cloud';

export type AuthEnvironment = 'development' | 'test' | 'preview' | 'production';

export interface AuthConfigBindings {
    readonly AUTH_ENVIRONMENT: string;
    readonly AUTH_RP_ID: string;
    readonly AUTH_ORIGIN: string;
    readonly AUTH_RP_NAME: string;
    readonly AUTH_CHALLENGE_TTL_SECONDS: string;
    readonly AUTH_SESSION_TTL_SECONDS: string;
    readonly TURNSTILE_SITE_KEY: string;
    readonly TURNSTILE_SECRET_KEY: string;
}

export interface AuthCookieConfig {
    readonly name: string;
    readonly httpOnly: boolean;
    readonly secure: boolean;
    readonly sameSite: 'Lax';
    readonly path: '/';
}

export interface AuthConfig {
    readonly environment: AuthEnvironment;
    readonly rpId: string;
    readonly origin: string;
    readonly rpName: string;
    readonly challengeTtlMs: number;
    readonly sessionTtlMs: number;
    readonly turnstileSiteKey: string;
    readonly turnstileSecretKey: string;
    readonly sessionCookie: AuthCookieConfig;
    readonly csrfCookie: AuthCookieConfig;
}

const ConfigField = Schema.Literals([
    'bindings',
    'AUTH_RP_ID',
    'AUTH_ORIGIN',
    'AUTH_RP_NAME',
    'TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
]);

const ConfigReason = Schema.Literals([
    'invalid',
    'not_canonical',
    'rp_origin_mismatch',
    'insecure_origin',
    'production_identity_mismatch',
]);

export class AuthConfigError extends Schema.TaggedErrorClass<AuthConfigError>()(
    'AuthConfigError',
    {
        field: ConfigField,
        reason: ConfigReason,
    },
) {}

const NonEmptyConfigString = Schema.String.check(
    Schema.isLengthBetween(1, 2048),
);
const ChallengeTtlSeconds = Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 30, maximum: 600 }),
);
const SessionTtlSeconds = Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 300, maximum: 31_536_000 }),
);

const AuthConfigBindingsSchema = Schema.Struct({
    AUTH_ENVIRONMENT: Schema.Literals([
        'development',
        'test',
        'preview',
        'production',
    ]),
    AUTH_RP_ID: NonEmptyConfigString,
    AUTH_ORIGIN: NonEmptyConfigString,
    AUTH_RP_NAME: NonEmptyConfigString,
    AUTH_CHALLENGE_TTL_SECONDS: ChallengeTtlSeconds,
    AUTH_SESSION_TTL_SECONDS: SessionTtlSeconds,
    TURNSTILE_SITE_KEY: NonEmptyConfigString,
    TURNSTILE_SECRET_KEY: NonEmptyConfigString,
});

const decodeBindings = Schema.decodeUnknownEffect(AuthConfigBindingsSchema, {
    onExcessProperty: 'ignore',
});

const configError = (
    field: typeof ConfigField.Type,
    reason: typeof ConfigReason.Type,
) => new AuthConfigError({ field, reason });

const requireCanonicalValue = (
    field:
        | 'AUTH_RP_ID'
        | 'AUTH_RP_NAME'
        | 'TURNSTILE_SITE_KEY'
        | 'TURNSTILE_SECRET_KEY',
    value: string,
) =>
    value.trim() === value
        ? Effect.succeed(value)
        : Effect.fail(configError(field, 'invalid'));

const parseExactOrigin = (value: string) =>
    Effect.try({
        try: () => new URL(value),
        catch: () => configError('AUTH_ORIGIN', 'invalid'),
    }).pipe(
        Effect.filterOrFail(
            (url) =>
                url.origin === value &&
                url.username === '' &&
                url.password === '' &&
                url.pathname === '/' &&
                url.search === '' &&
                url.hash === '',
            () => configError('AUTH_ORIGIN', 'not_canonical'),
        ),
    );

const cookieName = (
    environment: AuthEnvironment,
    secure: boolean,
    purpose: 'session' | 'csrf',
) => {
    const environmentPart =
        environment === 'production' ? '' : `-${environment}`;
    const prefix = secure ? '__Host-' : '';

    return `${prefix}larafeed${environmentPart}-${purpose}`;
};

export const parseAuthConfig = Effect.fn('auth.config.parse')(function* (
    input: AuthConfigBindings,
) {
    const bindings = yield* decodeBindings(input).pipe(
        Effect.mapError(() => configError('bindings', 'invalid')),
    );

    const rpId = yield* requireCanonicalValue(
        'AUTH_RP_ID',
        bindings.AUTH_RP_ID,
    );
    const rpName = yield* requireCanonicalValue(
        'AUTH_RP_NAME',
        bindings.AUTH_RP_NAME,
    );
    const turnstileSiteKey = yield* requireCanonicalValue(
        'TURNSTILE_SITE_KEY',
        bindings.TURNSTILE_SITE_KEY,
    );
    const turnstileSecretKey = yield* requireCanonicalValue(
        'TURNSTILE_SECRET_KEY',
        bindings.TURNSTILE_SECRET_KEY,
    );
    const origin = yield* parseExactOrigin(bindings.AUTH_ORIGIN);

    if (origin.hostname !== rpId) {
        return yield* Effect.fail(
            configError('AUTH_ORIGIN', 'rp_origin_mismatch'),
        );
    }

    if (
        bindings.AUTH_ENVIRONMENT !== 'development' &&
        origin.protocol !== 'https:'
    ) {
        return yield* Effect.fail(
            configError('AUTH_ORIGIN', 'insecure_origin'),
        );
    }

    if (
        bindings.AUTH_ENVIRONMENT === 'development' &&
        origin.protocol === 'http:' &&
        origin.hostname !== 'localhost' &&
        origin.hostname !== '127.0.0.1' &&
        origin.hostname !== '[::1]'
    ) {
        return yield* Effect.fail(
            configError('AUTH_ORIGIN', 'insecure_origin'),
        );
    }

    if (
        bindings.AUTH_ENVIRONMENT === 'production' &&
        (rpId !== PRODUCTION_RP_ID || origin.origin !== PRODUCTION_ORIGIN)
    ) {
        return yield* Effect.fail(
            configError('AUTH_ORIGIN', 'production_identity_mismatch'),
        );
    }

    const secure = origin.protocol === 'https:';
    const cookieBase = {
        secure,
        sameSite: 'Lax',
        path: '/',
    } as const;

    return {
        environment: bindings.AUTH_ENVIRONMENT,
        rpId,
        origin: origin.origin,
        rpName,
        challengeTtlMs: bindings.AUTH_CHALLENGE_TTL_SECONDS * 1_000,
        sessionTtlMs: bindings.AUTH_SESSION_TTL_SECONDS * 1_000,
        turnstileSiteKey,
        turnstileSecretKey,
        sessionCookie: {
            ...cookieBase,
            name: cookieName(bindings.AUTH_ENVIRONMENT, secure, 'session'),
            httpOnly: true,
        },
        csrfCookie: {
            ...cookieBase,
            name: cookieName(bindings.AUTH_ENVIRONMENT, secure, 'csrf'),
            httpOnly: false,
        },
    } satisfies AuthConfig;
});

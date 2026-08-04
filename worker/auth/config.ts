import { Effect, Schema } from 'effect';

export type AuthEnvironment = 'development' | 'test' | 'preview' | 'production';

export interface AuthConfigBindings {
    readonly AUTH_ENVIRONMENT: string;
    readonly AUTH_ORIGIN: string;
    readonly AUTH_RP_NAME: string;
    readonly AUTH_CHALLENGE_TTL_SECONDS: string;
    readonly AUTH_SESSION_TTL_SECONDS: string;
    readonly TURNSTILE_ENABLED?: string;
    readonly TURNSTILE_SITE_KEY?: string;
    readonly TURNSTILE_SECRET_KEY?: string;
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
    readonly turnstileSiteKey: string | null;
    readonly turnstileSecretKey: string | null;
    readonly sessionCookie: AuthCookieConfig;
    readonly csrfCookie: AuthCookieConfig;
}

const ConfigField = Schema.Literals([
    'bindings',
    'AUTH_ORIGIN',
    'AUTH_RP_NAME',
    'TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
]);

const ConfigReason = Schema.Literals([
    'invalid',
    'not_canonical',
    'insecure_origin',
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
    AUTH_ORIGIN: NonEmptyConfigString,
    AUTH_RP_NAME: NonEmptyConfigString,
    AUTH_CHALLENGE_TTL_SECONDS: ChallengeTtlSeconds,
    AUTH_SESSION_TTL_SECONDS: SessionTtlSeconds,
    TURNSTILE_ENABLED: Schema.optionalKey(Schema.Literals(['true', 'false'])),
    TURNSTILE_SITE_KEY: Schema.optionalKey(NonEmptyConfigString),
    TURNSTILE_SECRET_KEY: Schema.optionalKey(NonEmptyConfigString),
});

const decodeBindings = Schema.decodeUnknownEffect(AuthConfigBindingsSchema, {
    onExcessProperty: 'ignore',
});

const configError = (
    field: typeof ConfigField.Type,
    reason: typeof ConfigReason.Type,
) => new AuthConfigError({ field, reason });

const requireCanonicalValue = (
    field: 'AUTH_RP_NAME' | 'TURNSTILE_SITE_KEY' | 'TURNSTILE_SECRET_KEY',
    value: string,
) =>
    value.length > 0 && value.trim() === value
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

    const rpName = yield* requireCanonicalValue(
        'AUTH_RP_NAME',
        bindings.AUTH_RP_NAME,
    );
    const turnstileEnabled = bindings.TURNSTILE_ENABLED === 'true';
    const turnstileSiteKey = turnstileEnabled
        ? yield* requireCanonicalValue(
              'TURNSTILE_SITE_KEY',
              bindings.TURNSTILE_SITE_KEY ?? '',
          )
        : null;
    const turnstileSecretKey = turnstileEnabled
        ? yield* requireCanonicalValue(
              'TURNSTILE_SECRET_KEY',
              bindings.TURNSTILE_SECRET_KEY ?? '',
          )
        : null;
    const origin = yield* parseExactOrigin(bindings.AUTH_ORIGIN);
    const rpId = origin.hostname;

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

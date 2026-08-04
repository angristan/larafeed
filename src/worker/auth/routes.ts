import {
    AccessLinkResponse,
    AccessRegistrationOptionsRequest,
    AccessRegistrationVerifyRequest,
    type ApiErrorCode,
    ApiErrorResponse,
    AppTokenListResponse,
    AuthConfigResponse,
    AuthenticatedSessionResponse,
    AuthenticationOptionsRequest,
    AuthenticationOptionsResponse,
    AuthenticationVerifyRequest,
    CreateAppTokenRequest,
    CreatedAppTokenResponse,
    CreateEnrollmentLinkRequest,
    CreateRecoveryLinkRequest,
    PasskeyListResponse,
    PasskeyRegistrationOptionsRequest,
    PasskeyRegistrationVerifyRequest,
    PasskeyResponse,
    RegistrationOptionsResponse,
    UnauthenticatedSessionResponse,
} from '@shared/http';
import { Cause, Effect, Schema } from 'effect';
import type { Hono } from 'hono';
import { generateCookie, getCookie } from 'hono/cookie';

import { type D1, makeD1 } from '../infrastructure/d1';
import { type AuthConfig, parseAuthConfig } from './config';
import {
    type AuthRateLimited,
    AuthValidationError,
    CsrfInvalid,
} from './errors';
import { type AuthOperator, makeAuthOperator } from './operator';
import { makeAuthRepository } from './repository';
import {
    type AuthenticatedSession,
    type AuthService,
    type CookieValue,
    makeAuthService,
} from './service';
import { makeTurnstileValidator } from './turnstile';
import { makeWebAuthn } from './webauthn';

const NO_STORE_HEADERS = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;

const SafePathId = Schema.NumberFromString.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);

const EmptyJsonObject = Schema.Struct({});
const OperatorAccessRequest = Schema.Union([
    Schema.Struct({
        mode: Schema.Literal('initial-admin'),
        username: Schema.String.check(
            Schema.isTrimmed(),
            Schema.isLengthBetween(1, 100),
        ),
        email: Schema.String.check(
            Schema.isTrimmed(),
            Schema.isLengthBetween(1, 320),
        ),
        displayName: Schema.String.check(
            Schema.isTrimmed(),
            Schema.isLengthBetween(1, 200),
        ),
    }),
    Schema.Struct({
        mode: Schema.Literal('recover-admin'),
        userId: Schema.Int.check(
            Schema.isBetween({
                minimum: 1,
                maximum: Number.MAX_SAFE_INTEGER,
            }),
        ),
    }),
]);

export interface AuthRuntime {
    readonly config: AuthConfig;
    readonly service: AuthService;
    readonly operator?: AuthOperator;
}

export type AuthRuntimeFactory = (
    env: Env,
) => Effect.Effect<AuthRuntime, unknown>;

export type PublicCeremonyRoute =
    | 'authenticationOptions'
    | 'authenticationVerify'
    | 'accessRegistrationOptions'
    | 'accessRegistrationVerify';

export interface PublicCeremonyCheckInput {
    readonly route: PublicCeremonyRoute;
    readonly remoteIp?: string;
}

export interface AuthRouteDependencies {
    readonly runtimeFactory?: AuthRuntimeFactory;
    /** Seam for a later Workers Rate Limiting binding. */
    readonly checkPublicCeremony?: (
        input: PublicCeremonyCheckInput,
    ) => Effect.Effect<void, AuthRateLimited>;
}

export const makeDefaultAuthRuntime = (env: Env, d1: D1) =>
    parseAuthConfig(env).pipe(
        Effect.map((config) => {
            const repository = makeAuthRepository(d1);
            const webAuthn = makeWebAuthn();
            const turnstile =
                config.turnstileSecretKey === null
                    ? undefined
                    : makeTurnstileValidator({
                          secretKey: config.turnstileSecretKey,
                          expectedHostname: config.rpId,
                      });

            return {
                config,
                service: makeAuthService({
                    repository,
                    webAuthn,
                    ...(turnstile === undefined ? {} : { turnstile }),
                    config,
                }),
                operator: makeAuthOperator({
                    d1,
                    config,
                    operatorSecret: env.AUTH_OPERATOR_SECRET,
                }),
            };
        }),
    );

export const defaultAuthRuntimeFactory: AuthRuntimeFactory = (env) =>
    makeDefaultAuthRuntime(env, makeD1(env.DB));

const appendCookie = (headers: Headers, cookie: CookieValue): void => {
    headers.append(
        'set-cookie',
        generateCookie(cookie.name, cookie.value, {
            expires: new Date(cookie.expiresAt),
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            sameSite: cookie.sameSite,
            path: cookie.path,
        }),
    );
};

const responseHeaders = (cookies: readonly CookieValue[] = []): Headers => {
    const headers = new Headers(NO_STORE_HEADERS);
    for (const cookie of cookies) {
        appendCookie(headers, cookie);
    }
    return headers;
};

const jsonResponse = (
    schema: Schema.ConstraintCodec<unknown>,
    value: unknown,
    status = 200,
    cookies: readonly CookieValue[] = [],
): Effect.Effect<Response, unknown> =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.flatMap((decoded) =>
            Schema.encodeUnknownEffect(schema)(decoded),
        ),
        Effect.map(
            (encoded) =>
                new Response(JSON.stringify(encoded), {
                    status,
                    headers: responseHeaders(cookies),
                }),
        ),
    );

const noContentResponse = (cookies: readonly CookieValue[] = []): Response => {
    const headers = responseHeaders(cookies);
    headers.delete('content-type');
    return new Response(null, { status: 204, headers });
};

interface SafeError {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly status: number;
}

const taggedError = (error: unknown): string | undefined => {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }
    const tag = Reflect.get(error, '_tag');
    return typeof tag === 'string' ? tag : undefined;
};

const safeError = (error: unknown): SafeError => {
    switch (taggedError(error)) {
        case 'AuthValidationError':
            return {
                code: 'validation_error',
                message: 'Invalid request',
                status: 400,
            };
        case 'AuthenticationFailed':
            return {
                code: 'authentication_failed',
                message: 'Authentication failed',
                status: 401,
            };
        case 'Unauthenticated':
            return {
                code: 'unauthenticated',
                message: 'Authentication required',
                status: 401,
            };
        case 'Forbidden':
            return {
                code: 'forbidden',
                message: 'Forbidden',
                status: 403,
            };
        case 'CsrfInvalid':
            return {
                code: 'csrf_invalid',
                message: 'Request verification failed',
                status: 403,
            };
        case 'TurnstileInputError':
        case 'TurnstileRejectedError':
            return {
                code: 'human_verification_failed',
                message: 'Human verification failed',
                status: 400,
            };
        case 'AccessLinkInvalid':
            return {
                code: 'access_link_invalid',
                message: 'Access link is invalid or expired',
                status: 400,
            };
        case 'AuthNotFound':
            return { code: 'not_found', message: 'Not found', status: 404 };
        case 'AuthConflict':
            return { code: 'conflict', message: 'Conflict', status: 409 };
        case 'AuthRateLimited':
            return {
                code: 'rate_limited',
                message: 'Too many requests',
                status: 429,
            };
        case 'TurnstileRequestError':
        case 'TurnstileResponseError':
        case 'AuthStorageError':
            return {
                code: 'service_unavailable',
                message: 'Service unavailable',
                status: 503,
            };
        default:
            return {
                code: 'internal_server_error',
                message: 'Internal server error',
                status: 500,
            };
    }
};

const apiErrorResponse = (error: unknown): Response => {
    const safe = safeError(error);
    try {
        const encoded = Schema.encodeUnknownSync(ApiErrorResponse)(
            ApiErrorResponse.make({
                error: { code: safe.code, message: safe.message },
            }),
        );
        return new Response(JSON.stringify(encoded), {
            status: safe.status,
            headers: responseHeaders(),
        });
    } catch {
        return new Response(
            '{"error":{"code":"internal_server_error","message":"Internal server error"}}',
            { status: 500, headers: responseHeaders() },
        );
    }
};

const runRoute = (
    request: Request,
    program: Effect.Effect<Response, unknown>,
): Promise<Response> =>
    Effect.runPromise(
        program.pipe(
            Effect.catchCause((cause) =>
                Effect.succeed(apiErrorResponse(Cause.squash(cause))),
            ),
        ),
        { signal: request.signal },
    );

const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
    request: Request,
    schema: S,
): Effect.Effect<S['Type'], AuthValidationError> =>
    Effect.tryPromise({
        try: async () => {
            const body: unknown = await request.json();
            return body;
        },
        catch: () => new AuthValidationError(),
    }).pipe(
        Effect.flatMap((body) =>
            Schema.decodeUnknownEffect(schema, {
                onExcessProperty: 'error',
            })(body).pipe(Effect.mapError(() => new AuthValidationError())),
        ),
    );

const decodePathId = (
    value: string,
): Effect.Effect<number, AuthValidationError> =>
    Schema.decodeUnknownEffect(SafePathId)(value).pipe(
        Effect.mapError(() => new AuthValidationError()),
    );

const mediaType = (contentType: string | undefined): string | undefined =>
    contentType?.split(';', 1)[0]?.trim().toLowerCase();

const remoteIp = (request: Request): string | undefined =>
    request.headers.get('CF-Connecting-IP') ?? undefined;

const requirePublicPost = (
    runtime: AuthRuntime,
    request: Request,
    route: PublicCeremonyRoute,
    checkPublicCeremony: NonNullable<
        AuthRouteDependencies['checkPublicCeremony']
    >,
): Effect.Effect<void, CsrfInvalid | AuthRateLimited> => {
    if (
        request.headers.get('Origin') !== runtime.config.origin ||
        mediaType(request.headers.get('Content-Type') ?? undefined) !==
            'application/json'
    ) {
        return Effect.fail(new CsrfInvalid());
    }

    const connectingIp = remoteIp(request);
    return checkPublicCeremony({
        route,
        ...(connectingIp === undefined ? {} : { remoteIp: connectingIp }),
    }).pipe(Effect.mapError((error): CsrfInvalid | AuthRateLimited => error));
};

const sessionToken = (
    context: Parameters<typeof getCookie>[0],
    runtime: AuthRuntime,
) => getCookie(context, runtime.config.sessionCookie.name);

const authenticatedMutation = <A, E>(
    context: Parameters<typeof getCookie>[0],
    runtime: AuthRuntime,
    operation: (session: AuthenticatedSession) => Effect.Effect<A, E>,
) => {
    const token = sessionToken(context, runtime);
    return runtime.service.authenticateSession(token).pipe(
        Effect.tap((session) =>
            runtime.service.authorizeMutation(session, {
                method: context.req.raw.method,
                origin: context.req.raw.headers.get('Origin') ?? undefined,
                contentType:
                    context.req.raw.headers.get('Content-Type') ?? undefined,
                csrfCookieToken: getCookie(
                    context,
                    runtime.config.csrfCookie.name,
                ),
                csrfHeaderToken:
                    context.req.raw.headers.get('X-CSRF-Token') ?? undefined,
            }),
        ),
        Effect.flatMap(operation),
    );
};

const authenticatedBodyMutation = <
    S extends Schema.ConstraintDecoder<unknown>,
    A,
    E,
>(
    context: Parameters<typeof getCookie>[0],
    runtime: AuthRuntime,
    schema: S,
    operation: (
        session: AuthenticatedSession,
        body: S['Type'],
    ) => Effect.Effect<A, E>,
) =>
    authenticatedMutation(context, runtime, (session) =>
        decodeJson(context.req.raw, schema).pipe(
            Effect.flatMap((body) => operation(session, body)),
        ),
    );

const authenticationSessionBody = (result: {
    readonly user: AuthenticatedSession['user'];
    readonly expiresAt: number;
}) => ({
    authenticated: true as const,
    user: result.user,
    expiresAt: result.expiresAt,
});

export const registerAuthRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: AuthRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const runtimeFactory =
        dependencies.runtimeFactory ?? defaultAuthRuntimeFactory;
    const checkPublicCeremony =
        dependencies.checkPublicCeremony ?? (() => Effect.void);
    const runtime = (env: Env) => Effect.suspend(() => runtimeFactory(env));

    app.get('/api/auth/config', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap(({ config }) =>
                    jsonResponse(
                        AuthConfigResponse,
                        AuthConfigResponse.make({
                            turnstileSiteKey: config.turnstileSiteKey,
                        }),
                    ),
                ),
            ),
        ),
    );

    app.get('/api/auth/session', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authRuntime.service
                        .authenticateSession(sessionToken(context, authRuntime))
                        .pipe(
                            Effect.flatMap((session) =>
                                jsonResponse(
                                    AuthenticatedSessionResponse,
                                    authenticationSessionBody(session),
                                ),
                            ),
                            Effect.catchIf(
                                (error) =>
                                    taggedError(error) === 'Unauthenticated',
                                () =>
                                    jsonResponse(
                                        UnauthenticatedSessionResponse,
                                        UnauthenticatedSessionResponse.make({
                                            authenticated: false,
                                        }),
                                    ),
                            ),
                        ),
                ),
            ),
        ),
    );

    app.post('/api/auth/authentication/options', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.tap((authRuntime) =>
                    requirePublicPost(
                        authRuntime,
                        context.req.raw,
                        'authenticationOptions',
                        checkPublicCeremony,
                    ),
                ),
                Effect.flatMap((authRuntime) =>
                    decodeJson(
                        context.req.raw,
                        AuthenticationOptionsRequest,
                    ).pipe(
                        Effect.flatMap((body) =>
                            authRuntime.service.authenticationOptions({
                                ...body,
                                remoteIp: remoteIp(context.req.raw),
                            }),
                        ),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(AuthenticationOptionsResponse, body),
                ),
            ),
        ),
    );

    app.post('/api/auth/authentication/verify', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.tap((authRuntime) =>
                    requirePublicPost(
                        authRuntime,
                        context.req.raw,
                        'authenticationVerify',
                        checkPublicCeremony,
                    ),
                ),
                Effect.flatMap((authRuntime) =>
                    decodeJson(
                        context.req.raw,
                        AuthenticationVerifyRequest,
                    ).pipe(
                        Effect.flatMap((body) =>
                            authRuntime.service.verifyAuthentication({
                                ...body,
                                remoteIp: remoteIp(context.req.raw),
                            }),
                        ),
                    ),
                ),
                Effect.flatMap((result) =>
                    jsonResponse(
                        AuthenticatedSessionResponse,
                        authenticationSessionBody(result),
                        200,
                        [result.cookies.session, result.cookies.csrf],
                    ),
                ),
            ),
        ),
    );

    app.post('/api/auth/access/registration/options', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.tap((authRuntime) =>
                    requirePublicPost(
                        authRuntime,
                        context.req.raw,
                        'accessRegistrationOptions',
                        checkPublicCeremony,
                    ),
                ),
                Effect.flatMap((authRuntime) =>
                    decodeJson(
                        context.req.raw,
                        AccessRegistrationOptionsRequest,
                    ).pipe(
                        Effect.flatMap((body) =>
                            authRuntime.service.accessRegistrationOptions({
                                ...body,
                                remoteIp: remoteIp(context.req.raw),
                            }),
                        ),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(RegistrationOptionsResponse, body),
                ),
            ),
        ),
    );

    app.post('/api/auth/access/registration/verify', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.tap((authRuntime) =>
                    requirePublicPost(
                        authRuntime,
                        context.req.raw,
                        'accessRegistrationVerify',
                        checkPublicCeremony,
                    ),
                ),
                Effect.flatMap((authRuntime) =>
                    decodeJson(
                        context.req.raw,
                        AccessRegistrationVerifyRequest,
                    ).pipe(
                        Effect.flatMap((body) =>
                            authRuntime.service.accessRegistrationVerify({
                                ...body,
                                remoteIp: remoteIp(context.req.raw),
                            }),
                        ),
                    ),
                ),
                Effect.flatMap((result) =>
                    jsonResponse(
                        AuthenticatedSessionResponse,
                        authenticationSessionBody(result),
                        200,
                        [result.cookies.session, result.cookies.csrf],
                    ),
                ),
            ),
        ),
    );

    app.post('/api/auth/logout', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authenticatedMutation(context, authRuntime, () =>
                        decodeJson(context.req.raw, EmptyJsonObject).pipe(
                            Effect.flatMap(() =>
                                authRuntime.service.revokeSession(
                                    sessionToken(context, authRuntime),
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.map((cookies) =>
                    noContentResponse([cookies.session, cookies.csrf]),
                ),
            ),
        ),
    );

    app.get('/api/auth/passkeys', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authRuntime.service
                        .authenticateSession(sessionToken(context, authRuntime))
                        .pipe(
                            Effect.flatMap((session) =>
                                authRuntime.service.listPasskeys(session),
                            ),
                        ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(PasskeyListResponse, body),
                ),
            ),
        ),
    );

    app.post('/api/auth/passkeys/registration/options', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authenticatedBodyMutation(
                        context,
                        authRuntime,
                        PasskeyRegistrationOptionsRequest,
                        (session, body) =>
                            authRuntime.service.passkeyRegistrationOptions(
                                session,
                                {
                                    ...body,
                                    remoteIp: remoteIp(context.req.raw),
                                },
                            ),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(RegistrationOptionsResponse, body),
                ),
            ),
        ),
    );

    app.post('/api/auth/passkeys/registration/verify', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authenticatedBodyMutation(
                        context,
                        authRuntime,
                        PasskeyRegistrationVerifyRequest,
                        (session, body) =>
                            authRuntime.service.passkeyRegistrationVerify(
                                session,
                                {
                                    ...body,
                                    remoteIp: remoteIp(context.req.raw),
                                },
                            ),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(PasskeyResponse, body, 201),
                ),
            ),
        ),
    );

    app.delete('/api/auth/passkeys/:id', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authenticatedMutation(context, authRuntime, (session) =>
                        decodePathId(context.req.param('id')).pipe(
                            Effect.flatMap((passkeyId) =>
                                authRuntime.service.deletePasskey(
                                    session,
                                    passkeyId,
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.as(noContentResponse()),
            ),
        ),
    );

    app.post('/api/auth/admin/enrollment-links', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authenticatedBodyMutation(
                        context,
                        authRuntime,
                        CreateEnrollmentLinkRequest,
                        (session, body) =>
                            authRuntime.service.createEnrollmentLink(
                                session,
                                body,
                            ),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(AccessLinkResponse, body, 201),
                ),
            ),
        ),
    );

    app.post('/api/auth/admin/users/:id/recovery-links', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authenticatedBodyMutation(
                        context,
                        authRuntime,
                        CreateRecoveryLinkRequest,
                        (session) =>
                            decodePathId(context.req.param('id')).pipe(
                                Effect.flatMap((userId) =>
                                    authRuntime.service.createRecoveryLink(
                                        session,
                                        userId,
                                    ),
                                ),
                            ),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(AccessLinkResponse, body, 201),
                ),
            ),
        ),
    );

    app.delete('/api/auth/admin/access-links/:id', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authenticatedMutation(context, authRuntime, (session) =>
                        decodePathId(context.req.param('id')).pipe(
                            Effect.flatMap((linkId) =>
                                authRuntime.service.revokeAccessLink(
                                    session,
                                    linkId,
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.as(noContentResponse()),
            ),
        ),
    );

    app.get('/api/auth/app-tokens', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authRuntime.service
                        .authenticateSession(sessionToken(context, authRuntime))
                        .pipe(
                            Effect.flatMap((session) =>
                                authRuntime.service.listAppTokens(session),
                            ),
                        ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(AppTokenListResponse, body),
                ),
            ),
        ),
    );

    app.post('/api/auth/app-tokens', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authenticatedBodyMutation(
                        context,
                        authRuntime,
                        CreateAppTokenRequest,
                        (session, body) =>
                            authRuntime.service.createAppToken(session, body),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(CreatedAppTokenResponse, body, 201),
                ),
            ),
        ),
    );

    app.delete('/api/auth/app-tokens/:id', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) =>
                    authenticatedMutation(context, authRuntime, (session) =>
                        decodePathId(context.req.param('id')).pipe(
                            Effect.flatMap((tokenId) =>
                                authRuntime.service.revokeAppToken(
                                    session,
                                    tokenId,
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.as(noContentResponse()),
            ),
        ),
    );

    app.post('/api/auth/operator/access-link', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((authRuntime) => {
                    if (
                        mediaType(
                            context.req.raw.headers.get('Content-Type') ??
                                undefined,
                        ) !== 'application/json' ||
                        authRuntime.operator === undefined
                    ) {
                        return Effect.fail(new AuthValidationError());
                    }

                    return decodeJson(
                        context.req.raw,
                        OperatorAccessRequest,
                    ).pipe(
                        Effect.flatMap(
                            (body) =>
                                authRuntime.operator?.createAccessLink(
                                    context.req.raw.headers.get(
                                        'Authorization',
                                    ) ?? undefined,
                                    body,
                                ) ?? Effect.fail(new AuthValidationError()),
                        ),
                    );
                }),
                Effect.flatMap((body) =>
                    jsonResponse(AccessLinkResponse, body, 201),
                ),
            ),
        ),
    );

    return app;
};

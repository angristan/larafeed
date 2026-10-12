import { createMcpHandler } from '@modelcontextprotocol/server';
import {
    ApiErrorResponse,
    McpSettingsResponse,
    UpdateMcpSettingsRequest,
} from '@shared/http';
import { Effect, Schema } from 'effect';
import type { Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { generateSafeId } from '../auth/crypto';
import { type AuthRuntime, makeDefaultAuthRuntime } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { recoverHttpCause } from '../http/failures';
import {
    isRequestBodyTooLarge,
    type RequestBodyError,
    readBoundedJsonBody,
} from '../http/request-body';
import { makeD1 } from '../infrastructure/d1';
import { safeErrorClass } from '../observability';
import { makeReaderRepository } from '../reader/repository';
import { makeReaderService } from '../reader/service';
import { defaultSubscriptionRuntimeFactory } from '../subscriptions/routes';
import { handleAuthorizeGet, handleAuthorizePost } from './authorize';
import { McpNotFound, McpValidationError } from './errors';
import {
    listConnectedClients,
    revokeAllConnectedClients,
    revokeConnectedClient,
} from './grants';
import {
    AUTHORIZE_PATH,
    MCP_PATH,
    type McpOAuth,
    type McpResourceContext,
    makeMcpOAuth,
    REGISTER_PATH,
    TOKEN_PATH,
} from './oauth';
import { type McpRepository, makeMcpRepository } from './repository';
import { type McpToolServices, makeMcpServer } from './server';

type McpContext = Context<{ Bindings: Env }>;

const NO_STORE_HEADERS = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;
const MAX_JSON_BODY_BYTES = 1_024;
const GRANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

export interface McpRuntime {
    readonly auth: AuthRuntime;
    readonly repository: McpRepository;
    readonly oauth: McpOAuth;
    readonly now: () => number;
    readonly safeId: () => Effect.Effect<number, unknown>;
}

export type McpRuntimeFactory = (
    env: Env,
) => Effect.Effect<McpRuntime, unknown>;

export type McpToolServicesFactory = (
    env: Env,
) => Effect.Effect<McpToolServices, unknown>;

export interface McpRouteDependencies {
    readonly runtimeFactory?: McpRuntimeFactory;
}

export const defaultMcpToolServices: McpToolServicesFactory = (env) =>
    defaultSubscriptionRuntimeFactory(env).pipe(
        Effect.map((subscriptions) => ({
            reader: makeReaderService({
                repository: makeReaderRepository(makeD1(env.DB)),
                // Proxied image URLs are relative to Larafeed and need a
                // session, so MCP clients get the publisher's URLs.
                proxyImages: false,
            }),
            subscriptions: subscriptions.service,
            limitFeedAdd: subscriptions.limitFeedAdd,
        })),
    );

const hasMcpAccess = (env: Env, userId: number): Promise<boolean> =>
    Effect.runPromise(
        makeMcpRepository(makeD1(env.DB))
            .getAccess(userId)
            .pipe(Effect.map((access) => access.enabled)),
    );

/** Serves one authenticated MCP request with a fresh, stateless server. */
export const makeMcpRequestHandler =
    (toolServices: McpToolServicesFactory) =>
    async (
        request: Request,
        env: Env,
        ctx: McpResourceContext,
    ): Promise<Response> => {
        const services = await Effect.runPromise(toolServices(env));
        const handler = createMcpHandler(
            () => makeMcpServer(services, ctx.props.userId),
            {
                // Tools return one result and never stream progress.
                responseMode: 'json',
                onerror: (error) => {
                    console.warn({
                        event: 'mcp.protocol.error',
                        errorClass: safeErrorClass(error),
                    });
                },
            },
        );
        const resourceMetadataUrl = new URL(
            `/.well-known/oauth-protected-resource${MCP_PATH}`,
            ctx.auth.audience,
        ).href;
        return handler.fetch(request, {
            authInfo: {
                token: ctx.auth.token,
                clientId: ctx.auth.clientId ?? '',
                scopes: ctx.auth.scope,
                ...(ctx.auth.expiresAt === undefined
                    ? {}
                    : { expiresAt: ctx.auth.expiresAt }),
                resource: new URL(ctx.auth.audience),
                resourceMetadataUrl,
            },
        });
    };

// The OAuth servers are pure configuration, so build them once per origin
// instead of on every request.
const oauthByOrigin = new Map<string, McpOAuth>();

const defaultOAuth = (origin: string): McpOAuth => {
    let oauth = oauthByOrigin.get(origin);
    if (oauth === undefined) {
        oauth = makeMcpOAuth({
            origin,
            hasAccess: hasMcpAccess,
            handleMcp: makeMcpRequestHandler(defaultMcpToolServices),
        });
        oauthByOrigin.set(origin, oauth);
    }
    return oauth;
};

export const defaultMcpRuntimeFactory: McpRuntimeFactory = (env) => {
    const d1 = makeD1(env.DB);
    return makeDefaultAuthRuntime(env, d1).pipe(
        Effect.map((auth) => ({
            auth,
            repository: makeMcpRepository(d1),
            oauth: defaultOAuth(auth.config.origin),
            now: Date.now,
            safeId: () => generateSafeId(),
        })),
    );
};

const taggedError = (error: unknown): string | undefined => {
    if (typeof error !== 'object' || error === null) return undefined;
    const tag = Reflect.get(error, '_tag');
    return typeof tag === 'string' ? tag : undefined;
};

const safeError = (
    error: unknown,
): {
    readonly code: typeof ApiErrorResponse.Type.error.code;
    readonly message: string;
    readonly status: number;
} => {
    if (isRequestBodyTooLarge(error)) {
        return {
            code: 'payload_too_large',
            message: 'Request body is too large',
            status: 413,
        };
    }
    switch (taggedError(error)) {
        case 'McpValidationError':
        case 'AuthValidationError':
            return {
                code: 'validation_error',
                message: 'Invalid request',
                status: 400,
            };
        case 'Unauthenticated':
            return {
                code: 'unauthenticated',
                message: 'Authentication required',
                status: 401,
            };
        case 'CsrfInvalid':
            return {
                code: 'csrf_invalid',
                message: 'Request verification failed',
                status: 403,
            };
        case 'McpNotFound':
            return { code: 'not_found', message: 'Not found', status: 404 };
        case 'McpStorageError':
        case 'McpGrantStoreError':
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
    return new Response(
        JSON.stringify(
            Schema.encodeUnknownSync(ApiErrorResponse)(
                ApiErrorResponse.make({
                    error: { code: safe.code, message: safe.message },
                }),
            ),
        ),
        { status: safe.status, headers: new Headers(NO_STORE_HEADERS) },
    );
};

const runRoute = (
    request: Request,
    program: Effect.Effect<Response, unknown>,
): Promise<Response> =>
    Effect.runPromise(
        program.pipe(
            Effect.catchCause((cause) =>
                recoverHttpCause(cause, apiErrorResponse),
            ),
        ),
        { signal: request.signal },
    );

const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
    request: Request,
    schema: S,
): Effect.Effect<S['Type'], McpValidationError | RequestBodyError> =>
    readBoundedJsonBody(request, MAX_JSON_BODY_BYTES).pipe(
        Effect.mapError((error) =>
            isRequestBodyTooLarge(error) ? error : new McpValidationError(),
        ),
        Effect.flatMap((body) =>
            Schema.decodeUnknownEffect(schema, {
                onExcessProperty: 'error',
            })(body).pipe(Effect.mapError(() => new McpValidationError())),
        ),
    );

const sessionToken = (context: McpContext, runtime: McpRuntime) =>
    getCookie(context, runtime.auth.config.sessionCookie.name);

const authenticated = <A, E>(
    context: McpContext,
    runtime: McpRuntime,
    operation: (session: AuthenticatedSession) => Effect.Effect<A, E>,
) =>
    runtime.auth.service
        .authenticateSession(sessionToken(context, runtime))
        .pipe(Effect.flatMap(operation));

const authenticatedMutation = <A, E>(
    context: McpContext,
    runtime: McpRuntime,
    operation: (session: AuthenticatedSession) => Effect.Effect<A, E>,
) =>
    authenticated(context, runtime, (session) =>
        runtime.auth.service
            .authorizeMutation(session, {
                method: context.req.raw.method,
                origin: context.req.raw.headers.get('Origin') ?? undefined,
                contentType:
                    context.req.raw.headers.get('Content-Type') ?? undefined,
                csrfCookieToken: getCookie(
                    context,
                    runtime.auth.config.csrfCookie.name,
                ),
                csrfHeaderToken:
                    context.req.raw.headers.get('X-CSRF-Token') ?? undefined,
            })
            .pipe(Effect.flatMap(() => operation(session))),
    );

const settingsResponse = (runtime: McpRuntime, env: Env, userId: number) =>
    Effect.gen(function* () {
        const access = yield* runtime.repository.getAccess(userId);
        const clients = access.enabled
            ? yield* listConnectedClients(
                  runtime.oauth.authorizationServer.getOAuthApi(env),
                  userId,
              )
            : [];
        const body = Schema.encodeUnknownSync(McpSettingsResponse)(
            McpSettingsResponse.make({
                enabled: access.enabled,
                endpointUrl: runtime.oauth.resource,
                clients,
            }),
        );
        return new Response(JSON.stringify(body), {
            headers: new Headers(NO_STORE_HEADERS),
        });
    });

const fallbackExecutionContext = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
} as unknown as ExecutionContext;

// Hono throws when a request has no execution context (direct `app.request`
// calls in tests). The OAuth library only uses it for `waitUntil`.
const executionContext = (context: McpContext): ExecutionContext => {
    try {
        return context.executionCtx as ExecutionContext;
    } catch {
        return fallbackExecutionContext;
    }
};

const serviceUnavailable = (): Response =>
    new Response(
        '{"error":"temporarily_unavailable","error_description":"Service unavailable"}',
        { status: 503, headers: new Headers(NO_STORE_HEADERS) },
    );

export const registerMcpRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: McpRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const runtimeFactory =
        dependencies.runtimeFactory ?? defaultMcpRuntimeFactory;
    const runtime = (env: Env) => Effect.suspend(() => runtimeFactory(env));
    const runtimeOrNull = (env: Env) =>
        Effect.runPromise(
            runtime(env).pipe(
                Effect.tapError((error) =>
                    Effect.sync(() =>
                        console.error({
                            event: 'mcp.runtime.unavailable',
                            errorClass: safeErrorClass(error),
                        }),
                    ),
                ),
                Effect.orElseSucceed(() => null),
            ),
        );

    // Protocol endpoints owned by the OAuth library: discovery metadata, the
    // MCP resource itself, token exchange, and dynamic client registration.
    const resourceRoute = async (context: McpContext) => {
        const value = await runtimeOrNull(context.env);
        if (value === null) return serviceUnavailable();
        return value.oauth.resourceServer.fetch(
            context.req.raw,
            context.env,
            executionContext(context),
        );
    };
    const authorizationServerRoute = async (context: McpContext) => {
        const value = await runtimeOrNull(context.env);
        if (value === null) return serviceUnavailable();
        return value.oauth.authorizationServer.fetch(
            context.req.raw,
            context.env,
            executionContext(context),
        );
    };

    app.all(MCP_PATH, resourceRoute);
    app.all('/.well-known/oauth-protected-resource', resourceRoute);
    app.all('/.well-known/oauth-protected-resource/*', resourceRoute);
    app.all(
        '/.well-known/oauth-authorization-server',
        authorizationServerRoute,
    );
    app.all(
        '/.well-known/oauth-authorization-server/*',
        authorizationServerRoute,
    );
    app.all(TOKEN_PATH, authorizationServerRoute);
    app.all(REGISTER_PATH, async (context) => {
        if (context.req.method === 'POST') {
            // Registration writes to KV and needs no account, so bound it per
            // client IP like the public passkey ceremonies.
            const outcome = await context.env.AUTH_RATE_LIMITER.limit({
                key: `oauth-register:${context.req.header('CF-Connecting-IP') ?? 'local'}`,
            });
            if (!outcome.success) {
                return new Response(
                    '{"error":"too_many_requests","error_description":"Too many requests"}',
                    {
                        status: 429,
                        headers: {
                            ...NO_STORE_HEADERS,
                            'retry-after': '60',
                        },
                    },
                );
            }
        }
        return authorizationServerRoute(context);
    });

    const authorizeDependencies = (context: McpContext, value: McpRuntime) => ({
        oauth: value.oauth.authorizationServer.getOAuthApi(context.env),
        origin: value.auth.config.origin,
        authenticate: () =>
            Effect.runPromise(
                value.auth.service
                    .authenticateSession(sessionToken(context, value))
                    .pipe(
                        Effect.map(
                            (session): AuthenticatedSession | null => session,
                        ),
                        Effect.catchTag('Unauthenticated', () =>
                            Effect.succeed(null),
                        ),
                    ),
            ),
        hasAccess: (userId: number) =>
            Effect.runPromise(
                value.repository
                    .getAccess(userId)
                    .pipe(Effect.map((access) => access.enabled)),
            ),
        recordAuthorized: (userId: number, clientId: string) =>
            Effect.runPromise(
                value.safeId().pipe(
                    Effect.flatMap((eventId) =>
                        value.repository.recordClientEvent({
                            userId,
                            kind: 'mcp.client.authorized',
                            clientId,
                            eventId,
                            now: value.now(),
                        }),
                    ),
                    // The grant already exists; a missing audit row must not
                    // fail the user's connection.
                    Effect.catch((error) =>
                        Effect.sync(() =>
                            console.error({
                                event: 'mcp.audit.failed',
                                errorClass: safeErrorClass(error),
                            }),
                        ),
                    ),
                ),
            ),
    });

    app.get(AUTHORIZE_PATH, async (context) => {
        const value = await runtimeOrNull(context.env);
        if (value === null) return serviceUnavailable();
        return handleAuthorizeGet(
            context.req.raw,
            authorizeDependencies(context, value),
        );
    });
    app.post(AUTHORIZE_PATH, async (context) => {
        const value = await runtimeOrNull(context.env);
        if (value === null) return serviceUnavailable();
        return handleAuthorizePost(
            context.req.raw,
            authorizeDependencies(context, value),
        );
    });

    // Settings API used by the React app.
    app.get('/api/mcp', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticated(context, value, (session) =>
                        settingsResponse(value, context.env, session.user.id),
                    ),
                ),
            ),
        ),
    );

    app.put('/api/mcp', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticatedMutation(context, value, (session) =>
                        Effect.gen(function* () {
                            const input = yield* decodeJson(
                                context.req.raw,
                                UpdateMcpSettingsRequest,
                            );
                            const userId = session.user.id;
                            yield* value.repository.setEnabled({
                                userId,
                                enabled: input.enabled,
                                eventId: yield* value.safeId(),
                                now: value.now(),
                            });
                            if (!input.enabled) {
                                // The D1 flag already blocks every token.
                                // Revoking the grants also deletes the stored
                                // refresh tokens, so turning MCP on later does
                                // not revive old connections.
                                yield* revokeAllConnectedClients(
                                    value.oauth.authorizationServer.getOAuthApi(
                                        context.env,
                                    ),
                                    userId,
                                );
                            }
                            return yield* settingsResponse(
                                value,
                                context.env,
                                userId,
                            );
                        }),
                    ),
                ),
            ),
        ),
    );

    app.delete('/api/mcp/clients/:grantId', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticatedMutation(context, value, (session) =>
                        Effect.gen(function* () {
                            const grantId = context.req.param('grantId');
                            if (!GRANT_ID_PATTERN.test(grantId)) {
                                return yield* new McpValidationError();
                            }
                            const userId = session.user.id;
                            const clientId = yield* revokeConnectedClient(
                                value.oauth.authorizationServer.getOAuthApi(
                                    context.env,
                                ),
                                userId,
                                grantId,
                            );
                            if (clientId === null) {
                                return yield* new McpNotFound();
                            }
                            yield* value.repository.recordClientEvent({
                                userId,
                                kind: 'mcp.client.revoked',
                                clientId,
                                eventId: yield* value.safeId(),
                                now: value.now(),
                            });
                            return yield* settingsResponse(
                                value,
                                context.env,
                                userId,
                            );
                        }),
                    ),
                ),
            ),
        ),
    );

    return app;
};

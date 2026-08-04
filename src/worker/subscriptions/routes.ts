import {
    ApiErrorResponse,
    CategoryMutationResponse,
    CreateCategoryRequest,
    CreateSubscriptionRequest,
    CreateSubscriptionResponse,
    DeleteResourceResponse,
    SubscriptionManagementResponse,
    SubscriptionMutationResponse,
    UpdateCategoryRequest,
    UpdateSubscriptionRequest,
} from '@shared/http';
import { Cause, Effect, Schema } from 'effect';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, makeDefaultAuthRuntime } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { makeFeedRefreshService } from '../feeds';
import { makeD1 } from '../infrastructure/d1';
import { makeRefreshRuntime, type RefreshRuntime } from '../refresh/runtime';
import {
    SubscriptionRateLimited,
    SubscriptionStorageError,
    SubscriptionValidationError,
} from './errors';
import { makeSubscriptionRepository } from './repository';
import {
    MAX_FILTER_REAPPLY_ENTRIES,
    makeSubscriptionService,
    type SubscriptionService,
} from './service';

const NO_STORE_HEADERS = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;
const MAX_JSON_BODY_BYTES = 64 * 1024;

export interface SubscriptionRuntime {
    readonly auth: AuthRuntime;
    readonly service: SubscriptionService;
    readonly limitFeedAdd: (
        userId: number,
    ) => Effect.Effect<
        void,
        SubscriptionRateLimited | SubscriptionStorageError
    >;
}

export type SubscriptionRuntimeFactory = (
    env: Env,
) => Effect.Effect<SubscriptionRuntime, unknown>;

export interface SubscriptionRouteDependencies {
    readonly runtimeFactory?: SubscriptionRuntimeFactory;
}

interface SubscriptionRefreshRuntime {
    readonly config: Pick<RefreshRuntime['config'], 'dispatchEnabled'>;
    readonly orchestrator: Pick<
        RefreshRuntime['orchestrator'],
        'createManualRefresh' | 'dispatchOperation'
    >;
}

export const scheduleSubscriptionRefresh = async (
    refresh: SubscriptionRefreshRuntime,
    feedId: number,
): Promise<{ readonly operationId: string }> => {
    const created = await refresh.orchestrator.createManualRefresh(feedId);
    if (refresh.config.dispatchEnabled) {
        await refresh.orchestrator.dispatchOperation(created.operationId);
    }
    return { operationId: created.operationId };
};

const logFeedDiscoveryFailure = (rawUrl: string, error: unknown) =>
    Effect.sync(() => {
        let hostname = 'invalid';
        try {
            hostname = new URL(rawUrl).hostname;
        } catch {
            // The validated caller URL should always be absolute.
        }
        const field = (name: string): unknown =>
            typeof error === 'object' && error !== null
                ? Reflect.get(error, name)
                : undefined;
        console.warn({
            event: 'feed.discovery.failed',
            hostname,
            errorTag: field('_tag'),
            retryable: field('retryable'),
            status: field('status'),
            reason: field('reason'),
            timeoutMs: field('timeoutMs'),
            limitBytes: field('limitBytes'),
        });
    });

export const defaultSubscriptionRuntimeFactory: SubscriptionRuntimeFactory = (
    env,
) => {
    const d1 = makeD1(env.DB);
    return makeDefaultAuthRuntime(env, d1).pipe(
        Effect.map((auth) => {
            const refresh = makeRefreshRuntime(env);
            const feedService = makeFeedRefreshService();
            return {
                auth,
                service: makeSubscriptionService({
                    repository: makeSubscriptionRepository(d1),
                    discoverFeed: (url) =>
                        feedService
                            .discover(url)
                            .pipe(
                                Effect.tapError((error) =>
                                    logFeedDiscoveryFailure(url, error),
                                ),
                            ),
                    scheduleRefresh: (feedId) =>
                        Effect.tryPromise({
                            try: () =>
                                scheduleSubscriptionRefresh(refresh, feedId),
                            catch: (cause) =>
                                new SubscriptionStorageError({
                                    operation: 'subscriptions.scheduleRefresh',
                                    cause,
                                }),
                        }),
                }),
                limitFeedAdd: (userId) =>
                    Effect.tryPromise({
                        try: () =>
                            env.AUTH_RATE_LIMITER.limit({
                                key: `subscription-add:${userId}`,
                            }),
                        catch: (cause) =>
                            new SubscriptionStorageError({
                                operation: 'subscriptions.rateLimit',
                                cause,
                            }),
                    }).pipe(
                        Effect.flatMap((result) =>
                            result.success
                                ? Effect.void
                                : Effect.fail(new SubscriptionRateLimited()),
                        ),
                    ),
            };
        }),
    );
};

interface SafeError {
    readonly code:
        | 'validation_error'
        | 'unauthenticated'
        | 'forbidden'
        | 'csrf_invalid'
        | 'not_found'
        | 'conflict'
        | 'rate_limited'
        | 'service_unavailable'
        | 'internal_server_error';
    readonly message: string;
    readonly status: number;
}

const taggedError = (error: unknown): string | undefined => {
    if (typeof error !== 'object' || error === null) return undefined;
    const tag = Reflect.get(error, '_tag');
    return typeof tag === 'string' ? tag : undefined;
};

const conflictReason = (error: unknown): string | undefined => {
    if (typeof error !== 'object' || error === null) return undefined;
    const reason = Reflect.get(error, 'reason');
    return typeof reason === 'string' ? reason : undefined;
};

const safeFeedError = (error: unknown): SafeError => {
    switch (conflictReason(error)) {
        case 'invalid_url':
            return {
                code: 'validation_error',
                message: 'Enter a valid public HTTP(S) feed or website URL',
                status: 400,
            };
        case 'unresolvable_host':
            return {
                code: 'validation_error',
                message:
                    'Could not resolve this hostname. Check the URL and try again',
                status: 400,
            };
        case 'feed_too_large':
            return {
                code: 'validation_error',
                message: 'The feed document is too large',
                status: 400,
            };
        case 'upstream_rate_limited':
            return {
                code: 'service_unavailable',
                message:
                    'The feed site is rate limiting requests. Try again later',
                status: 503,
            };
        case 'temporarily_unavailable':
            return {
                code: 'service_unavailable',
                message: 'Feed discovery is temporarily unavailable',
                status: 503,
            };
        default:
            return {
                code: 'validation_error',
                message: 'No supported feed was found at this URL',
                status: 400,
            };
    }
};

const safeError = (error: unknown): SafeError => {
    switch (taggedError(error)) {
        case 'SubscriptionValidationError':
        case 'AuthValidationError':
            return {
                code: 'validation_error',
                message: 'Invalid request',
                status: 400,
            };
        case 'SubscriptionFeedError':
            return safeFeedError(error);
        case 'Unauthenticated':
            return {
                code: 'unauthenticated',
                message: 'Authentication required',
                status: 401,
            };
        case 'Forbidden':
            return { code: 'forbidden', message: 'Forbidden', status: 403 };
        case 'CsrfInvalid':
            return {
                code: 'csrf_invalid',
                message: 'Request verification failed',
                status: 403,
            };
        case 'SubscriptionNotFound':
            return { code: 'not_found', message: 'Not found', status: 404 };
        case 'SubscriptionConflict': {
            const reason = conflictReason(error);
            return {
                code: 'conflict',
                message:
                    reason === 'category_in_use'
                        ? 'Move or remove feeds before deleting this category'
                        : reason === 'filter_rebuild_too_large'
                          ? `Filters can be changed for feeds with up to ${MAX_FILTER_REAPPLY_ENTRIES.toLocaleString('en-US')} existing entries`
                          : 'This change conflicts with existing data',
                status: 409,
            };
        }
        case 'SubscriptionRateLimited':
            return {
                code: 'rate_limited',
                message: 'Too many feed discovery requests',
                status: 429,
            };
        case 'SubscriptionStorageError':
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

const headers = () => new Headers(NO_STORE_HEADERS);
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
            headers: headers(),
        });
    } catch {
        return new Response(
            '{"error":{"code":"internal_server_error","message":"Internal server error"}}',
            { status: 500, headers: headers() },
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
const jsonResponse = (
    schema: Schema.ConstraintCodec<unknown>,
    value: unknown,
) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.flatMap((decoded) =>
            Schema.encodeUnknownEffect(schema)(decoded),
        ),
        Effect.map(
            (encoded) =>
                new Response(JSON.stringify(encoded), {
                    status: 200,
                    headers: headers(),
                }),
        ),
    );
const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
    request: Request,
    schema: S,
): Effect.Effect<S['Type'], SubscriptionValidationError> =>
    Effect.tryPromise({
        try: async () => {
            const declaredLength = request.headers.get('content-length');
            if (
                declaredLength !== null &&
                /^\d+$/u.test(declaredLength) &&
                Number(declaredLength) > MAX_JSON_BODY_BYTES
            ) {
                throw new Error('body too large');
            }
            const text = await request.text();
            if (
                new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES
            ) {
                throw new Error('body too large');
            }
            return JSON.parse(text) as unknown;
        },
        catch: () => new SubscriptionValidationError(),
    }).pipe(
        Effect.flatMap((body) =>
            Schema.decodeUnknownEffect(schema, {
                onExcessProperty: 'error',
            })(body).pipe(
                Effect.mapError(() => new SubscriptionValidationError()),
            ),
        ),
    );
const decodeId = (
    value: string | undefined,
): Effect.Effect<number, SubscriptionValidationError> => {
    if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
        return Effect.fail(new SubscriptionValidationError());
    }
    const id = Number(value);
    return Number.isSafeInteger(id)
        ? Effect.succeed(id)
        : Effect.fail(new SubscriptionValidationError());
};

const sessionToken = (
    context: Parameters<typeof getCookie>[0],
    runtime: SubscriptionRuntime,
) => getCookie(context, runtime.auth.config.sessionCookie.name);
const authenticated = <A, E>(
    context: Parameters<typeof getCookie>[0],
    runtime: SubscriptionRuntime,
    operation: (session: AuthenticatedSession) => Effect.Effect<A, E>,
) =>
    runtime.auth.service
        .authenticateSession(sessionToken(context, runtime))
        .pipe(Effect.flatMap(operation));
const authenticatedMutation = <A, E>(
    context: Parameters<typeof getCookie>[0],
    runtime: SubscriptionRuntime,
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

export const registerSubscriptionRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: SubscriptionRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const runtimeFactory =
        dependencies.runtimeFactory ?? defaultSubscriptionRuntimeFactory;
    const runtime = (env: Env) => Effect.suspend(() => runtimeFactory(env));

    app.get('/api/subscriptions/manage', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticated(context, value, (session) =>
                        value.service.list(session.user.id),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(SubscriptionManagementResponse, body),
                ),
            ),
        ),
    );

    app.post('/api/subscriptions', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticatedMutation(context, value, (session) =>
                        Effect.gen(function* () {
                            yield* value.limitFeedAdd(session.user.id);
                            const input = yield* decodeJson(
                                context.req.raw,
                                CreateSubscriptionRequest,
                            );
                            return yield* value.service.createSubscription(
                                session.user.id,
                                input,
                            );
                        }),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(CreateSubscriptionResponse, body),
                ),
            ),
        ),
    );

    app.patch('/api/subscriptions/:feedId', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticatedMutation(context, value, (session) =>
                        Effect.gen(function* () {
                            const feedId = yield* decodeId(
                                context.req.param('feedId'),
                            );
                            const input = yield* decodeJson(
                                context.req.raw,
                                UpdateSubscriptionRequest,
                            );
                            return yield* value.service.updateSubscription(
                                session.user.id,
                                feedId,
                                input,
                            );
                        }),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(SubscriptionMutationResponse, body),
                ),
            ),
        ),
    );

    app.delete('/api/subscriptions/:feedId', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticatedMutation(context, value, (session) =>
                        decodeId(context.req.param('feedId')).pipe(
                            Effect.flatMap((feedId) =>
                                value.service.unsubscribe(
                                    session.user.id,
                                    feedId,
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.flatMap(() =>
                    jsonResponse(
                        DeleteResourceResponse,
                        DeleteResourceResponse.make({ deleted: true }),
                    ),
                ),
            ),
        ),
    );

    app.post('/api/categories', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticatedMutation(context, value, (session) =>
                        decodeJson(context.req.raw, CreateCategoryRequest).pipe(
                            Effect.flatMap((input) =>
                                value.service.createCategory(
                                    session.user.id,
                                    input.name,
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(CategoryMutationResponse, body),
                ),
            ),
        ),
    );

    app.patch('/api/categories/:categoryId', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticatedMutation(context, value, (session) =>
                        Effect.gen(function* () {
                            const categoryId = yield* decodeId(
                                context.req.param('categoryId'),
                            );
                            const input = yield* decodeJson(
                                context.req.raw,
                                UpdateCategoryRequest,
                            );
                            return yield* value.service.updateCategory(
                                session.user.id,
                                categoryId,
                                input.name,
                            );
                        }),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(CategoryMutationResponse, body),
                ),
            ),
        ),
    );

    app.delete('/api/categories/:categoryId', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticatedMutation(context, value, (session) =>
                        decodeId(context.req.param('categoryId')).pipe(
                            Effect.flatMap((categoryId) =>
                                value.service.deleteCategory(
                                    session.user.id,
                                    categoryId,
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.flatMap(() =>
                    jsonResponse(
                        DeleteResourceResponse,
                        DeleteResourceResponse.make({ deleted: true }),
                    ),
                ),
            ),
        ),
    );

    return app;
};

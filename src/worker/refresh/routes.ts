import { ApiErrorResponse, RefreshCommandResponse } from '@shared/http';
import { Effect, Schema } from 'effect';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, makeDefaultAuthRuntime } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { recoverHttpCause } from '../http/failures';
import {
    isRequestBodyTooLarge,
    readBoundedJsonBody,
} from '../http/request-body';
import { type D1, makeD1 } from '../infrastructure/d1';
import type { RefreshRuntime } from './runtime';
import { makeRefreshRuntime } from './runtime';

const NO_STORE_HEADERS = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;
const MAX_EMPTY_JSON_BODY_BYTES = 1_024;

class RefreshRouteNotFound extends Error {
    readonly _tag = 'RefreshRouteNotFound';
}
class RefreshRouteRateLimited extends Error {
    readonly _tag = 'RefreshRouteRateLimited';
}
class RefreshRouteUnavailable extends Error {
    readonly _tag = 'RefreshRouteUnavailable';
}
class RefreshRouteValidation extends Error {
    readonly _tag = 'RefreshRouteValidation';
}

export interface RefreshRouteRuntime {
    readonly auth: AuthRuntime;
    readonly refresh: RefreshRuntime;
    readonly d1: D1;
}

export type RefreshRouteRuntimeFactory = (
    env: Env,
) => Effect.Effect<RefreshRouteRuntime, unknown>;

export interface RefreshRouteDependencies {
    readonly runtimeFactory?: RefreshRouteRuntimeFactory;
}

export const defaultRefreshRouteRuntimeFactory: RefreshRouteRuntimeFactory = (
    env,
) => {
    const d1 = makeD1(env.DB);
    return makeDefaultAuthRuntime(env, d1).pipe(
        Effect.flatMap((auth) =>
            Effect.try({
                try: () => ({
                    auth,
                    refresh: makeRefreshRuntime(env),
                    d1,
                }),
                catch: () => new RefreshRouteUnavailable(),
            }),
        ),
    );
};

const tag = (error: unknown): string | undefined =>
    typeof error === 'object' && error !== null
        ? (Reflect.get(error, '_tag') as string | undefined)
        : undefined;

const errorResponse = (error: unknown): Response => {
    const [code, message, status] = (() => {
        if (isRequestBodyTooLarge(error)) {
            return [
                'payload_too_large',
                'Request body is too large',
                413,
            ] as const;
        }

        switch (tag(error)) {
            case 'AuthValidationError':
            case 'RefreshRouteValidation':
                return ['validation_error', 'Invalid request', 400] as const;
            case 'Unauthenticated':
                return [
                    'unauthenticated',
                    'Authentication required',
                    401,
                ] as const;
            case 'Forbidden':
                return ['forbidden', 'Forbidden', 403] as const;
            case 'CsrfInvalid':
                return [
                    'csrf_invalid',
                    'Request verification failed',
                    403,
                ] as const;
            case 'RefreshRouteNotFound':
            case 'FeedNotFoundError':
                return ['not_found', 'Not found', 404] as const;
            case 'RefreshRouteRateLimited':
                return ['rate_limited', 'Too many requests', 429] as const;
            case 'ManualRefreshCooldownError':
                return [
                    'rate_limited',
                    'This feed was refreshed less than five minutes ago',
                    429,
                ] as const;
            case 'RefreshAlreadyActiveError':
                return [
                    'conflict',
                    'A refresh is already active for this feed',
                    409,
                ] as const;
            case 'RefreshRouteUnavailable':
            case 'JobStorageError':
            case 'AuthStorageError':
                return [
                    'service_unavailable',
                    'Service unavailable',
                    503,
                ] as const;
            case 'JobInvariantError':
                return [
                    'internal_server_error',
                    'Internal server error',
                    500,
                ] as const;
            default:
                return [
                    'internal_server_error',
                    'Internal server error',
                    500,
                ] as const;
        }
    })();

    try {
        const retryAtValue =
            typeof error === 'object' && error !== null
                ? Reflect.get(error, 'retryAt')
                : undefined;
        const retryAt =
            tag(error) === 'ManualRefreshCooldownError' &&
            typeof retryAtValue === 'number'
                ? retryAtValue
                : undefined;
        const headers =
            retryAt === undefined
                ? NO_STORE_HEADERS
                : {
                      ...NO_STORE_HEADERS,
                      'retry-after': String(
                          Math.max(
                              1,
                              Math.ceil((retryAt - Date.now()) / 1_000),
                          ),
                      ),
                  };
        return Response.json(
            Schema.encodeUnknownSync(ApiErrorResponse)(
                ApiErrorResponse.make({ error: { code, message } }),
            ),
            { status, headers },
        );
    } catch {
        return new Response(
            '{"error":{"code":"internal_server_error","message":"Internal server error"}}',
            { status: 500, headers: NO_STORE_HEADERS },
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
                recoverHttpCause(cause, errorResponse),
            ),
        ),
        { signal: request.signal },
    );

const parseFeedId = (value: string | undefined) => {
    if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
        return Effect.fail(new RefreshRouteValidation());
    }
    const id = Number(value);
    return Number.isSafeInteger(id)
        ? Effect.succeed(id)
        : Effect.fail(new RefreshRouteValidation());
};

const requireEmptyJson = (request: Request) => {
    if (
        request.headers
            .get('Content-Type')
            ?.split(';', 1)[0]
            ?.trim()
            .toLowerCase() !== 'application/json'
    ) {
        return Effect.fail(new RefreshRouteValidation());
    }

    return readBoundedJsonBody(request, MAX_EMPTY_JSON_BODY_BYTES).pipe(
        Effect.mapError((error) =>
            isRequestBodyTooLarge(error) ? error : new RefreshRouteValidation(),
        ),
        Effect.flatMap((body) =>
            Effect.try({
                try: () => {
                    if (
                        typeof body !== 'object' ||
                        body === null ||
                        Array.isArray(body) ||
                        Object.keys(body).length !== 0
                    ) {
                        throw new Error('Expected empty object');
                    }
                },
                catch: () => new RefreshRouteValidation(),
            }),
        ),
    );
};

const sessionToken = (
    context: Parameters<typeof getCookie>[0],
    runtime: RefreshRouteRuntime,
) => getCookie(context, runtime.auth.config.sessionCookie.name);

const authorize = (
    context: Parameters<typeof getCookie>[0],
    runtime: RefreshRouteRuntime,
): Effect.Effect<AuthenticatedSession, unknown> =>
    runtime.auth.service
        .authenticateSession(sessionToken(context, runtime))
        .pipe(
            Effect.tap((session) =>
                runtime.auth.service.authorizeMutation(session, {
                    method: context.req.raw.method,
                    origin: context.req.raw.headers.get('Origin') ?? undefined,
                    contentType:
                        context.req.raw.headers.get('Content-Type') ??
                        undefined,
                    csrfCookieToken: getCookie(
                        context,
                        runtime.auth.config.csrfCookie.name,
                    ),
                    csrfHeaderToken:
                        context.req.raw.headers.get('X-CSRF-Token') ??
                        undefined,
                }),
            ),
        );

const idempotencyOperation = async (
    userId: number,
    feedId: number,
    key: string | null,
): Promise<string | undefined> => {
    if (key === null) return undefined;
    if (key.length === 0 || key.length > 128) {
        throw new RefreshRouteValidation();
    }
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(key),
    );
    const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
    ).join('');
    return `feed-refresh:manual:${userId}:${feedId}:${hash}`;
};

export const registerRefreshRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: RefreshRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const factory =
        dependencies.runtimeFactory ?? defaultRefreshRouteRuntimeFactory;

    app.post('/api/feeds/:id/refresh', (context) =>
        runRoute(
            context.req.raw,
            Effect.suspend(() => factory(context.env)).pipe(
                Effect.bindTo('runtime'),
                Effect.bind('session', ({ runtime }) =>
                    authorize(context, runtime),
                ),
                Effect.tap(() => requireEmptyJson(context.req.raw)),
                Effect.bind('feedId', () =>
                    parseFeedId(context.req.param('id')),
                ),
                Effect.tap(({ runtime, session, feedId }) =>
                    runtime.d1
                        .first({
                            sql: `SELECT 1 AS owned FROM feed_subscriptions
                                WHERE user_id = ? AND feed_id = ?`,
                            bindings: [session.user.id, feedId],
                        })
                        .pipe(
                            Effect.mapError(
                                () => new RefreshRouteUnavailable(),
                            ),
                            Effect.flatMap((owned) =>
                                owned === null
                                    ? Effect.fail(new RefreshRouteNotFound())
                                    : Effect.void,
                            ),
                        ),
                ),
                Effect.tap(({ session }) =>
                    Effect.tryPromise({
                        try: () =>
                            context.env.AUTH_RATE_LIMITER.limit({
                                key: `refresh:${session.user.id}`,
                            }),
                        catch: () => new RefreshRouteUnavailable(),
                    }).pipe(
                        Effect.flatMap((outcome) =>
                            outcome.success
                                ? Effect.void
                                : Effect.fail(new RefreshRouteRateLimited()),
                        ),
                    ),
                ),
                Effect.bind('operationId', ({ session, feedId }) =>
                    Effect.tryPromise({
                        try: () =>
                            idempotencyOperation(
                                session.user.id,
                                feedId,
                                context.req.raw.headers.get('Idempotency-Key'),
                            ),
                        catch: (cause) =>
                            cause instanceof RefreshRouteValidation
                                ? cause
                                : new RefreshRouteUnavailable(),
                    }),
                ),
                Effect.bind('command', ({ runtime, feedId, operationId }) =>
                    Effect.tryPromise({
                        try: () =>
                            runtime.refresh.orchestrator.requestManualRefresh(
                                feedId,
                                operationId,
                            ),
                        catch: (cause) => cause,
                    }),
                ),
                Effect.tap(({ runtime }) =>
                    runtime.refresh.config.dispatchEnabled
                        ? Effect.tryPromise({
                              try: () =>
                                  runtime.refresh.orchestrator.dispatchOutbox(
                                      1,
                                  ),
                              catch: () => new RefreshRouteUnavailable(),
                          })
                        : Effect.void,
                ),
                Effect.flatMap(({ command }) =>
                    Effect.try({
                        try: () =>
                            Response.json(
                                Schema.encodeUnknownSync(
                                    RefreshCommandResponse,
                                )(
                                    RefreshCommandResponse.make({
                                        jobId: command.job.id,
                                        operationId: command.operationId,
                                        state: command.job.state,
                                    }),
                                ),
                                {
                                    status: 202,
                                    headers: NO_STORE_HEADERS,
                                },
                            ),
                        catch: () => new RefreshRouteUnavailable(),
                    }),
                ),
            ),
        ),
    );

    return app;
};

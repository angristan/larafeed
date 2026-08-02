import { ApiErrorResponse, FaviconRefreshResponse } from '@shared/http';
import { Cause, Effect, Schema } from 'effect';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, defaultAuthRuntimeFactory } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { makeD1 } from '../infrastructure/d1';
import { makeFaviconRepository } from './repository';
import { type FaviconService, makeFaviconService } from './service';

const headers = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;

export interface FaviconRuntime {
    readonly auth: AuthRuntime;
    readonly service: FaviconService;
    readonly rateLimit: (key: string) => Promise<{ readonly success: boolean }>;
}
export type FaviconRuntimeFactory = (
    env: Env,
) => Effect.Effect<FaviconRuntime, unknown>;
export interface FaviconRouteDependencies {
    readonly runtimeFactory?: FaviconRuntimeFactory;
}
export const defaultFaviconRuntimeFactory: FaviconRuntimeFactory = (env) =>
    defaultAuthRuntimeFactory(env).pipe(
        Effect.map((auth) => ({
            auth,
            service: makeFaviconService({
                repository: makeFaviconRepository(makeD1(env.DB)),
            }),
            rateLimit: (key: string) => env.AUTH_RATE_LIMITER.limit({ key }),
        })),
    );

const id = (value: string): number | null => {
    if (!/^[1-9]\d*$/u.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
};
const mutation = <A, E>(
    context: Parameters<typeof getCookie>[0],
    runtime: AuthRuntime,
    operation: (session: AuthenticatedSession) => Effect.Effect<A, E>,
) =>
    runtime.service
        .authenticateSession(
            getCookie(context, runtime.config.sessionCookie.name),
        )
        .pipe(
            Effect.tap((session) =>
                runtime.service.authorizeMutation(session, {
                    method: context.req.raw.method,
                    origin: context.req.raw.headers.get('Origin') ?? undefined,
                    contentType:
                        context.req.raw.headers.get('Content-Type') ??
                        undefined,
                    csrfCookieToken: getCookie(
                        context,
                        runtime.config.csrfCookie.name,
                    ),
                    csrfHeaderToken:
                        context.req.raw.headers.get('X-CSRF-Token') ??
                        undefined,
                }),
            ),
            Effect.flatMap(operation),
        );
const tag = (error: unknown): string | undefined =>
    typeof error === 'object' && error !== null
        ? typeof Reflect.get(error, '_tag') === 'string'
            ? (Reflect.get(error, '_tag') as string)
            : undefined
        : undefined;
const errorResponse = (error: unknown): Response => {
    const value = (() => {
        switch (tag(error)) {
            case 'Unauthenticated':
                return {
                    code: 'unauthenticated' as const,
                    message: 'Authentication required',
                    status: 401,
                };
            case 'CsrfInvalid':
                return {
                    code: 'csrf_invalid' as const,
                    message: 'Request verification failed',
                    status: 403,
                };
            case 'FaviconNotFound':
                return {
                    code: 'not_found' as const,
                    message: 'Not found',
                    status: 404,
                };
            case 'FaviconRateLimited':
                return {
                    code: 'rate_limited' as const,
                    message: 'Too many requests',
                    status: 429,
                };
            case 'FaviconStorageError':
            case 'AuthStorageError':
                return {
                    code: 'service_unavailable' as const,
                    message: 'Service unavailable',
                    status: 503,
                };
            default:
                return {
                    code: 'internal_server_error' as const,
                    message: 'Internal server error',
                    status: 500,
                };
        }
    })();
    try {
        const body = Schema.encodeUnknownSync(ApiErrorResponse)(
            ApiErrorResponse.make({
                error: { code: value.code, message: value.message },
            }),
        );
        return new Response(JSON.stringify(body), {
            status: value.status,
            headers,
        });
    } catch {
        return new Response(
            '{"error":{"code":"internal_server_error","message":"Internal server error"}}',
            { status: 500, headers },
        );
    }
};
class FaviconRateLimited extends Schema.TaggedErrorClass<FaviconRateLimited>()(
    'FaviconRateLimited',
    {},
) {}
const run = (request: Request, program: Effect.Effect<Response, unknown>) =>
    Effect.runPromise(
        program.pipe(
            Effect.catchCause((cause) =>
                Effect.succeed(errorResponse(Cause.squash(cause))),
            ),
        ),
        { signal: request.signal },
    );

export const registerFaviconRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: FaviconRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const factory = dependencies.runtimeFactory ?? defaultFaviconRuntimeFactory;
    app.post('/api/feeds/:feedId/favicon/refresh', (context) => {
        const feedId = id(context.req.param('feedId'));
        if (feedId === null || new URL(context.req.url).search !== '') {
            return errorResponse({ _tag: 'FaviconNotFound' });
        }
        return run(
            context.req.raw,
            factory(context.env).pipe(
                Effect.flatMap((runtime) =>
                    mutation(context, runtime.auth, (session) =>
                        Effect.tryPromise({
                            try: () =>
                                runtime.rateLimit(
                                    `favicon-refresh:${session.user.id}:${feedId}`,
                                ),
                            catch: () => ({ _tag: 'FaviconStorageError' }),
                        }).pipe(
                            Effect.flatMap((rate) =>
                                rate.success
                                    ? runtime.service.refreshOwned(
                                          session.user.id,
                                          feedId,
                                      )
                                    : Effect.fail(new FaviconRateLimited()),
                            ),
                        ),
                    ),
                ),
                Effect.flatMap((result) =>
                    Schema.encodeUnknownEffect(FaviconRefreshResponse)(
                        FaviconRefreshResponse.make({
                            feedId: result.feedId,
                            faviconUrl:
                                result.faviconUrl === null
                                    ? null
                                    : `/api/images/feeds/${result.feedId}/small`,
                        }),
                    ),
                ),
                Effect.map(
                    (body) =>
                        new Response(JSON.stringify(body), {
                            status: 200,
                            headers,
                        }),
                ),
            ),
        );
    });
    return app;
};

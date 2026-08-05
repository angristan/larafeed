import { ApiErrorResponse, FaviconRefreshResponse } from '@shared/http';
import { Effect, Schema } from 'effect';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, makeDefaultAuthRuntime } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { recoverHttpCause, reportUnexpectedHttpError } from '../http/failures';
import { makeD1 } from '../infrastructure/d1';
import {
    FAVICON_ASSET_CACHE_CONTROL,
    type FaviconAssetRepository,
    feedFaviconUrl,
    makeD1FaviconAssetRepository,
} from './assets';
import { faviconRefreshEnabled } from './cron';
import { faviconDarknessEnabled } from './darkness';
import { makeFaviconRepository } from './repository';
import { makeFaviconRuntime } from './runtime';

const headers = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;

export interface FaviconRuntime {
    readonly auth: AuthRuntime;
    readonly scheduleOwned: (
        userId: number,
        feedId: number,
    ) => Effect.Effect<
        {
            readonly feedId: number;
            readonly faviconUrl: string | null;
            readonly faviconAssetHash: string | null;
        },
        unknown
    >;
    readonly rateLimit: (key: string) => Promise<{ readonly success: boolean }>;
}
export type FaviconRuntimeFactory = (
    env: Env,
) => Effect.Effect<FaviconRuntime, unknown>;
export interface FaviconRouteDependencies {
    readonly runtimeFactory?: FaviconRuntimeFactory;
    readonly enabled?: (env: Env) => boolean;
    readonly assetRepository?: FaviconAssetRepository;
    readonly cache?: Pick<Cache, 'match' | 'put'>;
}
class FaviconSchedulingError extends Schema.TaggedErrorClass<FaviconSchedulingError>()(
    'FaviconSchedulingError',
    {},
) {}

export const defaultFaviconRuntimeFactory: FaviconRuntimeFactory = (env) => {
    const d1 = makeD1(env.DB);
    return makeDefaultAuthRuntime(env, d1).pipe(
        Effect.map((auth) => {
            const repository = makeFaviconRepository(d1);
            const orchestrator = makeFaviconRuntime(env).orchestrator;
            return {
                auth,
                scheduleOwned: (userId: number, feedId: number) =>
                    repository.findOwnedTarget(userId, feedId).pipe(
                        Effect.tap((target) =>
                            Effect.tryPromise({
                                try: () =>
                                    orchestrator.scheduleFeed(
                                        target.feedId,
                                        true,
                                    ),
                                catch: () => new FaviconSchedulingError(),
                            }),
                        ),
                    ),
                rateLimit: (key: string) =>
                    env.AUTH_RATE_LIMITER.limit({ key }),
            };
        }),
    );
};

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
            case 'FaviconConflict':
                return {
                    code: 'conflict' as const,
                    message: 'Favicon changed; retry the request',
                    status: 409,
                };
            case 'FaviconRateLimited':
                return {
                    code: 'rate_limited' as const,
                    message: 'Too many requests',
                    status: 429,
                };
            case 'FaviconRefreshDisabled':
                return {
                    code: 'service_unavailable' as const,
                    message: 'Favicon refresh is disabled',
                    status: 503,
                };
            case 'FaviconAssetCandidateError':
            case 'FaviconAssetStorageError':
            case 'FaviconSchedulingError':
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
                recoverHttpCause(cause, errorResponse),
            ),
        ),
        { signal: request.signal },
    );

export const registerFaviconRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: FaviconRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const factory = dependencies.runtimeFactory ?? defaultFaviconRuntimeFactory;
    const enabled =
        dependencies.enabled ??
        ((env: Env) =>
            faviconRefreshEnabled(env) && faviconDarknessEnabled(env));

    app.get('/api/public/favicons/v1/:filename', async (context) => {
        const match = /^([a-f0-9]{64})\.png$/u.exec(
            context.req.param('filename') ?? '',
        );
        const hash = match?.[1];
        if (hash === undefined || new URL(context.req.url).search) {
            return new Response(null, {
                status: 404,
                headers: { 'cache-control': 'no-store' },
            });
        }

        const cache =
            dependencies.cache ??
            (
                caches as CacheStorage & {
                    readonly default: Cache;
                }
            ).default;
        const cacheKey = new Request(context.req.url, { method: 'GET' });
        try {
            const cached = await cache.match(cacheKey);
            if (cached !== undefined) return cached;
        } catch {
            // A cache outage must not hide a durable D1 asset.
        }

        try {
            const repository =
                dependencies.assetRepository ??
                makeD1FaviconAssetRepository(
                    makeD1(context.env.DB, 'first-unconstrained'),
                );
            const png = await repository.find(hash);
            if (png === null) {
                return new Response(null, {
                    status: 404,
                    headers: { 'cache-control': 'no-store' },
                });
            }
            const body = new ArrayBuffer(png.byteLength);
            new Uint8Array(body).set(png);
            const response = new Response(body, {
                status: 200,
                headers: {
                    'cache-control': FAVICON_ASSET_CACHE_CONTROL,
                    'content-type': 'image/png',
                    etag: `"${hash}"`,
                    'x-content-type-options': 'nosniff',
                },
            });
            try {
                await cache.put(cacheKey, response.clone());
            } catch {
                // The browser can still cache this durable response.
            }
            return response;
        } catch (error) {
            reportUnexpectedHttpError(error);
            return new Response(null, {
                status: 503,
                headers: { 'cache-control': 'no-store' },
            });
        }
    });

    app.post('/api/feeds/:feedId/favicon/refresh', (context) => {
        if (!enabled(context.env)) {
            return errorResponse({ _tag: 'FaviconRefreshDisabled' });
        }
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
                                    ? runtime.scheduleOwned(
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
                            faviconUrl: feedFaviconUrl({
                                feedId: result.feedId,
                                upstreamUrl: result.faviconUrl,
                                assetHash: result.faviconAssetHash,
                            }),
                        }),
                    ),
                ),
                Effect.map(
                    (body) =>
                        new Response(JSON.stringify(body), {
                            status: 202,
                            headers,
                        }),
                ),
            ),
        );
    });
    return app;
};

import { ApiErrorResponse, EntryFullContentResponse } from '@shared/http';
import { Effect, Schema } from 'effect';
import type { Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, makeDefaultAuthRuntime } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { recoverHttpCause } from '../http/failures';
import {
    isRequestBodyTooLarge,
    type RequestBodyError,
    readBoundedJsonBody,
} from '../http/request-body';
import {
    fullArticleImagePath,
    rewriteArticleImageUrls,
} from '../images/article';
import { makeD1 } from '../infrastructure/d1';
import { parseSummaryConfig } from '../summaries/config';
import { makeSummaryProvider } from '../summaries/provider';
import { parseFullContentConfig } from './config';
import {
    FullContentConfigError,
    FullContentRateLimited,
    FullContentStorageError,
    FullContentValidationError,
} from './errors';
import { makeArticlePageFetcher } from './fetch';
import { makeFullContentRepository } from './repository';
import { type FullContentService, makeFullContentService } from './service';
import { makeKvFullContentStore } from './store';

const NO_STORE_HEADERS = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;
const EmptyJsonObject = Schema.Struct({});
const MAX_EMPTY_JSON_BODY_BYTES = 1_024;

export interface FullContentRouteRuntime {
    readonly auth: AuthRuntime;
    readonly service: FullContentService;
}

export type FullContentRuntimeFactory = (
    env: Env,
) => Effect.Effect<FullContentRouteRuntime, unknown>;

export interface FullContentRouteDependencies {
    readonly runtimeFactory?: FullContentRuntimeFactory;
}

export const defaultFullContentRuntimeFactory: FullContentRuntimeFactory = (
    env,
) => {
    const d1 = makeD1(env.DB);
    return Effect.all({
        auth: makeDefaultAuthRuntime(env, d1),
        config: parseFullContentConfig(env),
        summaryConfig: parseSummaryConfig(env).pipe(
            Effect.mapError(() => new FullContentConfigError()),
        ),
    }).pipe(
        Effect.flatMap(({ auth, config, summaryConfig }) => {
            const kv = env.FULL_CONTENT_KV;
            if (config.enabled && kv === undefined) {
                return Effect.fail(new FullContentConfigError());
            }
            return Effect.succeed({
                auth,
                service: makeFullContentService({
                    config,
                    summaryConfig,
                    repository: makeFullContentRepository(d1),
                    store: makeKvFullContentStore(kv),
                    fetchPage: makeArticlePageFetcher(),
                    ...(env.IMAGES_ENABLED === 'true'
                        ? {
                              rewriteImages: (
                                  entryId: number,
                                  html: string,
                                  baseUrl: string,
                              ) =>
                                  rewriteArticleImageUrls(
                                      entryId,
                                      html,
                                      baseUrl,
                                      fullArticleImagePath,
                                  ),
                          }
                        : {}),
                    ...(summaryConfig.enabled && env.AI
                        ? {
                              provider: makeSummaryProvider(
                                  summaryConfig,
                                  env.AI,
                              ),
                          }
                        : {}),
                }),
            });
        }),
    );
};

interface SafeError {
    readonly code:
        | 'validation_error'
        | 'payload_too_large'
        | 'unauthenticated'
        | 'forbidden'
        | 'csrf_invalid'
        | 'not_found'
        | 'conflict'
        | 'bad_gateway'
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

const fetchErrorMessage = (error: unknown): string => {
    const kind =
        typeof error === 'object' && error !== null
            ? Reflect.get(error, 'kind')
            : undefined;
    const status =
        typeof error === 'object' && error !== null
            ? Reflect.get(error, 'status')
            : undefined;
    switch (kind) {
        case 'timeout':
            return 'The publisher’s site timed out';
        case 'http':
            return typeof status === 'number'
                ? `The publisher’s site returned HTTP ${status}`
                : 'The publisher’s site returned an error';
        case 'policy':
            return 'The article link cannot be fetched';
        case 'unsupported_content':
            return 'The article link is not an HTML page';
        case 'too_large':
            return 'The article page is too large to fetch';
        default:
            return 'Could not reach the publisher’s site';
    }
};

const safeError = (error: unknown): SafeError => {
    if (isRequestBodyTooLarge(error)) {
        return {
            code: 'payload_too_large',
            message: 'Request body is too large',
            status: 413,
        };
    }

    switch (taggedError(error)) {
        case 'FullContentValidationError':
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
        case 'Forbidden':
            return { code: 'forbidden', message: 'Forbidden', status: 403 };
        case 'CsrfInvalid':
            return {
                code: 'csrf_invalid',
                message: 'Request verification failed',
                status: 403,
            };
        case 'FullContentNotFound':
            return { code: 'not_found', message: 'Not found', status: 404 };
        case 'FullContentSourceMissing':
            return {
                code: 'conflict',
                message: 'This entry has no article link to fetch',
                status: 409,
            };
        case 'FullContentUnavailable':
            return {
                code: 'conflict',
                message: 'Fetch the full article before summarizing it',
                status: 409,
            };
        case 'FullContentTooLarge':
            return {
                code: 'conflict',
                message: 'The full article is too large to store',
                status: 409,
            };
        case 'FullContentFetchError':
            return {
                code: 'bad_gateway',
                message: fetchErrorMessage(error),
                status: 502,
            };
        case 'FullContentExtractError':
            return {
                code: 'bad_gateway',
                message: 'Could not extract the article from the page',
                status: 502,
            };
        case 'FullContentRateLimited':
            return {
                code: 'rate_limited',
                message: 'Too many full article requests',
                status: 429,
            };
        case 'FullContentDisabled':
            return {
                code: 'service_unavailable',
                message: 'Full article fetching is disabled',
                status: 503,
            };
        case 'FullContentSummaryDisabled':
            return {
                code: 'service_unavailable',
                message: 'AI summaries are disabled',
                status: 503,
            };
        case 'FullContentConfigError':
        case 'FullContentInvariantError':
        case 'FullContentStorageError':
        case 'SummaryProviderError':
        case 'AuthStorageError':
            return {
                code: 'service_unavailable',
                message: 'Full article service unavailable',
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

const responseHeaders = (): Headers => new Headers(NO_STORE_HEADERS);
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
                recoverHttpCause(cause, apiErrorResponse),
            ),
        ),
        { signal: request.signal },
    );

const jsonResponse = (value: unknown): Effect.Effect<Response, unknown> =>
    Schema.decodeUnknownEffect(EntryFullContentResponse)(value).pipe(
        Effect.flatMap((decoded) =>
            Schema.encodeUnknownEffect(EntryFullContentResponse)(decoded),
        ),
        Effect.map(
            (encoded) =>
                new Response(JSON.stringify(encoded), {
                    status: 200,
                    headers: responseHeaders(),
                }),
        ),
    );

const decodePathId = (
    value: string | undefined,
): Effect.Effect<number, FullContentValidationError> => {
    if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
        return Effect.fail(new FullContentValidationError());
    }
    const id = Number(value);
    return Number.isSafeInteger(id)
        ? Effect.succeed(id)
        : Effect.fail(new FullContentValidationError());
};

const requireEmptyJson = (
    request: Request,
): Effect.Effect<void, FullContentValidationError | RequestBodyError> =>
    readBoundedJsonBody(request, MAX_EMPTY_JSON_BODY_BYTES).pipe(
        Effect.mapError((error) =>
            isRequestBodyTooLarge(error)
                ? error
                : new FullContentValidationError(),
        ),
        Effect.flatMap((body) =>
            Schema.decodeUnknownEffect(EmptyJsonObject, {
                onExcessProperty: 'error',
            })(body).pipe(
                Effect.asVoid,
                Effect.mapError(() => new FullContentValidationError()),
            ),
        ),
    );

const sessionToken = (
    context: Parameters<typeof getCookie>[0],
    runtime: FullContentRouteRuntime,
) => getCookie(context, runtime.auth.config.sessionCookie.name);

const authenticate = (
    context: Parameters<typeof getCookie>[0],
    runtime: FullContentRouteRuntime,
): Effect.Effect<AuthenticatedSession, unknown> =>
    runtime.auth.service.authenticateSession(sessionToken(context, runtime));

const authorizeMutation = (
    context: Parameters<typeof getCookie>[0],
    runtime: FullContentRouteRuntime,
    session: AuthenticatedSession,
) =>
    runtime.auth.service.authorizeMutation(session, {
        method: context.req.raw.method,
        origin: context.req.raw.headers.get('Origin') ?? undefined,
        contentType: context.req.raw.headers.get('Content-Type') ?? undefined,
        csrfCookieToken: getCookie(
            context,
            runtime.auth.config.csrfCookie.name,
        ),
        csrfHeaderToken:
            context.req.raw.headers.get('X-CSRF-Token') ?? undefined,
    });

const rateLimit = (env: Env, userId: number) =>
    Effect.tryPromise({
        try: () =>
            env.AUTH_RATE_LIMITER.limit({ key: `full-content:${userId}` }),
        catch: (cause) =>
            new FullContentStorageError({
                operation: 'fullContent.rateLimit',
                cause,
            }),
    }).pipe(
        Effect.flatMap((outcome) =>
            outcome.success
                ? Effect.void
                : Effect.fail(new FullContentRateLimited()),
        ),
    );

export const registerFullContentRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: FullContentRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const factory =
        dependencies.runtimeFactory ?? defaultFullContentRuntimeFactory;
    const runtime = (env: Env) => Effect.suspend(() => factory(env));

    app.get('/api/entries/:id/full-content', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.bindTo('runtime'),
                Effect.bind('session', ({ runtime: value }) =>
                    authenticate(context, value),
                ),
                Effect.bind('entryId', () =>
                    decodePathId(context.req.param('id')),
                ),
                Effect.flatMap(({ runtime: value, session, entryId }) =>
                    value.service.get(session.user.id, entryId),
                ),
                Effect.flatMap(jsonResponse),
            ),
        ),
    );

    const mutationRoute = (
        context: Context<{ Bindings: Env }>,
        run: (
            service: FullContentService,
            userId: number,
            entryId: number,
        ) => Effect.Effect<typeof EntryFullContentResponse.Type, unknown>,
    ) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.bindTo('runtime'),
                Effect.bind('session', ({ runtime: value }) =>
                    authenticate(context, value),
                ),
                Effect.tap(({ runtime: value, session }) =>
                    authorizeMutation(context, value, session),
                ),
                Effect.tap(({ session }) =>
                    rateLimit(context.env, session.user.id),
                ),
                Effect.tap(() => requireEmptyJson(context.req.raw)),
                Effect.bind('entryId', () =>
                    decodePathId(context.req.param('id')),
                ),
                Effect.flatMap(({ runtime: value, session, entryId }) =>
                    run(value.service, session.user.id, entryId),
                ),
                Effect.flatMap(jsonResponse),
            ),
        );

    app.post('/api/entries/:id/full-content', (context) =>
        mutationRoute(context, (service, userId, entryId) =>
            service.fetchContent(userId, entryId),
        ),
    );

    app.post('/api/entries/:id/full-content/summary', (context) =>
        mutationRoute(context, (service, userId, entryId) =>
            service.summarize(userId, entryId),
        ),
    );

    return app;
};

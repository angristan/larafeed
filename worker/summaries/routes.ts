import { ApiErrorResponse, EntrySummaryResponse } from '@shared/http';
import { Cause, Effect, Schema } from 'effect';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, defaultAuthRuntimeFactory } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { makeD1 } from '../infrastructure/d1';
import { parseSummaryConfig } from './config';
import {
    SummaryRateLimited,
    SummaryStorageError,
    SummaryValidationError,
} from './errors';
import { makeSummaryProvider } from './provider';
import { makeSummaryRepository } from './repository';
import { makeSummaryService, type SummaryService } from './service';

const NO_STORE_HEADERS = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;
const EmptyJsonObject = Schema.Struct({});

export interface SummaryRouteRuntime {
    readonly auth: AuthRuntime;
    readonly service: SummaryService;
}

export type SummaryRuntimeFactory = (
    env: Env,
) => Effect.Effect<SummaryRouteRuntime, unknown>;

export interface SummaryRouteDependencies {
    readonly runtimeFactory?: SummaryRuntimeFactory;
}

export const defaultSummaryRuntimeFactory: SummaryRuntimeFactory = (env) =>
    Effect.all({
        auth: defaultAuthRuntimeFactory(env),
        config: parseSummaryConfig(env),
    }).pipe(
        Effect.map(({ auth, config }) => ({
            auth,
            service: makeSummaryService({
                config,
                repository: makeSummaryRepository(makeD1(env.DB)),
                provider: makeSummaryProvider(config),
            }),
        })),
    );

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

const safeError = (error: unknown): SafeError => {
    switch (taggedError(error)) {
        case 'SummaryValidationError':
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
        case 'SummaryNotFound':
            return { code: 'not_found', message: 'Not found', status: 404 };
        case 'SummaryContentUnavailable':
            return {
                code: 'conflict',
                message: 'Article content is unavailable',
                status: 409,
            };
        case 'SummaryGenerationInProgress':
            return {
                code: 'conflict',
                message: 'Summary generation is already in progress',
                status: 409,
            };
        case 'SummaryRateLimited':
            return {
                code: 'rate_limited',
                message: 'Too many summary requests',
                status: 429,
            };
        case 'SummaryFeatureDisabled':
            return {
                code: 'service_unavailable',
                message: 'AI summaries are disabled',
                status: 503,
            };
        case 'SummaryConfigError':
        case 'SummaryProviderError':
        case 'SummaryStorageError':
        case 'AuthStorageError':
            return {
                code: 'service_unavailable',
                message: 'Summary service unavailable',
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
                Effect.succeed(apiErrorResponse(Cause.squash(cause))),
            ),
        ),
        { signal: request.signal },
    );

const jsonResponse = (value: unknown): Effect.Effect<Response, unknown> =>
    Schema.decodeUnknownEffect(EntrySummaryResponse)(value).pipe(
        Effect.flatMap((decoded) =>
            Schema.encodeUnknownEffect(EntrySummaryResponse)(decoded),
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
): Effect.Effect<number, SummaryValidationError> => {
    if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
        return Effect.fail(new SummaryValidationError());
    }
    const id = Number(value);
    return Number.isSafeInteger(id)
        ? Effect.succeed(id)
        : Effect.fail(new SummaryValidationError());
};

const requireEmptyJson = (
    request: Request,
): Effect.Effect<void, SummaryValidationError> =>
    Effect.tryPromise({
        try: async () => {
            const body: unknown = await request.json();
            Schema.decodeUnknownSync(EmptyJsonObject, {
                onExcessProperty: 'error',
            })(body);
        },
        catch: () => new SummaryValidationError(),
    });

const sessionToken = (
    context: Parameters<typeof getCookie>[0],
    runtime: SummaryRouteRuntime,
) => getCookie(context, runtime.auth.config.sessionCookie.name);

const authenticate = (
    context: Parameters<typeof getCookie>[0],
    runtime: SummaryRouteRuntime,
): Effect.Effect<AuthenticatedSession, unknown> =>
    runtime.auth.service.authenticateSession(sessionToken(context, runtime));

const authorizeMutation = (
    context: Parameters<typeof getCookie>[0],
    runtime: SummaryRouteRuntime,
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
        try: () => env.AUTH_RATE_LIMITER.limit({ key: `summary:${userId}` }),
        catch: (cause) =>
            new SummaryStorageError({
                operation: 'summaries.rateLimit',
                cause,
            }),
    }).pipe(
        Effect.flatMap((outcome) =>
            outcome.success
                ? Effect.void
                : Effect.fail(new SummaryRateLimited()),
        ),
    );

export const registerSummaryRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: SummaryRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const factory = dependencies.runtimeFactory ?? defaultSummaryRuntimeFactory;
    const runtime = (env: Env) => Effect.suspend(() => factory(env));

    app.get('/api/entries/:id/summary', (context) =>
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

    app.post('/api/entries/:id/summary', (context) =>
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
                    value.service.generate(session.user.id, entryId),
                ),
                Effect.flatMap(jsonResponse),
            ),
        ),
    );

    return app;
};

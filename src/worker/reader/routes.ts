import {
    ApiErrorResponse,
    DesiredArchiveRequest,
    DesiredReadRequest,
    DesiredStarRequest,
    ReaderCategoryListResponse,
    ReaderCountsResponse,
    ReaderEntryDetail,
    ReaderEntryListResponse,
    ReaderInteractionResponse,
    ReaderReadThroughResponse,
    ReaderSubscriptionListResponse,
} from '@shared/http';
import { Effect, Schema } from 'effect';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, makeDefaultAuthRuntime } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { recoverHttpCause } from '../http/failures';
import {
    isRequestBodyTooLarge,
    type RequestBodyError,
    readBoundedJsonBody,
} from '../http/request-body';
import { makeD1 } from '../infrastructure/d1';
import { ReaderValidationError } from './errors';
import {
    makeReaderRepository,
    type ReaderEntryQuery,
    type ReaderEntryScope,
} from './repository';
import { makeReaderService, type ReaderService } from './service';

const NO_STORE_HEADERS = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;
const EmptyJsonObject = Schema.Struct({});
const MAX_JSON_BODY_BYTES = 16 * 1_024;
const MAX_PAGE = 10_000;
const DEFAULT_PAGE_SIZE = 20;
const allowedQueryKeys = new Set([
    'feed_id',
    'category_id',
    'filter',
    'order_by',
    'page',
    'page_size',
]);

export interface ReaderRuntime {
    readonly auth: AuthRuntime;
    readonly service: ReaderService;
}

export type ReaderRuntimeFactory = (
    env: Env,
) => Effect.Effect<ReaderRuntime, unknown>;

export interface ReaderRouteDependencies {
    readonly runtimeFactory?: ReaderRuntimeFactory;
}

export const defaultReaderRuntimeFactory: ReaderRuntimeFactory = (env) => {
    const d1 = makeD1(env.DB);
    return makeDefaultAuthRuntime(env, d1).pipe(
        Effect.map((auth) => ({
            auth,
            service: makeReaderService({
                repository: makeReaderRepository(d1),
            }),
        })),
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
    if (isRequestBodyTooLarge(error)) {
        return {
            code: 'payload_too_large',
            message: 'Request body is too large',
            status: 413,
        };
    }

    switch (taggedError(error)) {
        case 'ReaderValidationError':
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
        case 'ReaderNotFound':
            return { code: 'not_found', message: 'Not found', status: 404 };
        case 'ReaderStorageError':
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

const jsonResponse = (
    schema: Schema.ConstraintCodec<unknown>,
    value: unknown,
): Effect.Effect<Response, unknown> =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.flatMap((decoded) =>
            Schema.encodeUnknownEffect(schema)(decoded),
        ),
        Effect.map(
            (encoded) =>
                new Response(JSON.stringify(encoded), {
                    status: 200,
                    headers: responseHeaders(),
                }),
        ),
    );

const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
    request: Request,
    schema: S,
): Effect.Effect<S['Type'], ReaderValidationError | RequestBodyError> =>
    readBoundedJsonBody(request, MAX_JSON_BODY_BYTES).pipe(
        Effect.mapError((error) =>
            isRequestBodyTooLarge(error) ? error : new ReaderValidationError(),
        ),
        Effect.flatMap((body) =>
            Schema.decodeUnknownEffect(schema, {
                onExcessProperty: 'error',
            })(body).pipe(Effect.mapError(() => new ReaderValidationError())),
        ),
    );

const parsePositiveInt = (
    value: string | null,
    maximum: number,
): Effect.Effect<number, ReaderValidationError> => {
    if (value === null || !/^[1-9]\d*$/.test(value)) {
        return Effect.fail(new ReaderValidationError());
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed <= maximum
        ? Effect.succeed(parsed)
        : Effect.fail(new ReaderValidationError());
};

const decodePathId = (value: string | undefined) =>
    value === undefined
        ? Effect.fail(new ReaderValidationError())
        : parsePositiveInt(value, Number.MAX_SAFE_INTEGER);

export const parseReaderEntryQuery = (
    request: Request,
): Effect.Effect<ReaderEntryQuery, ReaderValidationError> =>
    Effect.gen(function* () {
        const search = new URL(request.url).searchParams;
        for (const key of search.keys()) {
            if (!allowedQueryKeys.has(key) || search.getAll(key).length !== 1) {
                return yield* Effect.fail(new ReaderValidationError());
            }
        }

        const feedValue = search.get('feed_id');
        const categoryValue = search.get('category_id');
        if (feedValue !== null && categoryValue !== null) {
            return yield* Effect.fail(new ReaderValidationError());
        }

        let scope: ReaderEntryScope = { type: 'all' };
        if (feedValue !== null) {
            scope = {
                type: 'feed',
                id: yield* parsePositiveInt(feedValue, Number.MAX_SAFE_INTEGER),
            };
        } else if (categoryValue !== null) {
            scope = {
                type: 'category',
                id: yield* parsePositiveInt(
                    categoryValue,
                    Number.MAX_SAFE_INTEGER,
                ),
            };
        }

        const filter = search.get('filter') ?? 'all';
        if (
            filter !== 'all' &&
            filter !== 'unread' &&
            filter !== 'read' &&
            filter !== 'favorites'
        ) {
            return yield* Effect.fail(new ReaderValidationError());
        }

        const orderBy = search.get('order_by') ?? 'published_at';
        if (orderBy !== 'published_at' && orderBy !== 'created_at') {
            return yield* Effect.fail(new ReaderValidationError());
        }

        const pageValue = search.get('page');
        const page =
            pageValue === null
                ? 1
                : yield* parsePositiveInt(pageValue, MAX_PAGE);
        const pageSizeValue = search.get('page_size');
        const pageSize =
            pageSizeValue === null
                ? DEFAULT_PAGE_SIZE
                : yield* parsePositiveInt(pageSizeValue, 100);

        return { scope, filter, orderBy, page, pageSize };
    });

const sessionToken = (
    context: Parameters<typeof getCookie>[0],
    runtime: ReaderRuntime,
) => getCookie(context, runtime.auth.config.sessionCookie.name);

const authenticated = <A, E>(
    context: Parameters<typeof getCookie>[0],
    runtime: ReaderRuntime,
    operation: (session: AuthenticatedSession) => Effect.Effect<A, E>,
) =>
    runtime.auth.service
        .authenticateSession(sessionToken(context, runtime))
        .pipe(Effect.flatMap(operation));

const authenticatedMutation = <A, E>(
    context: Parameters<typeof getCookie>[0],
    runtime: ReaderRuntime,
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

export const registerReaderRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: ReaderRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const runtimeFactory =
        dependencies.runtimeFactory ?? defaultReaderRuntimeFactory;
    const runtime = (env: Env) => Effect.suspend(() => runtimeFactory(env));

    app.get('/api/categories', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((readerRuntime) =>
                    authenticated(context, readerRuntime, (session) =>
                        readerRuntime.service.listCategories(session.user.id),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(ReaderCategoryListResponse, body),
                ),
            ),
        ),
    );

    app.get('/api/subscriptions', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((readerRuntime) =>
                    authenticated(context, readerRuntime, (session) =>
                        readerRuntime.service.listSubscriptions(
                            session.user.id,
                        ),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(ReaderSubscriptionListResponse, body),
                ),
            ),
        ),
    );

    app.get('/api/entries/counts', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((readerRuntime) =>
                    authenticated(context, readerRuntime, (session) =>
                        readerRuntime.service.getCounts(session.user.id),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(ReaderCountsResponse, body),
                ),
            ),
        ),
    );

    app.get('/api/entries', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((readerRuntime) =>
                    authenticated(context, readerRuntime, (session) =>
                        parseReaderEntryQuery(context.req.raw).pipe(
                            Effect.flatMap((query) =>
                                readerRuntime.service.listEntries(
                                    session.user.id,
                                    query,
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(ReaderEntryListResponse, body),
                ),
            ),
        ),
    );

    app.get('/api/entries/:id', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((readerRuntime) =>
                    authenticated(context, readerRuntime, (session) =>
                        decodePathId(context.req.param('id')).pipe(
                            Effect.flatMap((entryId) =>
                                readerRuntime.service.findEntry(
                                    session.user.id,
                                    entryId,
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.flatMap((body) => jsonResponse(ReaderEntryDetail, body)),
            ),
        ),
    );

    const desiredMutation = <S extends Schema.ConstraintDecoder<unknown>>(
        context: Parameters<typeof getCookie>[0],
        schema: S,
        operation: (
            service: ReaderService,
            userId: number,
            entryId: number,
            body: S['Type'],
        ) => Effect.Effect<unknown, unknown>,
    ) =>
        runtime(context.env).pipe(
            Effect.flatMap((readerRuntime) =>
                authenticatedMutation(context, readerRuntime, (session) =>
                    decodePathId(context.req.param('id')).pipe(
                        Effect.bindTo('entryId'),
                        Effect.bind('body', () =>
                            decodeJson(context.req.raw, schema),
                        ),
                        Effect.flatMap(({ entryId, body }) =>
                            operation(
                                readerRuntime.service,
                                session.user.id,
                                entryId,
                                body,
                            ),
                        ),
                    ),
                ),
            ),
            Effect.flatMap((body) =>
                jsonResponse(ReaderInteractionResponse, body),
            ),
        );

    app.put('/api/entries/:id/read', (context) =>
        runRoute(
            context.req.raw,
            desiredMutation(
                context,
                DesiredReadRequest,
                (service, userId, entryId, body) =>
                    service.setRead(userId, entryId, body.read),
            ),
        ),
    );

    app.put('/api/entries/:id/star', (context) =>
        runRoute(
            context.req.raw,
            desiredMutation(
                context,
                DesiredStarRequest,
                (service, userId, entryId, body) =>
                    service.setStarred(userId, entryId, body.starred),
            ),
        ),
    );

    app.put('/api/entries/:id/archive', (context) =>
        runRoute(
            context.req.raw,
            desiredMutation(
                context,
                DesiredArchiveRequest,
                (service, userId, entryId, body) =>
                    service.setArchived(userId, entryId, body.archived),
            ),
        ),
    );

    app.put('/api/subscriptions/:feedId/read-through', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((readerRuntime) =>
                    authenticatedMutation(context, readerRuntime, (session) =>
                        decodePathId(context.req.param('feedId')).pipe(
                            Effect.bindTo('feedId'),
                            Effect.bind('body', () =>
                                decodeJson(context.req.raw, EmptyJsonObject),
                            ),
                            Effect.flatMap(({ feedId }) =>
                                readerRuntime.service.advanceReadThrough(
                                    session.user.id,
                                    feedId,
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.flatMap((body) =>
                    jsonResponse(ReaderReadThroughResponse, body),
                ),
            ),
        ),
    );

    return app;
};

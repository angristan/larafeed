import {
    ApiErrorResponse,
    CreateOpmlImportRequest,
    OpmlImportListResponse,
    OpmlImportResponse,
} from '@shared/http';
import { Cause, Effect, Schema } from 'effect';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, defaultAuthRuntimeFactory } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { makeD1 } from '../infrastructure/d1';
import {
    OpmlFeatureDisabled,
    OpmlNotFoundError,
    OpmlRateLimitedError,
    OpmlValidationError,
} from './errors';
import { makeOpmlOrchestrator, type OpmlOrchestrator } from './orchestration';
import { makeOpmlRepository } from './repository';
import type { OpmlQueueMessage, OpmlQueueSender } from './types';

const NO_STORE_HEADERS = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;

export interface OpmlRouteRuntime {
    readonly auth: AuthRuntime;
    readonly orchestrator: OpmlOrchestrator;
    readonly importEnabled: boolean;
}

export type OpmlRouteRuntimeFactory = (
    env: Env,
) => Effect.Effect<OpmlRouteRuntime, unknown>;

export interface OpmlRouteDependencies {
    readonly runtimeFactory?: OpmlRouteRuntimeFactory;
}

const queueFromEnv = (env: Env): OpmlQueueSender => ({
    send: async (message: OpmlQueueMessage) => {
        const binding: unknown = Reflect.get(env, 'OPML_IMPORT_QUEUE');
        if (
            typeof binding !== 'object' ||
            binding === null ||
            typeof Reflect.get(binding, 'send') !== 'function'
        ) {
            throw new Error('OPML_IMPORT_QUEUE binding is unavailable');
        }
        const send = Reflect.get(binding, 'send') as (
            body: OpmlQueueMessage,
        ) => Promise<void>;
        await send.call(binding, message);
    },
});

export const makeDefaultOpmlOrchestrator = (env: Env): OpmlOrchestrator =>
    makeOpmlOrchestrator({
        repository: makeOpmlRepository(makeD1(env.DB)),
        queue: queueFromEnv(env),
    });

export const opmlImportEnabled = (
    env: Pick<Env, 'OPML_IMPORT_ENABLED'>,
): boolean => env.OPML_IMPORT_ENABLED === 'true';

export const defaultOpmlRouteRuntimeFactory: OpmlRouteRuntimeFactory = (env) =>
    defaultAuthRuntimeFactory(env).pipe(
        Effect.map((auth) => ({
            auth,
            orchestrator: makeDefaultOpmlOrchestrator(env),
            importEnabled: opmlImportEnabled(env),
        })),
    );

const tag = (error: unknown): string | undefined =>
    typeof error === 'object' && error !== null
        ? ((Reflect.get(error, '_tag') as string | undefined) ??
          (Reflect.get(error, 'name') as string | undefined))
        : undefined;

const errorResponse = (error: unknown): Response => {
    const [code, message, status] = (() => {
        switch (tag(error)) {
            case 'OpmlValidationError':
            case 'AuthValidationError':
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
            case 'OpmlNotFoundError':
                return ['not_found', 'Not found', 404] as const;
            case 'OpmlRateLimitedError':
                return ['rate_limited', 'Too many requests', 429] as const;
            case 'OpmlFeatureDisabled':
                return [
                    'service_unavailable',
                    'OPML imports are disabled',
                    503,
                ] as const;
            case 'OpmlStorageError':
            case 'AuthStorageError':
                return [
                    'service_unavailable',
                    'Service unavailable',
                    503,
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
        return Response.json(
            Schema.encodeUnknownSync(ApiErrorResponse)(
                ApiErrorResponse.make({ error: { code, message } }),
            ),
            { status, headers: NO_STORE_HEADERS },
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
    effect: Effect.Effect<Response, unknown>,
): Promise<Response> =>
    Effect.runPromise(
        effect.pipe(
            Effect.catchCause((cause) =>
                Effect.succeed(errorResponse(Cause.squash(cause))),
            ),
        ),
        { signal: request.signal },
    );

const jsonResponse = (
    schema: Schema.ConstraintCodec<unknown>,
    value: unknown,
    status = 200,
): Effect.Effect<Response, unknown> =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.flatMap((decoded) =>
            Schema.encodeUnknownEffect(schema)(decoded),
        ),
        Effect.map(
            (encoded) =>
                new Response(JSON.stringify(encoded), {
                    status,
                    headers: NO_STORE_HEADERS,
                }),
        ),
    );

const MAX_JSON_REQUEST_CHARACTERS = 4_100_000;

const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
    request: Request,
    schema: S,
): Effect.Effect<S['Type'], OpmlValidationError> => {
    const declaredLength = Number(request.headers.get('Content-Length'));
    if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_JSON_REQUEST_CHARACTERS
    ) {
        return Effect.fail(new OpmlValidationError('document_size'));
    }

    return Effect.tryPromise({
        try: () => request.text(),
        catch: () => new OpmlValidationError('invalid_json'),
    }).pipe(
        Effect.flatMap((source) =>
            source.length > MAX_JSON_REQUEST_CHARACTERS
                ? Effect.fail(new OpmlValidationError('document_size'))
                : Effect.try({
                      try: () => JSON.parse(source) as unknown,
                      catch: () => new OpmlValidationError('invalid_json'),
                  }),
        ),
        Effect.flatMap((body) =>
            Schema.decodeUnknownEffect(schema, {
                onExcessProperty: 'error',
            })(body).pipe(
                Effect.mapError(() => new OpmlValidationError('invalid_body')),
            ),
        ),
    );
};

const parseImportId = (value: string | undefined) => {
    if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
        return Effect.fail(new OpmlValidationError('invalid_import_id'));
    }
    const id = Number(value);
    return Number.isSafeInteger(id)
        ? Effect.succeed(id)
        : Effect.fail(new OpmlValidationError('invalid_import_id'));
};

const sessionToken = (
    context: Parameters<typeof getCookie>[0],
    runtime: OpmlRouteRuntime,
) => getCookie(context, runtime.auth.config.sessionCookie.name);

const authenticate = (
    context: Parameters<typeof getCookie>[0],
    runtime: OpmlRouteRuntime,
): Effect.Effect<AuthenticatedSession, unknown> =>
    runtime.auth.service.authenticateSession(sessionToken(context, runtime));

const authorizeMutation = (
    context: Parameters<typeof getCookie>[0],
    runtime: OpmlRouteRuntime,
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

const rateLimit = (env: Env, userId: number, route: string) =>
    Effect.tryPromise({
        try: () =>
            env.AUTH_RATE_LIMITER.limit({ key: `opml:${route}:${userId}` }),
        catch: (cause) => cause,
    }).pipe(
        Effect.flatMap((outcome) =>
            outcome.success
                ? Effect.void
                : Effect.fail(new OpmlRateLimitedError()),
        ),
    );

export const registerOpmlRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: OpmlRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const factory =
        dependencies.runtimeFactory ?? defaultOpmlRouteRuntimeFactory;
    const runtime = (env: Env) => Effect.suspend(() => factory(env));

    app.post('/api/opml/imports', (context) =>
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
                Effect.tap(({ runtime: value }) =>
                    value.importEnabled
                        ? Effect.void
                        : Effect.fail(new OpmlFeatureDisabled()),
                ),
                Effect.tap(({ session }) =>
                    rateLimit(context.env, session.user.id, 'create'),
                ),
                Effect.bind('request', () =>
                    decodeJson(context.req.raw, CreateOpmlImportRequest),
                ),
                Effect.bind(
                    'response',
                    ({ runtime: value, session, request }) =>
                        Effect.tryPromise({
                            try: () =>
                                value.orchestrator.createImport(
                                    session.user.id,
                                    request.opml,
                                    request.filename,
                                ),
                            catch: (cause) => cause,
                        }),
                ),
                Effect.tap(({ runtime: value, response }) =>
                    response.totalItems === 0
                        ? Effect.void
                        : Effect.tryPromise({
                              try: () =>
                                  value.orchestrator.dispatchOutbox(
                                      Math.min(10, response.totalItems),
                                  ),
                              catch: (cause) => cause,
                          }).pipe(Effect.catchCause(() => Effect.void)),
                ),
                Effect.flatMap(({ response }) =>
                    jsonResponse(OpmlImportResponse, response, 202),
                ),
            ),
        ),
    );

    app.get('/api/opml/imports', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.bindTo('runtime'),
                Effect.bind('session', ({ runtime: value }) =>
                    authenticate(context, value),
                ),
                Effect.tap(({ session }) =>
                    rateLimit(context.env, session.user.id, 'read'),
                ),
                Effect.bind('imports', ({ runtime: value, session }) =>
                    Effect.tryPromise({
                        try: () =>
                            value.orchestrator.listImports(session.user.id),
                        catch: (cause) => cause,
                    }),
                ),
                Effect.flatMap(({ imports }) =>
                    jsonResponse(
                        OpmlImportListResponse,
                        OpmlImportListResponse.make({ imports: [...imports] }),
                    ),
                ),
            ),
        ),
    );

    app.get('/api/opml/imports/:id', (context) =>
        runRoute(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.bindTo('runtime'),
                Effect.bind('session', ({ runtime: value }) =>
                    authenticate(context, value),
                ),
                Effect.tap(({ session }) =>
                    rateLimit(context.env, session.user.id, 'read'),
                ),
                Effect.bind('importId', () =>
                    parseImportId(context.req.param('id')),
                ),
                Effect.bind(
                    'response',
                    ({ runtime: value, session, importId }) =>
                        Effect.tryPromise({
                            try: () =>
                                value.orchestrator.getImport(
                                    session.user.id,
                                    importId,
                                ),
                            catch: (cause) => cause,
                        }).pipe(
                            Effect.flatMap((response) =>
                                response === null
                                    ? Effect.fail(new OpmlNotFoundError())
                                    : Effect.succeed(response),
                            ),
                        ),
                ),
                Effect.flatMap(({ response }) =>
                    jsonResponse(OpmlImportResponse, response),
                ),
            ),
        ),
    );

    for (const path of ['/api/opml/export', '/export'] as const) {
        app.get(path, (context) =>
            runRoute(
                context.req.raw,
                runtime(context.env).pipe(
                    Effect.bindTo('runtime'),
                    Effect.bind('session', ({ runtime: value }) =>
                        authenticate(context, value),
                    ),
                    Effect.tap(({ session }) =>
                        rateLimit(context.env, session.user.id, 'export'),
                    ),
                    Effect.bind('document', ({ runtime: value, session }) =>
                        Effect.tryPromise({
                            try: () =>
                                value.orchestrator.exportOpml(session.user.id),
                            catch: (cause) => cause,
                        }),
                    ),
                    Effect.map(
                        ({ document }) =>
                            new Response(document, {
                                status: 200,
                                headers: {
                                    'cache-control': 'no-store',
                                    'content-disposition':
                                        'attachment; filename="feeds.opml"',
                                    'content-type':
                                        'application/xml; charset=UTF-8',
                                },
                            }),
                    ),
                ),
            ),
        );
    }

    return app;
};

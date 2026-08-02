import { Effect, Schema } from 'effect';
import { Hono } from 'hono';
import {
    type ApiErrorCode,
    ApiErrorResponse,
    HealthResponse,
} from '../shared/http';
import { type AuthRouteDependencies, registerAuthRoutes } from './auth/routes';
import {
    type ChartRouteDependencies,
    registerChartRoutes,
} from './charts/routes';
import {
    type CompatibilityRouteDependencies,
    registerCompatibilityRoutes,
} from './compat';
import { type ImageRouteDependencies, registerImageRoutes } from './images';
import { type OpmlRouteDependencies, registerOpmlRoutes } from './opml/routes';
import {
    type ReaderRouteDependencies,
    registerReaderRoutes,
} from './reader/routes';
import {
    type RefreshRouteDependencies,
    registerRefreshRoutes,
} from './refresh/routes';
import {
    registerSubscriptionRoutes,
    type SubscriptionRouteDependencies,
} from './subscriptions/routes';
import {
    registerSummaryRoutes,
    type SummaryRouteDependencies,
} from './summaries';

const jsonHeaders = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;

const rateLimitedAuthPaths = new Set([
    '/api/auth/authentication/options',
    '/api/auth/authentication/verify',
    '/api/auth/access/registration/options',
    '/api/auth/access/registration/verify',
    '/api/auth/passkeys/registration/options',
    '/api/auth/passkeys/registration/verify',
    '/api/auth/operator/access-link',
]);

export class HealthCheckUnavailable extends Schema.TaggedErrorClass<HealthCheckUnavailable>()(
    'HealthCheckUnavailable',
    {},
) {}

class ResponseEncodingError extends Schema.TaggedErrorClass<ResponseEncodingError>()(
    'ResponseEncodingError',
    {
        operation: Schema.Literals(['health', 'apiError']),
        cause: Schema.Defect(),
    },
) {}

export interface WorkerDependencies {
    readonly healthCheck: () => Effect.Effect<
        HealthResponse,
        HealthCheckUnavailable
    >;
    readonly authRoutes?: AuthRouteDependencies;
    readonly chartRoutes?: ChartRouteDependencies;
    readonly compatibilityRoutes?: CompatibilityRouteDependencies;
    readonly imageRoutes?: ImageRouteDependencies;
    readonly opmlRoutes?: OpmlRouteDependencies;
    readonly readerRoutes?: ReaderRouteDependencies;
    readonly refreshRoutes?: RefreshRouteDependencies;
    readonly summaryRoutes?: SummaryRouteDependencies;
    readonly subscriptionRoutes?: SubscriptionRouteDependencies;
}

const defaultDependencies: WorkerDependencies = {
    healthCheck: () => Effect.succeed(HealthResponse.make({ status: 'ok' })),
};

const fallbackInternalServerError = () =>
    new Response(
        '{"error":{"code":"internal_server_error","message":"Internal server error"}}',
        {
            status: 500,
            headers: jsonHeaders,
        },
    );

const makeJsonResponse = (
    body: unknown,
    status: number,
    operation: 'health' | 'apiError',
) =>
    Effect.try({
        try: () => Response.json(body, { status, headers: jsonHeaders }),
        catch: (cause) => new ResponseEncodingError({ operation, cause }),
    });

const encodeHealthResponse = Schema.encodeUnknownEffect(HealthResponse);
const encodeApiErrorResponse = Schema.encodeUnknownEffect(ApiErrorResponse);

const makeApiErrorResponse = (
    code: ApiErrorCode,
    message: string,
    status: number,
) =>
    encodeApiErrorResponse(
        ApiErrorResponse.make({
            error: { code, message },
        }),
    ).pipe(
        Effect.mapError(
            (cause) =>
                new ResponseEncodingError({
                    operation: 'apiError',
                    cause,
                }),
        ),
        Effect.flatMap((body) => makeJsonResponse(body, status, 'apiError')),
        Effect.catchTag('ResponseEncodingError', () =>
            Effect.succeed(fallbackInternalServerError()),
        ),
    );

const makeHealthRequest = Effect.fn('worker.health')(function* (
    dependencies: WorkerDependencies,
) {
    const health = yield* dependencies.healthCheck();
    const body = yield* encodeHealthResponse(health).pipe(
        Effect.mapError(
            (cause) =>
                new ResponseEncodingError({
                    operation: 'health',
                    cause,
                }),
        ),
    );

    return yield* makeJsonResponse(body, 200, 'health');
});

const mapRequestErrors = (
    program: ReturnType<typeof makeHealthRequest>,
): Effect.Effect<Response> =>
    program.pipe(
        Effect.catchTags({
            HealthCheckUnavailable: () =>
                makeApiErrorResponse(
                    'service_unavailable',
                    'Service unavailable',
                    503,
                ),
            ResponseEncodingError: () =>
                Effect.succeed(fallbackInternalServerError()),
        }),
    );

export const createApp = (
    dependencies: WorkerDependencies = defaultDependencies,
) => {
    const app = new Hono<{ Bindings: Env }>();

    app.use('/api/auth/*', async (context, next) => {
        if (
            context.req.method !== 'POST' ||
            !rateLimitedAuthPaths.has(context.req.path)
        ) {
            return next();
        }

        try {
            const outcome = await context.env.AUTH_RATE_LIMITER.limit({
                key:
                    context.req.header('CF-Connecting-IP') ??
                    'local-development',
            });
            if (!outcome.success) {
                return new Response(
                    '{"error":{"code":"rate_limited","message":"Too many requests"}}',
                    { status: 429, headers: jsonHeaders },
                );
            }
        } catch {
            return new Response(
                '{"error":{"code":"service_unavailable","message":"Service unavailable"}}',
                { status: 503, headers: jsonHeaders },
            );
        }

        return next();
    });

    app.get('/api/health', (context) => {
        const program = mapRequestErrors(makeHealthRequest(dependencies));

        return Effect.runPromise(program, {
            signal: context.req.raw.signal,
        });
    });

    registerAuthRoutes(app, dependencies.authRoutes);
    registerChartRoutes(app, dependencies.chartRoutes);
    registerCompatibilityRoutes(app, dependencies.compatibilityRoutes);
    registerImageRoutes(app, dependencies.imageRoutes);
    registerReaderRoutes(app, dependencies.readerRoutes);
    registerRefreshRoutes(app, dependencies.refreshRoutes);
    registerOpmlRoutes(app, dependencies.opmlRoutes);
    registerSummaryRoutes(app, dependencies.summaryRoutes);
    registerSubscriptionRoutes(app, dependencies.subscriptionRoutes);

    app.onError(() => fallbackInternalServerError());

    return app;
};

export const app = createApp();

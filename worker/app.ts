import { Effect, Schema } from 'effect';
import { Hono } from 'hono';

import {
    type ApiErrorCode,
    ApiErrorResponse,
    HealthResponse,
} from '../shared/http';

const jsonHeaders = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;

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
    const app = new Hono();

    app.get('/api/health', (context) => {
        const program = mapRequestErrors(makeHealthRequest(dependencies));

        return Effect.runPromise(program, {
            signal: context.req.raw.signal,
        });
    });

    app.onError(() => fallbackInternalServerError());

    return app;
};

export const app = createApp();

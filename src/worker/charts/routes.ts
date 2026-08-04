import { ApiErrorResponse, ChartResponse } from '@shared/http';
import { Cause, Effect, Schema } from 'effect';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, makeDefaultAuthRuntime } from '../auth/routes';
import { makeD1 } from '../infrastructure/d1';
import { ChartValidationError } from './errors';
import { type ChartScopeInput, makeChartRepository } from './repository';
import { type ChartService, makeChartService } from './service';

const DAY_MS = 24 * 60 * 60_000;
const MAX_DAYS = 366;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const allowedQueryKeys = new Set([
    'range',
    'feed_id',
    'category_id',
    'start_date',
    'end_date',
]);
const headers = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;

export interface ChartRuntime {
    readonly auth: AuthRuntime;
    readonly service: ChartService;
    readonly now: () => number;
}

export type ChartRuntimeFactory = (
    env: Env,
) => Effect.Effect<ChartRuntime, unknown>;

export interface ChartRouteDependencies {
    readonly runtimeFactory?: ChartRuntimeFactory;
}

export const defaultChartRuntimeFactory: ChartRuntimeFactory = (env) => {
    const d1 = makeD1(env.DB);
    return makeDefaultAuthRuntime(env, d1).pipe(
        Effect.map((auth) => ({
            auth,
            service: makeChartService({
                repository: makeChartRepository(d1),
            }),
            now: Date.now,
        })),
    );
};

export interface ParsedChartQuery {
    readonly startAt: number;
    readonly endAt: number;
    readonly scope: ChartScopeInput;
}

const parseId = (value: string | null): number | null => {
    if (value === null) return null;
    if (!/^[1-9]\d*$/u.test(value)) throw new ChartValidationError();
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new ChartValidationError();
    return parsed;
};
const parseDate = (value: string | null): number => {
    if (value === null || !DATE_PATTERN.test(value)) {
        throw new ChartValidationError();
    }
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed) || dateString(parsed) !== value) {
        throw new ChartValidationError();
    }
    return parsed;
};
const utcToday = (now: number): number => {
    const value = new Date(now);
    return Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
    );
};
const dateString = (timestamp: number): string =>
    new Date(timestamp).toISOString().slice(0, 10);

export const parseChartQuery = (
    request: Request,
    now: number,
): Effect.Effect<ParsedChartQuery, ChartValidationError> =>
    Effect.try({
        try: () => {
            const search = new URL(request.url).searchParams;
            for (const key of search.keys()) {
                if (
                    !allowedQueryKeys.has(key) ||
                    search.getAll(key).length !== 1
                ) {
                    throw new ChartValidationError();
                }
            }
            const feedId = parseId(search.get('feed_id'));
            const categoryId = parseId(search.get('category_id'));
            if (feedId !== null && categoryId !== null) {
                throw new ChartValidationError();
            }
            const scope: ChartScopeInput =
                feedId !== null
                    ? { type: 'feed', id: feedId }
                    : categoryId !== null
                      ? { type: 'category', id: categoryId }
                      : { type: 'all' };
            const range = search.get('range') ?? '30';
            const startDate = search.get('start_date');
            const endDate = search.get('end_date');
            const today = utcToday(now);
            if (range === 'custom') {
                const startAt = parseDate(startDate);
                const inclusiveEnd = parseDate(endDate);
                if (inclusiveEnd < startAt || inclusiveEnd > today) {
                    throw new ChartValidationError();
                }
                const endAt = inclusiveEnd + DAY_MS;
                const dayCount = (endAt - startAt) / DAY_MS;
                if (dayCount < 1 || dayCount > MAX_DAYS) {
                    throw new ChartValidationError();
                }
                return { startAt, endAt, scope };
            }
            if (
                (range !== '30' && range !== '90' && range !== '365') ||
                startDate !== null ||
                endDate !== null
            ) {
                throw new ChartValidationError();
            }
            const days = Number(range);
            return {
                startAt: today - (days - 1) * DAY_MS,
                endAt: today + DAY_MS,
                scope,
            };
        },
        catch: () => new ChartValidationError(),
    });

interface SafeError {
    readonly code:
        | 'validation_error'
        | 'unauthenticated'
        | 'not_found'
        | 'service_unavailable'
        | 'internal_server_error';
    readonly message: string;
    readonly status: number;
}
const tag = (error: unknown): string | undefined =>
    typeof error === 'object' && error !== null
        ? typeof Reflect.get(error, '_tag') === 'string'
            ? (Reflect.get(error, '_tag') as string)
            : undefined
        : undefined;
const safeError = (error: unknown): SafeError => {
    switch (tag(error)) {
        case 'ChartValidationError':
            return {
                code: 'validation_error',
                message: 'Invalid chart query',
                status: 400,
            };
        case 'Unauthenticated':
            return {
                code: 'unauthenticated',
                message: 'Authentication required',
                status: 401,
            };
        case 'ChartNotFound':
            return { code: 'not_found', message: 'Not found', status: 404 };
        case 'ChartStorageError':
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
const apiError = (error: unknown): Response => {
    const safe = safeError(error);
    try {
        const body = Schema.encodeUnknownSync(ApiErrorResponse)(
            ApiErrorResponse.make({
                error: { code: safe.code, message: safe.message },
            }),
        );
        return new Response(JSON.stringify(body), {
            status: safe.status,
            headers,
        });
    } catch {
        return new Response(
            '{"error":{"code":"internal_server_error","message":"Internal server error"}}',
            { status: 500, headers },
        );
    }
};
const run = (request: Request, program: Effect.Effect<Response, unknown>) =>
    Effect.runPromise(
        program.pipe(
            Effect.catchCause((cause) =>
                Effect.succeed(apiError(Cause.squash(cause))),
            ),
        ),
        { signal: request.signal },
    );

export const registerChartRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: ChartRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const factory = dependencies.runtimeFactory ?? defaultChartRuntimeFactory;
    const runtime = (env: Env) => Effect.suspend(() => factory(env));

    app.get('/api/charts', (context) =>
        run(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    value.auth.service
                        .authenticateSession(
                            getCookie(
                                context,
                                value.auth.config.sessionCookie.name,
                            ),
                        )
                        .pipe(
                            Effect.flatMap((session) =>
                                parseChartQuery(
                                    context.req.raw,
                                    value.now(),
                                ).pipe(
                                    Effect.flatMap((query) =>
                                        value.service.getCharts({
                                            userId: session.user.id,
                                            ...query,
                                        }),
                                    ),
                                ),
                            ),
                        ),
                ),
                Effect.flatMap((response) =>
                    Schema.encodeUnknownEffect(ChartResponse)(response),
                ),
                Effect.map(
                    (body) =>
                        new Response(JSON.stringify(body), {
                            status: 200,
                            headers,
                        }),
                ),
            ),
        ),
    );

    return app;
};

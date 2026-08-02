import { ApiErrorResponse, ChartResponse } from '@shared/http';
import type { ChartRange } from '@shared/schemas/charts';
import { Effect, Schema } from 'effect';

export type ChartData = typeof ChartResponse.Type;
export type ChartClientErrorKind = 'transport' | 'status' | 'decode';

export interface ChartRequest {
    readonly range: ChartRange;
    readonly feedId: number | null;
    readonly categoryId: number | null;
    readonly startDate: string | null;
    readonly endDate: string | null;
}

export class ChartClientError extends Error {
    readonly _tag = 'ChartClientError';

    constructor(
        readonly kind: ChartClientErrorKind,
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'ChartClientError';
    }
}

const readJson = (response: Response) =>
    Effect.tryPromise({
        try: async () => {
            const value: unknown = await response.json();
            return value;
        },
        catch: (cause) =>
            new ChartClientError(
                'decode',
                'The chart service returned invalid JSON.',
                response.status,
                undefined,
                cause,
            ),
    });

const statusError = (response: Response, body: unknown) =>
    Schema.decodeUnknownEffect(ApiErrorResponse)(body).pipe(
        Effect.match({
            onFailure: () =>
                new ChartClientError(
                    'status',
                    `The chart service returned status ${response.status}.`,
                    response.status,
                ),
            onSuccess: ({ error }) =>
                new ChartClientError(
                    'status',
                    error.message,
                    response.status,
                    error.code,
                ),
        }),
    );

export const getCharts = Effect.fn('ChartClient.getCharts')(
    (input: ChartRequest) =>
        Effect.gen(function* () {
            const query = new URLSearchParams({ range: input.range });
            if (input.feedId !== null) {
                query.set('feed_id', String(input.feedId));
            } else if (input.categoryId !== null) {
                query.set('category_id', String(input.categoryId));
            }
            if (
                input.range === 'custom' &&
                input.startDate !== null &&
                input.endDate !== null
            ) {
                query.set('start_date', input.startDate);
                query.set('end_date', input.endDate);
            }
            const response = yield* Effect.tryPromise({
                try: (signal) =>
                    fetch(`/api/charts?${query.toString()}`, {
                        method: 'GET',
                        credentials: 'same-origin',
                        headers: { Accept: 'application/json' },
                        signal,
                    }),
                catch: (cause) =>
                    new ChartClientError(
                        'transport',
                        'The chart service is unavailable.',
                        undefined,
                        undefined,
                        cause,
                    ),
            });
            const body = yield* readJson(response);
            if (!response.ok) {
                return yield* Effect.fail(yield* statusError(response, body));
            }
            return yield* Schema.decodeUnknownEffect(ChartResponse)(body).pipe(
                Effect.mapError(
                    (cause) =>
                        new ChartClientError(
                            'decode',
                            'The chart response has an invalid shape.',
                            response.status,
                            undefined,
                            cause,
                        ),
                ),
            );
        }),
);

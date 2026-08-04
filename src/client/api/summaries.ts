import { ApiErrorResponse, EntrySummaryResponse } from '@shared/http';
import { Effect, Schema } from 'effect';

export type EntrySummaryResult = typeof EntrySummaryResponse.Type;

export type SummaryClientErrorKind = 'transport' | 'status' | 'decode';

export class SummaryClientError extends Error {
    readonly _tag = 'SummaryClientError';

    constructor(
        readonly kind: SummaryClientErrorKind,
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'SummaryClientError';
    }
}

interface RequestOptions {
    readonly method?: 'GET' | 'POST';
    readonly csrfToken?: string;
}

const readJson = (response: Response) =>
    Effect.tryPromise({
        try: async () => {
            const json: unknown = await response.json();
            return json;
        },
        catch: (cause) =>
            new SummaryClientError(
                'decode',
                'The summary service returned invalid JSON.',
                response.status,
                undefined,
                cause,
            ),
    });

const statusError = (response: Response, body: unknown) =>
    Schema.decodeUnknownEffect(ApiErrorResponse)(body).pipe(
        Effect.match({
            onFailure: () =>
                new SummaryClientError(
                    'status',
                    `The summary service returned status ${response.status}.`,
                    response.status,
                ),
            onSuccess: ({ error }) =>
                new SummaryClientError(
                    'status',
                    error.message,
                    response.status,
                    error.code,
                ),
        }),
    );

const request = (
    entryId: number,
    options: RequestOptions = {},
): Effect.Effect<EntrySummaryResult, SummaryClientError> =>
    Effect.gen(function* () {
        const method = options.method ?? 'GET';
        const response = yield* Effect.tryPromise({
            try: (signal) =>
                fetch(`/api/entries/${entryId}/summary`, {
                    method,
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json',
                        ...(method === 'POST'
                            ? { 'Content-Type': 'application/json' }
                            : {}),
                        ...(options.csrfToken === undefined
                            ? {}
                            : { 'X-CSRF-Token': options.csrfToken }),
                    },
                    ...(method === 'POST' ? { body: '{}' } : {}),
                    signal,
                }),
            catch: (cause) =>
                new SummaryClientError(
                    'transport',
                    'The summary service is unavailable.',
                    undefined,
                    undefined,
                    cause,
                ),
        });
        const body = yield* readJson(response);
        if (!response.ok) {
            return yield* Effect.fail(yield* statusError(response, body));
        }
        return yield* Schema.decodeUnknownEffect(EntrySummaryResponse)(
            body,
        ).pipe(
            Effect.mapError(
                (cause) =>
                    new SummaryClientError(
                        'decode',
                        'The summary response has an invalid shape.',
                        response.status,
                        undefined,
                        cause,
                    ),
            ),
        );
    });

export const getEntrySummary = Effect.fn('SummaryClient.get')(
    (entryId: number) => request(entryId),
);

export const generateEntrySummary = Effect.fn('SummaryClient.generate')(
    (entryId: number, csrfToken: string) =>
        request(entryId, { method: 'POST', csrfToken }),
);

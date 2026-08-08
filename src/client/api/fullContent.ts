import { ApiErrorResponse, EntryFullContentResponse } from '@shared/http';
import { Effect, Schema } from 'effect';

export type EntryFullContentResult = typeof EntryFullContentResponse.Type;

export type FullContentClientErrorKind = 'transport' | 'status' | 'decode';

export class FullContentClientError extends Error {
    readonly _tag = 'FullContentClientError';

    constructor(
        readonly kind: FullContentClientErrorKind,
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'FullContentClientError';
    }
}

interface RequestOptions {
    readonly method?: 'GET' | 'POST';
    readonly path?: string;
    readonly csrfToken?: string;
}

const readJson = (response: Response) =>
    Effect.tryPromise({
        try: async () => {
            const json: unknown = await response.json();
            return json;
        },
        catch: (cause) =>
            new FullContentClientError(
                'decode',
                'The full article service returned invalid JSON.',
                response.status,
                undefined,
                cause,
            ),
    });

const statusError = (response: Response, body: unknown) =>
    Schema.decodeUnknownEffect(ApiErrorResponse)(body).pipe(
        Effect.match({
            onFailure: () =>
                new FullContentClientError(
                    'status',
                    `The full article service returned status ${response.status}.`,
                    response.status,
                ),
            onSuccess: ({ error }) =>
                new FullContentClientError(
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
): Effect.Effect<EntryFullContentResult, FullContentClientError> =>
    Effect.gen(function* () {
        const method = options.method ?? 'GET';
        const path = options.path ?? '';
        const response = yield* Effect.tryPromise({
            try: (signal) =>
                fetch(`/api/entries/${entryId}/full-content${path}`, {
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
                new FullContentClientError(
                    'transport',
                    'The full article service is unavailable.',
                    undefined,
                    undefined,
                    cause,
                ),
        });
        const body = yield* readJson(response);
        if (!response.ok) {
            return yield* Effect.fail(yield* statusError(response, body));
        }
        return yield* Schema.decodeUnknownEffect(EntryFullContentResponse)(
            body,
        ).pipe(
            Effect.mapError(
                (cause) =>
                    new FullContentClientError(
                        'decode',
                        'The full article response has an invalid shape.',
                        response.status,
                        undefined,
                        cause,
                    ),
            ),
        );
    });

export const getEntryFullContent = Effect.fn('FullContentClient.get')(
    (entryId: number) => request(entryId),
);

export const fetchEntryFullContent = Effect.fn('FullContentClient.fetch')(
    (entryId: number, csrfToken: string) =>
        request(entryId, { method: 'POST', csrfToken }),
);

export const summarizeEntryFullContent = Effect.fn(
    'FullContentClient.summarize',
)((entryId: number, csrfToken: string) =>
    request(entryId, { method: 'POST', path: '/summary', csrfToken }),
);

import { ApiErrorResponse } from '@shared/http';
import {
    type CreateOpmlImportRequest,
    OpmlImportListResponse,
    OpmlImportResponse,
} from '@shared/schemas/opml';
import { Effect, Schema } from 'effect';

export type OpmlImport = typeof OpmlImportResponse.Type;
export type OpmlImportList = typeof OpmlImportListResponse.Type;

export interface CreateOpmlImportInput {
    readonly opml: typeof CreateOpmlImportRequest.Type.opml;
    readonly filename?: typeof CreateOpmlImportRequest.Type.filename;
    readonly csrfToken: string;
}

export type OpmlClientErrorKind = 'transport' | 'status' | 'decode';

export class OpmlClientError extends Error {
    readonly _tag = 'OpmlClientError';

    constructor(
        readonly kind: OpmlClientErrorKind,
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'OpmlClientError';
    }
}

interface JsonRequestOptions {
    readonly method?: 'GET' | 'POST';
    readonly body?: typeof CreateOpmlImportRequest.Type;
    readonly csrfToken?: string;
}

const readJson = (response: Response) =>
    Effect.tryPromise({
        try: async () => {
            const json: unknown = await response.json();
            return json;
        },
        catch: (cause) =>
            new OpmlClientError(
                'decode',
                'The OPML service returned invalid JSON.',
                response.status,
                undefined,
                cause,
            ),
    });

const statusError = (response: Response, body: unknown) =>
    Schema.decodeUnknownEffect(ApiErrorResponse)(body).pipe(
        Effect.match({
            onFailure: () =>
                new OpmlClientError(
                    'status',
                    `The OPML service returned status ${response.status}.`,
                    response.status,
                ),
            onSuccess: ({ error }) =>
                new OpmlClientError(
                    'status',
                    error.message,
                    response.status,
                    error.code,
                ),
        }),
    );

const requestJson = <A>(
    path: string,
    schema: Schema.Decoder<A, never>,
    options: JsonRequestOptions = {},
): Effect.Effect<A, OpmlClientError> =>
    Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
            try: (signal) =>
                fetch(path, {
                    method: options.method ?? 'GET',
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json',
                        ...(options.body === undefined
                            ? {}
                            : { 'Content-Type': 'application/json' }),
                        ...(options.csrfToken === undefined
                            ? {}
                            : { 'X-CSRF-Token': options.csrfToken }),
                    },
                    ...(options.body === undefined
                        ? {}
                        : { body: JSON.stringify(options.body) }),
                    signal,
                }),
            catch: (cause) =>
                new OpmlClientError(
                    'transport',
                    'The OPML service is unavailable.',
                    undefined,
                    undefined,
                    cause,
                ),
        });

        const body = yield* readJson(response);

        if (!response.ok) {
            return yield* Effect.fail(yield* statusError(response, body));
        }

        return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
            Effect.mapError(
                (cause) =>
                    new OpmlClientError(
                        'decode',
                        'The OPML response has an invalid shape.',
                        response.status,
                        undefined,
                        cause,
                    ),
            ),
        );
    });

export const createOpmlImport = Effect.fn('OpmlClient.createImport')(
    (input: CreateOpmlImportInput) =>
        requestJson('/api/opml/imports', OpmlImportResponse, {
            method: 'POST',
            body: {
                opml: input.opml,
                ...(input.filename === undefined
                    ? {}
                    : { filename: input.filename }),
            },
            csrfToken: input.csrfToken,
        }),
);

export const listOpmlImports = Effect.fn('OpmlClient.listImports')(() =>
    requestJson('/api/opml/imports', OpmlImportListResponse),
);

export const getOpmlImport = Effect.fn('OpmlClient.getImport')(
    (importId: number) =>
        requestJson(`/api/opml/imports/${importId}`, OpmlImportResponse),
);

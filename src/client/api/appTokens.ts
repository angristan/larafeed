import { ApiErrorResponse } from '@shared/http';
import {
    AppTokenListResponse,
    type AppTokenScope,
    type CreateAppTokenRequest,
    CreatedAppTokenResponse,
} from '@shared/schemas/auth';
import { Effect, Schema } from 'effect';

export type AppToken = (typeof AppTokenListResponse.Type.tokens)[number];
export type CreatedAppToken = typeof CreatedAppTokenResponse.Type;

export interface CreateAppTokenInput {
    readonly name: typeof CreateAppTokenRequest.Type.name;
    readonly scopes: readonly AppTokenScope[];
    readonly csrfToken: string;
}

export interface RevokeAppTokenInput {
    readonly tokenId: number;
    readonly csrfToken: string;
}

export type AppTokenClientErrorKind = 'transport' | 'status' | 'decode';

export class AppTokenClientError extends Error {
    readonly _tag = 'AppTokenClientError';

    constructor(
        readonly kind: AppTokenClientErrorKind,
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'AppTokenClientError';
    }
}

interface JsonRequestOptions {
    readonly method?: 'GET' | 'POST';
    readonly body?: typeof CreateAppTokenRequest.Type;
    readonly csrfToken?: string;
}

const readJson = (response: Response) =>
    Effect.tryPromise({
        try: async () => {
            const json: unknown = await response.json();
            return json;
        },
        catch: (cause) =>
            new AppTokenClientError(
                'decode',
                'The app token service returned invalid JSON.',
                response.status,
                undefined,
                cause,
            ),
    });

const statusError = (response: Response, body: unknown) =>
    Schema.decodeUnknownEffect(ApiErrorResponse)(body).pipe(
        Effect.match({
            onFailure: () =>
                new AppTokenClientError(
                    'status',
                    `The app token service returned status ${response.status}.`,
                    response.status,
                ),
            onSuccess: ({ error }) =>
                new AppTokenClientError(
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
): Effect.Effect<A, AppTokenClientError> =>
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
                new AppTokenClientError(
                    'transport',
                    'The app token service is unavailable.',
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
                    new AppTokenClientError(
                        'decode',
                        'The app token response has an invalid shape.',
                        response.status,
                        undefined,
                        cause,
                    ),
            ),
        );
    });

export const listAppTokens = Effect.fn('AppTokenClient.list')(() =>
    requestJson('/api/auth/app-tokens', AppTokenListResponse),
);

export const createAppToken = Effect.fn('AppTokenClient.create')(
    (input: CreateAppTokenInput) =>
        requestJson('/api/auth/app-tokens', CreatedAppTokenResponse, {
            method: 'POST',
            body: { name: input.name, scopes: input.scopes },
            csrfToken: input.csrfToken,
        }),
);

export const revokeAppToken = Effect.fn('AppTokenClient.revoke')(
    (input: RevokeAppTokenInput) =>
        Effect.gen(function* () {
            const response = yield* Effect.tryPromise({
                try: (signal) =>
                    fetch(`/api/auth/app-tokens/${input.tokenId}`, {
                        method: 'DELETE',
                        credentials: 'same-origin',
                        headers: {
                            Accept: 'application/json',
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': input.csrfToken,
                        },
                        signal,
                    }),
                catch: (cause) =>
                    new AppTokenClientError(
                        'transport',
                        'The app token service is unavailable.',
                        undefined,
                        undefined,
                        cause,
                    ),
            });

            if (response.ok) {
                return;
            }

            const body = yield* readJson(response);
            return yield* Effect.fail(yield* statusError(response, body));
        }),
);

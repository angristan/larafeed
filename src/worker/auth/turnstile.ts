import { Effect, Schema } from 'effect';

export const TURNSTILE_SITEVERIFY_URL =
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;
const TURNSTILE_RETRY_COUNT = 2;

type Fetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Response>;

export interface TurnstileValidatorOptions {
    readonly secretKey: string;
    readonly expectedHostname: string;
    readonly fetch?: Fetch;
    readonly webCrypto?: Crypto;
}

export interface TurnstileVerificationInput {
    readonly token: string;
    readonly remoteIp?: string;
    readonly expectedAction: string;
}

export interface TurnstileVerification {
    readonly hostname: string;
    readonly action: string;
    readonly challengeTimestamp?: string;
}

const RequestKind = Schema.Literals([
    'idempotency',
    'transport',
    'server',
    'http',
]);

export class TurnstileInputError extends Schema.TaggedError<TurnstileInputError>()(
    'TurnstileInputError',
    {
        field: Schema.Literals(['token', 'remoteIp', 'expectedAction']),
        reason: Schema.Literals(['invalid', 'too_long']),
    },
) {}

export class TurnstileRequestError extends Schema.TaggedError<TurnstileRequestError>()(
    'TurnstileRequestError',
    {
        kind: RequestKind,
        status: Schema.optionalKey(Schema.Int),
    },
) {}

export class TurnstileResponseError extends Schema.TaggedError<TurnstileResponseError>()(
    'TurnstileResponseError',
    {
        reason: Schema.Literals(['invalid_json', 'invalid_schema']),
    },
) {}

export class TurnstileRejectedError extends Schema.TaggedError<TurnstileRejectedError>()(
    'TurnstileRejectedError',
    {
        reason: Schema.Literals([
            'provider_rejected',
            'hostname_mismatch',
            'action_mismatch',
        ]),
        errorCodes: Schema.Array(Schema.String),
    },
) {}

export type TurnstileError =
    | TurnstileInputError
    | TurnstileRequestError
    | TurnstileResponseError
    | TurnstileRejectedError;

export interface TurnstileValidator {
    readonly verify: (
        input: TurnstileVerificationInput,
    ) => Effect.Effect<TurnstileVerification, TurnstileError>;
}

const VerificationInputSchema = Schema.Struct({
    token: Schema.String.check(
        Schema.isMinLength(1),
        Schema.isMaxLength(TURNSTILE_TOKEN_MAX_LENGTH),
    ),
    remoteIp: Schema.optionalKey(
        Schema.String.check(Schema.isLengthBetween(1, 128)),
    ),
    expectedAction: Schema.String.check(Schema.isLengthBetween(1, 128)),
});

const SiteverifyResponseSchema = Schema.Struct({
    success: Schema.Boolean,
    challenge_ts: Schema.optionalKey(Schema.String),
    hostname: Schema.optionalKey(Schema.String),
    'error-codes': Schema.optionalKey(Schema.Array(Schema.String)),
    action: Schema.optionalKey(Schema.String),
    cdata: Schema.optionalKey(Schema.String),
    metadata: Schema.optionalKey(
        Schema.Struct({
            ephemeral_id: Schema.optionalKey(Schema.String),
        }),
    ),
});

const decodeVerificationInput = Schema.decodeUnknownEffect(
    VerificationInputSchema,
    { onExcessProperty: 'error' },
);
const decodeSiteverifyResponse = Schema.decodeUnknownEffect(
    SiteverifyResponseSchema,
    { onExcessProperty: 'ignore' },
);

const inputError = (
    field: 'token' | 'remoteIp' | 'expectedAction',
    reason: 'invalid' | 'too_long',
) => new TurnstileInputError({ field, reason });

const validateInput = (input: unknown) => {
    if (typeof input !== 'object' || input === null) {
        return Effect.fail(inputError('token', 'invalid'));
    }

    const token = Reflect.get(input, 'token');
    if (typeof token !== 'string' || token.length === 0) {
        return Effect.fail(inputError('token', 'invalid'));
    }
    if (token.length > TURNSTILE_TOKEN_MAX_LENGTH) {
        return Effect.fail(inputError('token', 'too_long'));
    }

    const remoteIp = Reflect.get(input, 'remoteIp');
    if (
        remoteIp !== undefined &&
        (typeof remoteIp !== 'string' ||
            remoteIp.length === 0 ||
            remoteIp.length > 128)
    ) {
        return Effect.fail(inputError('remoteIp', 'invalid'));
    }

    const expectedAction = Reflect.get(input, 'expectedAction');
    if (
        typeof expectedAction !== 'string' ||
        expectedAction.length === 0 ||
        expectedAction.length > 128
    ) {
        return Effect.fail(inputError('expectedAction', 'invalid'));
    }

    return decodeVerificationInput(input).pipe(
        Effect.mapError(() => inputError('token', 'invalid')),
    );
};

const makeRequest = (
    fetchImplementation: Fetch,
    secretKey: string,
    input: typeof VerificationInputSchema.Type,
    idempotencyKey: string,
): Effect.Effect<
    typeof SiteverifyResponseSchema.Type,
    TurnstileRequestError | TurnstileResponseError
> =>
    Effect.tryPromise({
        try: (signal) => {
            const body = new URLSearchParams({
                secret: secretKey,
                response: input.token,
                idempotency_key: idempotencyKey,
            });

            if (input.remoteIp !== undefined) {
                body.set('remoteip', input.remoteIp);
            }

            return fetchImplementation(TURNSTILE_SITEVERIFY_URL, {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                },
                body,
                signal,
            });
        },
        catch: () =>
            new TurnstileRequestError({
                kind: 'transport',
            }),
    }).pipe(
        Effect.flatMap(
            (
                response,
            ): Effect.Effect<
                unknown,
                TurnstileRequestError | TurnstileResponseError
            > => {
                if (response.status >= 500) {
                    return Effect.fail(
                        new TurnstileRequestError({
                            kind: 'server',
                            status: response.status,
                        }),
                    );
                }

                if (!response.ok) {
                    return Effect.fail(
                        new TurnstileRequestError({
                            kind: 'http',
                            status: response.status,
                        }),
                    );
                }

                return Effect.tryPromise({
                    try: () => {
                        const body: Promise<unknown> = response.json();
                        return body;
                    },
                    catch: () =>
                        new TurnstileResponseError({ reason: 'invalid_json' }),
                });
            },
        ),
        Effect.flatMap((body) =>
            decodeSiteverifyResponse(body).pipe(
                Effect.mapError(
                    () =>
                        new TurnstileResponseError({
                            reason: 'invalid_schema',
                        }),
                ),
            ),
        ),
    );

const isRetryable = (
    error: TurnstileRequestError | TurnstileResponseError,
): boolean =>
    error._tag === 'TurnstileRequestError' &&
    (error.kind === 'transport' || error.kind === 'server');

export const makeTurnstileValidator = (
    options: TurnstileValidatorOptions,
): TurnstileValidator => {
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    const webCrypto = options.webCrypto ?? globalThis.crypto;

    const verify = Effect.fn('auth.turnstile.verify')(function* (
        untrustedInput: TurnstileVerificationInput,
    ) {
        const input = yield* validateInput(untrustedInput);
        const idempotencyKey = yield* Effect.try({
            try: () => webCrypto.randomUUID(),
            catch: () => new TurnstileRequestError({ kind: 'idempotency' }),
        });

        const response = yield* makeRequest(
            fetchImplementation,
            options.secretKey,
            input,
            idempotencyKey,
        ).pipe(
            Effect.retry({
                times: TURNSTILE_RETRY_COUNT,
                while: isRetryable,
            }),
        );

        const errorCodes = response['error-codes'] ?? [];

        if (!response.success) {
            return yield* Effect.fail(
                new TurnstileRejectedError({
                    reason: 'provider_rejected',
                    errorCodes,
                }),
            );
        }

        if (response.hostname !== options.expectedHostname) {
            return yield* Effect.fail(
                new TurnstileRejectedError({
                    reason: 'hostname_mismatch',
                    errorCodes,
                }),
            );
        }

        if (response.action !== input.expectedAction) {
            return yield* Effect.fail(
                new TurnstileRejectedError({
                    reason: 'action_mismatch',
                    errorCodes,
                }),
            );
        }

        return {
            hostname: response.hostname,
            action: response.action,
            ...(response.challenge_ts === undefined
                ? {}
                : { challengeTimestamp: response.challenge_ts }),
        };
    });

    return { verify };
};

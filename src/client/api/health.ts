import { HealthResponse } from '@shared/schemas/health';
import { Effect, Schema } from 'effect';

export type Health = typeof HealthResponse.Type;

export type HealthClientErrorKind = 'transport' | 'status' | 'decode';

export class HealthClientError extends Error {
    readonly _tag = 'HealthClientError';

    constructor(
        readonly kind: HealthClientErrorKind,
        message: string,
        readonly status?: number,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'HealthClientError';
    }
}

export const getHealth = Effect.fn('HealthClient.getHealth')(function* () {
    const response = yield* Effect.tryPromise({
        try: (signal) =>
            fetch('/api/health', {
                headers: { Accept: 'application/json' },
                signal,
            }),
        catch: (cause) =>
            new HealthClientError(
                'transport',
                'The health endpoint is unavailable.',
                undefined,
                cause,
            ),
    });

    if (!response.ok) {
        return yield* Effect.fail(
            new HealthClientError(
                'status',
                `The health endpoint returned status ${response.status}.`,
                response.status,
            ),
        );
    }

    const body = yield* Effect.tryPromise({
        try: async () => {
            const json: unknown = await response.json();
            return json;
        },
        catch: (cause) =>
            new HealthClientError(
                'decode',
                'The health endpoint did not return valid JSON.',
                response.status,
                cause,
            ),
    });

    return yield* Schema.decodeUnknownEffect(HealthResponse)(body).pipe(
        Effect.mapError(
            (cause) =>
                new HealthClientError(
                    'decode',
                    'The health response has an invalid shape.',
                    response.status,
                    cause,
                ),
        ),
    );
});

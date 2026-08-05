import { Effect, Schema } from 'effect';

const RequestBodyErrorReasons = [
    'invalid_content_length',
    'too_large',
    'unreadable',
    'invalid_utf8',
    'invalid_json',
] as const;

export type RequestBodyErrorReason = (typeof RequestBodyErrorReasons)[number];

export class RequestBodyError extends Schema.TaggedErrorClass<RequestBodyError>()(
    'RequestBodyError',
    { reason: Schema.Literals(RequestBodyErrorReasons) },
) {}

const declaredBodyLength = (
    request: Request,
): Effect.Effect<number | undefined, RequestBodyError> => {
    const value = request.headers.get('content-length');
    if (value === null) return Effect.succeed(undefined);
    if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
        return Effect.fail(
            new RequestBodyError({ reason: 'invalid_content_length' }),
        );
    }

    const length = Number(value);
    return Number.isSafeInteger(length)
        ? Effect.succeed(length)
        : Effect.fail(
              new RequestBodyError({ reason: 'invalid_content_length' }),
          );
};

const readStream = async (
    stream: ReadableStream<Uint8Array>,
    maxBytes: number,
    signal: AbortSignal,
): Promise<Uint8Array> => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const cancel = () => {
        void reader.cancel('request aborted').catch(() => undefined);
    };

    signal.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;

            total += next.value.byteLength;
            if (total > maxBytes) {
                await reader
                    .cancel('request body too large')
                    .catch(() => undefined);
                throw new RequestBodyError({ reason: 'too_large' });
            }
            chunks.push(next.value);
        }
    } finally {
        signal.removeEventListener('abort', cancel);
        reader.releaseLock();
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
};

export const readBoundedRequestBody = (
    request: Request,
    maxBytes: number,
): Effect.Effect<Uint8Array, RequestBodyError> => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
        return Effect.die(new Error('Invalid request body byte limit'));
    }

    const stream = request.body;
    return declaredBodyLength(request).pipe(
        Effect.flatMap((length) =>
            length !== undefined && length > maxBytes
                ? Effect.fail(new RequestBodyError({ reason: 'too_large' }))
                : stream === null
                  ? Effect.succeed(new Uint8Array())
                  : Effect.tryPromise({
                        try: (signal) => readStream(stream, maxBytes, signal),
                        catch: (cause) =>
                            cause instanceof RequestBodyError
                                ? cause
                                : new RequestBodyError({
                                      reason: 'unreadable',
                                  }),
                    }),
        ),
    );
};

export const readBoundedTextBody = (
    request: Request,
    maxBytes: number,
): Effect.Effect<string, RequestBodyError> =>
    readBoundedRequestBody(request, maxBytes).pipe(
        Effect.flatMap((body) =>
            Effect.try({
                try: () =>
                    new TextDecoder('utf-8', { fatal: true }).decode(body),
                catch: () => new RequestBodyError({ reason: 'invalid_utf8' }),
            }),
        ),
    );

export const readBoundedJsonBody = (
    request: Request,
    maxBytes: number,
): Effect.Effect<unknown, RequestBodyError> =>
    readBoundedTextBody(request, maxBytes).pipe(
        Effect.flatMap((source) =>
            Effect.try({
                try: () => JSON.parse(source) as unknown,
                catch: () => new RequestBodyError({ reason: 'invalid_json' }),
            }),
        ),
    );

export const isRequestBodyTooLarge = (error: unknown): boolean =>
    error instanceof RequestBodyError && error.reason === 'too_large';

import { Effect, Schema } from 'effect';

const CryptoOperation = Schema.Literals(['randomToken', 'sha256', 'safeId']);

export class AuthCryptoError extends Schema.TaggedErrorClass<AuthCryptoError>()(
    'AuthCryptoError',
    {
        operation: CryptoOperation,
        cause: Schema.Defect(),
    },
) {}

export type HashInput = string | Uint8Array;

const TOKEN_BYTE_LENGTH = 32;
const SAFE_ID_BYTE_LENGTH = 7;
const SAFE_ID_HIGH_BYTE_MASK = 0x1f;

const cryptoError = (operation: typeof CryptoOperation.Type, cause: unknown) =>
    new AuthCryptoError({ operation, cause });

const bytesToBase64Url = (bytes: Uint8Array): string => {
    let binary = '';

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, '');
};

const toBytes = (input: HashInput): Uint8Array<ArrayBuffer> => {
    const source =
        typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return copy;
};

export const generateRandomToken = (
    webCrypto: Crypto = globalThis.crypto,
): Effect.Effect<string, AuthCryptoError> =>
    Effect.try({
        try: () => {
            const bytes = new Uint8Array(TOKEN_BYTE_LENGTH);
            webCrypto.getRandomValues(bytes);
            return bytesToBase64Url(bytes);
        },
        catch: (cause) => cryptoError('randomToken', cause),
    });

export const sha256Bytes = (
    input: HashInput,
    webCrypto: Crypto = globalThis.crypto,
): Effect.Effect<Uint8Array, AuthCryptoError> =>
    Effect.tryPromise({
        try: (signal) => {
            if (signal.aborted) {
                return Promise.reject(signal.reason);
            }

            return webCrypto.subtle.digest('SHA-256', toBytes(input));
        },
        catch: (cause) => cryptoError('sha256', cause),
    }).pipe(Effect.map((digest) => new Uint8Array(digest)));

export const sha256Base64Url = (
    input: HashInput,
    webCrypto: Crypto = globalThis.crypto,
): Effect.Effect<string, AuthCryptoError> =>
    sha256Bytes(input, webCrypto).pipe(Effect.map(bytesToBase64Url));

export const timingSafeEqual = (
    left: Uint8Array,
    right: Uint8Array,
): boolean => {
    const length = Math.max(left.byteLength, right.byteLength);
    let difference = left.byteLength ^ right.byteLength;

    for (let index = 0; index < length; index += 1) {
        difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
    }

    return difference === 0;
};

export const generateSafeId = (
    webCrypto: Crypto = globalThis.crypto,
): Effect.Effect<number, AuthCryptoError> =>
    Effect.try({
        try: () => {
            const bytes = new Uint8Array(SAFE_ID_BYTE_LENGTH);
            let id = 0;

            do {
                webCrypto.getRandomValues(bytes);
                bytes[0] &= SAFE_ID_HIGH_BYTE_MASK;
                id = 0;

                for (const byte of bytes) {
                    id = id * 256 + byte;
                }
            } while (id === 0);

            return id;
        },
        catch: (cause) => cryptoError('safeId', cause),
    });

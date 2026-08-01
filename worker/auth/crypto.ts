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

// RFC 1321 MD5 is required only for Fever's legacy api_key derivation. It is
// not used as a password hash: the resulting lowercase hex value is itself
// hashed with SHA-256 before persistence. This implementation follows the RFC
// 1321 rounds and operates on UTF-8 bytes with explicit 32-bit arithmetic.
const MD5_SHIFT = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
    9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21,
] as const;
const MD5_CONSTANTS = Array.from(
    { length: 64 },
    (_, index) =>
        Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) >>> 0,
);
const rotateLeft = (value: number, shift: number): number =>
    ((value << shift) | (value >>> (32 - shift))) >>> 0;

export const md5Hex = (input: string | Uint8Array): string => {
    const source =
        typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const paddedLength = Math.ceil((source.byteLength + 9) / 64) * 64;
    const message = new Uint8Array(paddedLength);
    message.set(source);
    message[source.byteLength] = 0x80;

    const bitLength = BigInt(source.byteLength) * 8n;
    const view = new DataView(message.buffer);
    view.setUint32(paddedLength - 8, Number(bitLength & 0xffff_ffffn), true);
    view.setUint32(paddedLength - 4, Number(bitLength >> 32n), true);

    let a0 = 0x6745_2301;
    let b0 = 0xefcd_ab89;
    let c0 = 0x98ba_dcfe;
    let d0 = 0x1032_5476;

    for (let offset = 0; offset < message.byteLength; offset += 64) {
        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;

        for (let index = 0; index < 64; index += 1) {
            let mixed: number;
            let wordIndex: number;
            if (index < 16) {
                mixed = (b & c) | (~b & d);
                wordIndex = index;
            } else if (index < 32) {
                mixed = (d & b) | (~d & c);
                wordIndex = (5 * index + 1) % 16;
            } else if (index < 48) {
                mixed = b ^ c ^ d;
                wordIndex = (3 * index + 5) % 16;
            } else {
                mixed = c ^ (b | ~d);
                wordIndex = (7 * index) % 16;
            }

            const nextD = c;
            c = b;
            const sum =
                (a +
                    mixed +
                    (MD5_CONSTANTS[index] ?? 0) +
                    view.getUint32(offset + wordIndex * 4, true)) >>>
                0;
            b = (b + rotateLeft(sum, MD5_SHIFT[index] ?? 0)) >>> 0;
            a = d;
            d = nextD;
        }

        a0 = (a0 + a) >>> 0;
        b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0;
        d0 = (d0 + d) >>> 0;
    }

    return [a0, b0, c0, d0]
        .flatMap((word) => [
            word & 0xff,
            (word >>> 8) & 0xff,
            (word >>> 16) & 0xff,
            (word >>> 24) & 0xff,
        ])
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
};

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

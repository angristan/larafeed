import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
    generateRandomToken,
    generateSafeId,
    md5Hex,
    sha256Base64Url,
    sha256Bytes,
    timingSafeEqual,
} from './crypto';

const toHex = (bytes: Uint8Array) =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('authentication crypto primitives', () => {
    it('generates unique 32-byte base64url tokens without padding', async () => {
        const tokens = await Effect.runPromise(
            Effect.all(Array.from({ length: 64 }, () => generateRandomToken())),
        );

        expect(new Set(tokens)).toHaveLength(tokens.length);
        for (const token of tokens) {
            expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
            expect(token).not.toContain('=');
        }
    });

    it('computes standard SHA-256 bytes and base64url encodings', async () => {
        const [bytes, encoded] = await Effect.runPromise(
            Effect.all([sha256Bytes('abc'), sha256Base64Url('abc')]),
        );

        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes).toHaveLength(32);
        expect(toHex(bytes)).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
        expect(encoded).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
    });

    it('hashes strings as UTF-8 and accepts byte inputs', async () => {
        const textHash = await Effect.runPromise(sha256Bytes('é'));
        const byteHash = await Effect.runPromise(
            sha256Bytes(new TextEncoder().encode('é')),
        );

        expect(timingSafeEqual(textHash, byteHash)).toBe(true);
    });

    it('matches all RFC 1321 MD5 test vectors used by Fever', () => {
        expect([
            md5Hex(''),
            md5Hex('a'),
            md5Hex('abc'),
            md5Hex('message digest'),
            md5Hex('abcdefghijklmnopqrstuvwxyz'),
            md5Hex(
                'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
            ),
            md5Hex(
                '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
            ),
        ]).toEqual([
            'd41d8cd98f00b204e9800998ecf8427e',
            '0cc175b9c0f1b6a831c399e269772661',
            '900150983cd24fb0d6963f7d28e17f72',
            'f96b697d7cb7938d525a2f31aaf161d0',
            'c3fcd3d76192e4007dfb496cca67e13b',
            'd174ab98d277d9f5a5611c2c9f419d9f',
            '57edf4a22be3c955ac49da2e2107b67a',
        ]);
        expect(md5Hex('é')).toBe('66ddcd97cfdeabb2f6fb8a999b4bc76f');
    });

    it('compares every byte and rejects unequal lengths', () => {
        expect(
            timingSafeEqual(
                new Uint8Array([0, 1, 2, 3]),
                new Uint8Array([0, 1, 2, 3]),
            ),
        ).toBe(true);
        expect(
            timingSafeEqual(
                new Uint8Array([0, 1, 2, 3]),
                new Uint8Array([0, 1, 2, 4]),
            ),
        ).toBe(false);
        expect(
            timingSafeEqual(
                new Uint8Array([0, 1, 2]),
                new Uint8Array([0, 1, 2, 0]),
            ),
        ).toBe(false);
    });

    it('generates positive exact 53-bit-safe D1 identifiers', async () => {
        const identifiers = await Effect.runPromise(
            Effect.all(Array.from({ length: 128 }, () => generateSafeId())),
        );

        for (const identifier of identifiers) {
            expect(Number.isSafeInteger(identifier)).toBe(true);
            expect(identifier).toBeGreaterThan(0);
            expect(identifier).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
        }
    });
});

import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import type { AuthConfig } from './config';
import { sha256Bytes } from './crypto';
import { AuthenticationFailed, WebAuthnOperationError } from './errors';
import { makeAuthRepository } from './repository';
import { makeAuthService, TURNSTILE_ACTIONS } from './service';
import type { TurnstileValidator } from './turnstile';
import type { WebAuthn } from './webauthn';

const now = 2_100_100_000_000;
const rpId = 'larafeed-test.stanislas.cloud';
const origin = `https://${rpId}`;
const d1 = makeD1(env.DB);

const config: AuthConfig = {
    environment: 'test',
    rpId,
    origin,
    rpName: 'Larafeed Test',
    challengeTtlMs: 300_000,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1_000,
    turnstileSiteKey: 'site-key',
    turnstileSecretKey: 'secret-key',
    sessionCookie: {
        name: '__Host-larafeed-test-session',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
    },
    csrfCookie: {
        name: '__Host-larafeed-test-csrf',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
        path: '/',
    },
};

describe('authentication ceremony service', () => {
    it('consumes a challenge before failed cryptographic verification', async () => {
        const userId = 8_100_021;
        const passkeyId = 8_100_022;
        const credentialId = new Uint8Array([21, 22, 23]);
        const handle = new Uint8Array(32).fill(21);
        await Effect.runPromise(
            d1.run({
                sql: `
                    INSERT INTO users (
                        id, webauthn_user_handle, username, email,
                        display_name, created_at, updated_at
                    ) VALUES (?, ?, 'auth-crypto', 'auth-crypto@example.test',
                        'Auth Crypto', ?, ?)
                `,
                bindings: [userId, handle, now, now],
            }),
        );
        await Effect.runPromise(
            d1.run({
                sql: `
                    INSERT INTO passkeys (
                        id, user_id, credential_id, public_key, sign_count,
                        transports_json, name, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 0, '[]', 'Primary', ?, ?)
                `,
                bindings: [
                    passkeyId,
                    userId,
                    credentialId,
                    new Uint8Array([1, 2, 3]),
                    now,
                    now,
                ],
            }),
        );

        const actions: string[] = [];
        const turnstile: TurnstileValidator = {
            verify: (input) => {
                actions.push(input.expectedAction);
                return Effect.succeed({
                    hostname: rpId,
                    action: input.expectedAction,
                });
            },
        };
        let verificationCalls = 0;
        const webAuthn: WebAuthn = {
            authenticationOptions: () =>
                Effect.succeed({ challenge: 'injected-challenge', rpId }),
            authenticationCredentialId: () => Effect.succeed(credentialId),
            verifyAuthentication: () => {
                verificationCalls += 1;
                return Effect.fail(
                    new WebAuthnOperationError({
                        operation: 'authenticationVerify',
                        cause: new Error('invalid signature'),
                    }),
                );
            },
            registrationOptions: () =>
                Effect.die(new Error('unused registration seam')),
            verifyRegistration: () =>
                Effect.die(new Error('unused registration seam')),
        };
        const service = makeAuthService({
            repository: makeAuthRepository(d1),
            webAuthn,
            turnstile,
            config,
            now: () => now,
        });
        const options = await Effect.runPromise(
            service.authenticationOptions({ turnstileToken: 'human' }),
        );
        const request = {
            challengeId: options.challengeId,
            turnstileToken: 'human',
            response: { id: 'injected-credential' },
        };

        await expect(
            Effect.runPromise(service.verifyAuthentication(request)),
        ).rejects.toBeInstanceOf(AuthenticationFailed);
        await expect(
            Effect.runPromise(service.verifyAuthentication(request)),
        ).rejects.toBeInstanceOf(AuthenticationFailed);

        expect(verificationCalls).toBe(1);
        expect(actions).toEqual([
            TURNSTILE_ACTIONS.authenticationOptions,
            TURNSTILE_ACTIONS.authenticationVerify,
            TURNSTILE_ACTIONS.authenticationVerify,
        ]);
        expect(
            await env.DB.prepare(
                'SELECT consumed_at FROM webauthn_challenges WHERE id = ?',
            )
                .bind(options.challengeId)
                .first<number>('consumed_at'),
        ).toBe(now);
    });

    it('stores independent session and CSRF hashes with absolute expiry', async () => {
        const userId = 8_100_041;
        const passkeyId = 8_100_042;
        const credentialId = new Uint8Array([41, 42, 43]);
        await Effect.runPromise(
            d1.run({
                sql: `
                    INSERT INTO users (
                        id, webauthn_user_handle, username, email,
                        display_name, created_at, updated_at
                    ) VALUES (?, ?, 'auth-session', 'auth-session@example.test',
                        'Auth Session', ?, ?)
                `,
                bindings: [userId, new Uint8Array(32).fill(41), now, now],
            }),
        );
        await Effect.runPromise(
            d1.run({
                sql: `
                    INSERT INTO passkeys (
                        id, user_id, credential_id, public_key, sign_count,
                        transports_json, name, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 0, '[]', 'Primary', ?, ?)
                `,
                bindings: [
                    passkeyId,
                    userId,
                    credentialId,
                    new Uint8Array([4, 5, 6]),
                    now,
                    now,
                ],
            }),
        );

        const turnstile: TurnstileValidator = {
            verify: (input) =>
                Effect.succeed({
                    hostname: rpId,
                    action: input.expectedAction,
                }),
        };
        const webAuthn: WebAuthn = {
            authenticationOptions: () =>
                Effect.succeed({ challenge: 'successful-challenge', rpId }),
            authenticationCredentialId: () => Effect.succeed(credentialId),
            verifyAuthentication: () =>
                Effect.succeed({ newSignCount: 0, backedUp: false }),
            registrationOptions: () =>
                Effect.die(new Error('unused registration seam')),
            verifyRegistration: () =>
                Effect.die(new Error('unused registration seam')),
        };
        const service = makeAuthService({
            repository: makeAuthRepository(d1),
            webAuthn,
            turnstile,
            config,
            now: () => now,
        });
        const options = await Effect.runPromise(
            service.authenticationOptions({ turnstileToken: 'human' }),
        );
        const result = await Effect.runPromise(
            service.verifyAuthentication({
                challengeId: options.challengeId,
                turnstileToken: 'human',
                response: { id: 'injected-credential' },
            }),
        );
        const stored = await env.DB.prepare(
            `SELECT token_hash, csrf_token_hash, expires_at
             FROM sessions WHERE user_id = ? AND revoked_at IS NULL`,
        )
            .bind(userId)
            .first<{
                token_hash: number[];
                csrf_token_hash: number[];
                expires_at: number;
            }>();
        const expectedSessionHash = await Effect.runPromise(
            sha256Bytes(result.cookies.session.value),
        );
        const expectedCsrfHash = await Effect.runPromise(
            sha256Bytes(result.cookies.csrf.value),
        );

        expect(Uint8Array.from(stored?.token_hash ?? [])).toEqual(
            expectedSessionHash,
        );
        expect(Uint8Array.from(stored?.csrf_token_hash ?? [])).toEqual(
            expectedCsrfHash,
        );
        expect(stored?.token_hash).not.toEqual(stored?.csrf_token_hash);
        expect(result.cookies.session.value).not.toBe(
            result.cookies.csrf.value,
        );
        expect(stored?.expires_at).toBe(now + config.sessionTtlMs);
        expect(result.expiresAt).toBe(now + config.sessionTtlMs);
    });
});

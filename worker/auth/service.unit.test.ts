import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from './config';
import { md5Hex, sha256Bytes } from './crypto';
import { CsrfInvalid } from './errors';
import type { AuthRepository } from './repository';
import {
    ACCESS_LINK_RETENTION_MS,
    AUTH_CLEANUP_BATCH_SIZE,
    EXPIRED_SESSION_RETENTION_MS,
    makeAuthService,
    REVOKED_SESSION_RETENTION_MS,
    SECURITY_EVENT_RETENTION_MS,
    SESSION_IDLE_TIMEOUT_MS,
    SESSION_LAST_SEEN_THROTTLE_MS,
    WEBAUTHN_CHALLENGE_RETENTION_MS,
} from './service';
import type { TurnstileValidator } from './turnstile';
import type { WebAuthn } from './webauthn';

const config: AuthConfig = {
    environment: 'test',
    rpId: 'larafeed-test.stanislas.cloud',
    origin: 'https://larafeed-test.stanislas.cloud',
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

const unusedWebAuthn = {} as WebAuthn;
const unusedTurnstile = {} as TurnstileValidator;

const makeService = (
    repository: Partial<AuthRepository> = {},
    now = 2_000_000_000_000,
) =>
    makeAuthService({
        repository: repository as AuthRepository,
        webAuthn: unusedWebAuthn,
        turnstile: unusedTurnstile,
        config,
        now: () => now,
    });

describe('authentication service request guards', () => {
    it('requires exact Origin, JSON, and matching double-submit CSRF tokens', async () => {
        const csrfToken = 'independent-csrf-token';
        const csrfTokenHash = await Effect.runPromise(sha256Bytes(csrfToken));
        const session = {
            sessionId: 101,
            user: {
                id: 201,
                username: 'owner',
                displayName: 'Owner',
                isAdmin: true,
            },
            expiresAt: 2_100_000_000_000,
            csrfTokenHash,
        };
        const service = makeService();

        await expect(
            Effect.runPromise(
                service.authorizeMutation(session, {
                    method: 'POST',
                    origin: config.origin,
                    contentType: 'application/json; charset=utf-8',
                    csrfCookieToken: csrfToken,
                    csrfHeaderToken: csrfToken,
                }),
            ),
        ).resolves.toBeUndefined();

        for (const metadata of [
            {
                method: 'POST',
                origin: `${config.origin}/`,
                contentType: 'application/json',
                csrfCookieToken: csrfToken,
                csrfHeaderToken: csrfToken,
            },
            {
                method: 'POST',
                origin: config.origin,
                contentType: 'text/plain',
                csrfCookieToken: csrfToken,
                csrfHeaderToken: csrfToken,
            },
            {
                method: 'POST',
                origin: config.origin,
                contentType: 'application/json',
                csrfCookieToken: csrfToken,
                csrfHeaderToken: 'different',
            },
        ]) {
            await expect(
                Effect.runPromise(service.authorizeMutation(session, metadata)),
            ).rejects.toBeInstanceOf(CsrfInvalid);
        }
    });

    it('derives a hash-only Fever verifier while plaintext exists', async () => {
        let stored:
            | {
                  readonly tokenHash: Uint8Array;
                  readonly feverVerifierHash: Uint8Array | null;
              }
            | undefined;
        const repository: Partial<AuthRepository> = {
            createAppToken: (input) => {
                stored = {
                    tokenHash: input.tokenHash,
                    feverVerifierHash: input.feverVerifierHash,
                };
                return Effect.void;
            },
        };
        const session = {
            sessionId: 10,
            user: {
                id: 20,
                username: 'fever-owner',
                displayName: 'Fever Owner',
                isAdmin: false,
            },
            expiresAt: 2_100_000_000_000,
            csrfTokenHash: new Uint8Array(32),
        };

        const created = await Effect.runPromise(
            makeService(repository).createAppToken(session, {
                name: 'Fever client',
                scopes: ['fever'],
            }),
        );
        const expectedTokenHash = await Effect.runPromise(
            sha256Bytes(created.plaintextToken),
        );
        const legacyApiKey = md5Hex(
            `${session.user.username}:${created.plaintextToken}`,
        );
        const expectedVerifier = await Effect.runPromise(
            sha256Bytes(legacyApiKey),
        );

        expect(stored?.tokenHash).toEqual(expectedTokenHash);
        expect(stored?.feverVerifierHash).toEqual(expectedVerifier);
        expect(stored?.feverVerifierHash).not.toEqual(
            new TextEncoder().encode(legacyApiKey),
        );
    });

    it('applies seven-day idle and fifteen-minute write throttles', async () => {
        const now = 2_000_000_000_000;
        let observed:
            | {
                  readonly idleCutoff: number;
                  readonly lastSeenThrottleCutoff: number;
              }
            | undefined;
        const repository: Partial<AuthRepository> = {
            findSession: (input) => {
                observed = input;
                return Effect.succeed({
                    id: 1,
                    user: {
                        id: 2,
                        handle: new Uint8Array(32),
                        username: 'owner',
                        email: 'owner@example.test',
                        displayName: 'Owner',
                        isAdmin: true,
                    },
                    csrfTokenHash: new Uint8Array(32),
                    expiresAt: now + config.sessionTtlMs,
                    lastSeenAt: now,
                    createdAt: now - 1_000,
                });
            },
        };

        const authenticated = await Effect.runPromise(
            makeService(repository, now).authenticateSession('session-token'),
        );

        expect(authenticated.createdAt).toBe(now - 1_000);
        expect(observed).toMatchObject({
            idleCutoff: now - SESSION_IDLE_TIMEOUT_MS,
            lastSeenThrottleCutoff: now - SESSION_LAST_SEEN_THROTTLE_MS,
        });
    });

    it('runs fixed-size retained-record cleanup at the login boundary', async () => {
        const now = 2_000_000_000_000;
        const cleanupRetainedRecords = vi.fn(() => Effect.void);
        const issueAuthenticationChallenge = vi.fn(() => Effect.void);
        const service = makeAuthService({
            repository: {
                cleanupRetainedRecords,
                issueAuthenticationChallenge,
            } as unknown as AuthRepository,
            webAuthn: {
                authenticationOptions: () =>
                    Effect.succeed({ challenge: 'challenge' }),
            } as unknown as WebAuthn,
            turnstile: {
                verify: () => Effect.void,
            } as unknown as TurnstileValidator,
            config,
            now: () => now,
        });

        await Effect.runPromise(
            service.authenticationOptions({ turnstileToken: 'valid' }),
        );

        expect(cleanupRetainedRecords).toHaveBeenCalledWith({
            expiredSessionCutoff: now - EXPIRED_SESSION_RETENTION_MS,
            revokedSessionCutoff: now - REVOKED_SESSION_RETENTION_MS,
            challengeCutoff: now - WEBAUTHN_CHALLENGE_RETENTION_MS,
            accessLinkCutoff: now - ACCESS_LINK_RETENTION_MS,
            securityEventCutoff: now - SECURITY_EVENT_RETENTION_MS,
            batchSize: AUTH_CLEANUP_BATCH_SIZE,
        });
        expect(cleanupRetainedRecords.mock.invocationCallOrder[0]).toBeLessThan(
            issueAuthenticationChallenge.mock.invocationCallOrder[0] ?? 0,
        );
    });
});

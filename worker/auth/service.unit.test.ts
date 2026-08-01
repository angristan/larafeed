import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { AuthConfig } from './config';
import { sha256Bytes } from './crypto';
import { CsrfInvalid } from './errors';
import type { AuthRepository } from './repository';
import {
    makeAuthService,
    SESSION_IDLE_TIMEOUT_MS,
    SESSION_LAST_SEEN_THROTTLE_MS,
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
                });
            },
        };

        await Effect.runPromise(
            makeService(repository, now).authenticateSession('session-token'),
        );

        expect(observed).toMatchObject({
            idleCutoff: now - SESSION_IDLE_TIMEOUT_MS,
            lastSeenThrottleCutoff: now - SESSION_LAST_SEEN_THROTTLE_MS,
        });
    });
});

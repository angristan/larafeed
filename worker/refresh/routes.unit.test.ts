import { Effect } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import type { AuthService } from '../auth/service';
import type { D1 } from '../infrastructure/d1';
import { registerRefreshRoutes } from './routes';
import type { RefreshRuntime } from './runtime';

const origin = 'https://larafeed-test.stanislas.cloud';
const config: AuthConfig = {
    environment: 'test',
    rpId: 'larafeed-test.stanislas.cloud',
    origin,
    rpName: 'Larafeed Test',
    challengeTtlMs: 300_000,
    sessionTtlMs: 2_592_000_000,
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

describe('manual refresh route', () => {
    it('checks ownership, CSRF, rate limit, and returns durable identity', async () => {
        const session = {
            sessionId: 1,
            user: {
                id: 2,
                username: 'owner',
                displayName: 'Owner',
                isAdmin: true,
            },
            expiresAt: 2_000_000_000_000,
            csrfTokenHash: new Uint8Array(32),
        };
        const authenticateSession = vi.fn(() => Effect.succeed(session));
        const authorizeMutation = vi.fn(() => Effect.void);
        const createManualRefresh = vi.fn(
            (_feedId: number, operationId?: string) =>
                Promise.resolve({
                    operationId: operationId ?? 'generated',
                    created: true,
                    job: {
                        id: 3,
                        operationId: operationId ?? 'generated',
                        feedId: 4,
                        trigger: 'manual' as const,
                        state: 'pending' as const,
                        attemptCount: 0,
                        maxAttempts: 8,
                        availableAt: 1,
                    },
                }),
        );
        const dispatchOutbox = vi.fn(() =>
            Promise.resolve({
                leased: 1,
                sent: 1,
                released: 0,
                ambiguous: 0,
            }),
        );
        const app = new Hono<{ Bindings: Env }>();
        registerRefreshRoutes(app, {
            runtimeFactory: () =>
                Effect.succeed({
                    auth: {
                        config,
                        service: {
                            authenticateSession,
                            authorizeMutation,
                        } as unknown as AuthService,
                    },
                    refresh: {
                        config: {
                            schedulerEnabled: true,
                            dispatchEnabled: true,
                            dueLimit: 5,
                        },
                        orchestrator: {
                            createManualRefresh,
                            dispatchOutbox,
                        },
                    } as unknown as RefreshRuntime,
                    d1: {
                        first: () => Effect.succeed({ owned: 1 }),
                    } as unknown as D1,
                }),
        });
        const limit = vi.fn(() => Promise.resolve({ success: true }));

        const response = await app.request(
            '/api/feeds/4/refresh',
            {
                method: 'POST',
                headers: {
                    Origin: origin,
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'csrf',
                    'Idempotency-Key': 'manual-click-1',
                    Cookie: `${config.sessionCookie.name}=session; ${config.csrfCookie.name}=csrf`,
                },
                body: '{}',
            },
            { AUTH_RATE_LIMITER: { limit } } as unknown as Env,
        );

        expect(response.status).toBe(202);
        expect(response.headers.get('cache-control')).toBe('no-store');
        await expect(response.json()).resolves.toMatchObject({
            jobId: 3,
            state: 'pending',
        });
        expect(authenticateSession).toHaveBeenCalledWith('session');
        expect(authorizeMutation).toHaveBeenCalled();
        expect(limit).toHaveBeenCalledWith({ key: 'refresh:2' });
        expect(createManualRefresh).toHaveBeenCalledWith(
            4,
            expect.stringMatching(/^feed-refresh:manual:2:4:[a-f0-9]{64}$/u),
        );
        expect(dispatchOutbox).toHaveBeenCalledWith(1);
    });
});

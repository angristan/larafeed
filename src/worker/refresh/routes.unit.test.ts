import { Effect } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import type { AuthService } from '../auth/service';
import type { D1 } from '../infrastructure/d1';
import { ManualRefreshCooldownError, RefreshAlreadyActiveError } from '../jobs';
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
        const requestManualRefresh = vi.fn(
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
                            requestManualRefresh,
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
        expect(requestManualRefresh).toHaveBeenCalledWith(
            4,
            expect.stringMatching(/^feed-refresh:manual:2:4:[a-f0-9]{64}$/u),
        );
        expect(dispatchOutbox).toHaveBeenCalledWith(1);
    });

    it.each([
        {
            error: new RefreshAlreadyActiveError(4),
            status: 409,
            code: 'conflict',
            retry: false,
        },
        {
            error: new ManualRefreshCooldownError(4, Date.now() + 60_000),
            status: 429,
            code: 'rate_limited',
            retry: true,
        },
    ])(
        'returns typed $status admission failures',
        async ({ error, status, code, retry }) => {
            const session = {
                sessionId: 11,
                user: {
                    id: 12,
                    username: 'owner-errors',
                    displayName: 'Owner Errors',
                    isAdmin: false,
                },
                expiresAt: 2_000_000_000_000,
                csrfTokenHash: new Uint8Array(32),
            };
            const requestManualRefresh = vi.fn(() => Promise.reject(error));
            const app = new Hono<{ Bindings: Env }>();
            registerRefreshRoutes(app, {
                runtimeFactory: () =>
                    Effect.succeed({
                        auth: {
                            config,
                            service: {
                                authenticateSession: () =>
                                    Effect.succeed(session),
                                authorizeMutation: () => Effect.void,
                            } as unknown as AuthService,
                        },
                        refresh: {
                            config: {
                                schedulerEnabled: false,
                                dispatchEnabled: false,
                                dueLimit: 5,
                            },
                            orchestrator: { requestManualRefresh },
                        } as unknown as RefreshRuntime,
                        d1: {
                            first: () => Effect.succeed({ owned: 1 }),
                        } as unknown as D1,
                    }),
            });

            const response = await app.request(
                '/api/feeds/4/refresh',
                {
                    method: 'POST',
                    headers: {
                        Origin: origin,
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': 'csrf',
                        Cookie: `${config.sessionCookie.name}=session; ${config.csrfCookie.name}=csrf`,
                    },
                    body: '{}',
                },
                {
                    AUTH_RATE_LIMITER: {
                        limit: () => Promise.resolve({ success: true }),
                    },
                } as unknown as Env,
            );

            expect(response.status).toBe(status);
            await expect(response.json()).resolves.toMatchObject({
                error: { code },
            });
            expect(response.headers.has('retry-after')).toBe(retry);
        },
    );
});

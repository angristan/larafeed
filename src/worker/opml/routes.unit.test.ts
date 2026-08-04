import { Effect } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import type { AuthService } from '../auth/service';
import type { OpmlOrchestrator } from './orchestration';
import { opmlImportEnabled, registerOpmlRoutes } from './routes';

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

const response = {
    id: 10,
    state: 'processing' as const,
    filename: 'feeds.opml',
    totalItems: 200,
    succeededItems: 0,
    failedItems: 0,
    skippedItems: 0,
    startedAt: 1_000,
    completedAt: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    errors: [],
};

describe('OPML routes', () => {
    it('enables imports only for the exact rollout value', () => {
        expect(opmlImportEnabled({ OPML_IMPORT_ENABLED: 'true' })).toBe(true);
        expect(opmlImportEnabled({ OPML_IMPORT_ENABLED: 'false' })).toBe(false);
        expect(opmlImportEnabled({ OPML_IMPORT_ENABLED: 'TRUE' })).toBe(false);
    });

    it('rejects new imports before persistence when disabled', async () => {
        const createImport = vi.fn();
        const app = new Hono<{ Bindings: Env }>();
        registerOpmlRoutes(app, {
            runtimeFactory: () =>
                Effect.succeed({
                    auth: {
                        config,
                        service: {
                            authenticateSession: () =>
                                Effect.succeed({
                                    sessionId: 1,
                                    user: {
                                        id: 2,
                                        username: 'owner',
                                        displayName: 'Owner',
                                        isAdmin: false,
                                    },
                                    expiresAt: 2_000_000_000_000,
                                    csrfTokenHash: new Uint8Array(32),
                                }),
                            authorizeMutation: () => Effect.void,
                        } as unknown as AuthService,
                    },
                    orchestrator: {
                        createImport,
                    } as unknown as OpmlOrchestrator,
                    importEnabled: false,
                }),
        });

        const result = await app.request(
            '/api/opml/imports',
            {
                method: 'POST',
                headers: {
                    Origin: origin,
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'csrf',
                    Cookie: `${config.sessionCookie.name}=session; ${config.csrfCookie.name}=csrf`,
                },
                body: JSON.stringify({
                    opml: '<opml><body /></opml>',
                    filename: 'feeds.opml',
                }),
            },
            {
                AUTH_RATE_LIMITER: {
                    limit: () => Promise.resolve({ success: true }),
                },
            } as unknown as Env,
        );

        expect(result.status).toBe(503);
        await expect(result.json()).resolves.toEqual({
            error: {
                code: 'service_unavailable',
                message: 'OPML imports are disabled',
            },
        });
        expect(createImport).not.toHaveBeenCalled();
    });

    it('requires session, CSRF, rate limit, and returns a typed import', async () => {
        const session = {
            sessionId: 1,
            user: {
                id: 2,
                username: 'owner',
                displayName: 'Owner',
                isAdmin: false,
            },
            expiresAt: 2_000_000_000_000,
            csrfTokenHash: new Uint8Array(32),
        };
        const authenticateSession = vi.fn(() => Effect.succeed(session));
        const authorizeMutation = vi.fn(() => Effect.void);
        const createImport = vi.fn(() => Promise.resolve(response));
        const dispatchOutbox = vi.fn(() =>
            Promise.resolve({
                leased: 1,
                sent: 1,
                released: 0,
                ambiguous: 0,
            }),
        );
        const app = new Hono<{ Bindings: Env }>();
        registerOpmlRoutes(app, {
            runtimeFactory: () =>
                Effect.succeed({
                    auth: {
                        config,
                        service: {
                            authenticateSession,
                            authorizeMutation,
                        } as unknown as AuthService,
                    },
                    orchestrator: {
                        createImport,
                        dispatchOutbox,
                    } as unknown as OpmlOrchestrator,
                    importEnabled: true,
                }),
        });
        const limit = vi.fn(() => Promise.resolve({ success: true }));

        const result = await app.request(
            '/api/opml/imports',
            {
                method: 'POST',
                headers: {
                    Origin: origin,
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'csrf',
                    Cookie: `${config.sessionCookie.name}=session; ${config.csrfCookie.name}=csrf`,
                },
                body: JSON.stringify({
                    opml: '<opml><body><outline xmlUrl="https://example.test/rss" /></body></opml>',
                    filename: 'feeds.opml',
                }),
            },
            { AUTH_RATE_LIMITER: { limit } } as unknown as Env,
        );

        expect(result.status).toBe(202);
        expect(result.headers.get('cache-control')).toBe('no-store');
        await expect(result.json()).resolves.toEqual(response);
        expect(authenticateSession).toHaveBeenCalledWith('session');
        expect(authorizeMutation).toHaveBeenCalledOnce();
        expect(limit).toHaveBeenCalledWith({ key: 'opml:create:2' });
        expect(createImport).toHaveBeenCalledWith(
            2,
            expect.stringContaining('<opml>'),
            'feeds.opml',
        );
        expect(dispatchOutbox).toHaveBeenCalledWith(200, response.id);
    });

    it('exports with the legacy feeds.opml filename', async () => {
        const session = {
            sessionId: 1,
            user: {
                id: 2,
                username: 'owner',
                displayName: 'Owner',
                isAdmin: false,
            },
            expiresAt: 2_000_000_000_000,
            csrfTokenHash: new Uint8Array(32),
        };
        const app = new Hono<{ Bindings: Env }>();
        registerOpmlRoutes(app, {
            runtimeFactory: () =>
                Effect.succeed({
                    auth: {
                        config,
                        service: {
                            authenticateSession: () => Effect.succeed(session),
                        } as unknown as AuthService,
                    },
                    orchestrator: {
                        exportOpml: () =>
                            Promise.resolve('<opml version="2.0" />'),
                    } as unknown as OpmlOrchestrator,
                    importEnabled: true,
                }),
        });

        for (const path of ['/api/opml/export', '/export']) {
            const result = await app.request(
                path,
                {
                    headers: {
                        Cookie: `${config.sessionCookie.name}=session`,
                    },
                },
                {
                    AUTH_RATE_LIMITER: {
                        limit: () => Promise.resolve({ success: true }),
                    },
                } as unknown as Env,
            );

            expect(result.status).toBe(200);
            expect(result.headers.get('content-disposition')).toBe(
                'attachment; filename="feeds.opml"',
            );
            await expect(result.text()).resolves.toContain('<opml');
        }
    });

    it('returns not found instead of exposing another user import', async () => {
        const session = {
            sessionId: 1,
            user: {
                id: 2,
                username: 'owner',
                displayName: 'Owner',
                isAdmin: false,
            },
            expiresAt: 2_000_000_000_000,
            csrfTokenHash: new Uint8Array(32),
        };
        const app = new Hono<{ Bindings: Env }>();
        registerOpmlRoutes(app, {
            runtimeFactory: () =>
                Effect.succeed({
                    auth: {
                        config,
                        service: {
                            authenticateSession: () => Effect.succeed(session),
                        } as unknown as AuthService,
                    },
                    orchestrator: {
                        getImport: () => Promise.resolve(null),
                    } as unknown as OpmlOrchestrator,
                    importEnabled: true,
                }),
        });

        const result = await app.request(
            '/api/opml/imports/999',
            {
                headers: {
                    Cookie: `${config.sessionCookie.name}=session`,
                },
            },
            {
                AUTH_RATE_LIMITER: {
                    limit: () => Promise.resolve({ success: true }),
                },
            } as unknown as Env,
        );

        expect(result.status).toBe(404);
        await expect(result.json()).resolves.toEqual({
            error: { code: 'not_found', message: 'Not found' },
        });
    });
});

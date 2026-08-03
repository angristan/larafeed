import { ApiErrorResponse, FaviconRefreshResponse } from '@shared/http';
import { Effect, Schema } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import { registerFaviconRoutes } from './routes';
import type { FaviconService } from './service';

const origin = 'https://larafeed-test.stanislas.cloud';
const config = {
    environment: 'test',
    rpId: 'larafeed-test.stanislas.cloud',
    origin,
    rpName: 'Larafeed test',
    challengeTtlMs: 120_000,
    sessionTtlMs: 3_600_000,
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
} satisfies AuthConfig;
const session: AuthenticatedSession = {
    sessionId: 1,
    user: { id: 7, username: 'reader', displayName: 'Reader', isAdmin: false },
    expiresAt: 2_000_000_000_000,
    csrfTokenHash: new Uint8Array(32),
};
const app = (rateSuccess = true, enabled = true) => {
    const hono = new Hono<{ Bindings: Env }>();
    const auth: AuthRuntime = {
        config,
        service: {
            authenticateSession: () => Effect.succeed(session),
            authorizeMutation: () => Effect.void,
        } as unknown as AuthService,
    };
    const refreshOwned = vi.fn((_userId: number, feedId: number) =>
        Effect.succeed({
            feedId,
            faviconUrl: 'https://publisher.example/icon.png',
        }),
    );
    const service = {
        refreshOwned,
    } as unknown as FaviconService;
    registerFaviconRoutes(hono, {
        enabled: () => enabled,
        runtimeFactory: () =>
            Effect.succeed({
                auth,
                service,
                rateLimit: () => Promise.resolve({ success: rateSuccess }),
            }),
    });
    return { hono, refreshOwned };
};
const decode = async <S extends Schema.ConstraintDecoder<unknown>>(
    response: Response,
    schema: S,
): Promise<S['Type']> =>
    Schema.decodeUnknownSync(schema)(await response.json());
const request = () => ({
    method: 'POST',
    headers: {
        Cookie: `${config.sessionCookie.name}=session; ${config.csrfCookie.name}=csrf`,
        Origin: origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf',
    },
});

describe('favicon routes', () => {
    it('returns only the opaque owned favicon URL', async () => {
        const response = await app().hono.request(
            '/api/feeds/12/favicon/refresh',
            request(),
        );

        expect(response.status).toBe(200);
        const rawBody = await response.clone().text();
        await expect(decode(response, FaviconRefreshResponse)).resolves.toEqual(
            {
                feedId: 12,
                faviconUrl: '/api/images/feeds/12/small',
            },
        );
        expect(rawBody).not.toContain('publisher.example');
    });

    it('rejects invalid ids and rate-limited refreshes safely', async () => {
        const invalid = await app().hono.request(
            '/api/feeds/not-an-id/favicon/refresh',
            request(),
        );
        expect(invalid.status).toBe(404);

        const limited = await app(false).hono.request(
            '/api/feeds/12/favicon/refresh',
            request(),
        );
        expect(limited.status).toBe(429);
        await expect(decode(limited, ApiErrorResponse)).resolves.toMatchObject({
            error: { code: 'rate_limited' },
        });
    });

    it('rejects manual refresh before lookup when maintenance is disabled', async () => {
        const disabled = app(true, false);
        const response = await disabled.hono.request(
            '/api/feeds/12/favicon/refresh',
            request(),
        );

        expect(response.status).toBe(503);
        await expect(decode(response, ApiErrorResponse)).resolves.toMatchObject(
            {
                error: {
                    code: 'service_unavailable',
                    message: 'Favicon refresh is disabled',
                },
            },
        );
        expect(disabled.refreshOwned).not.toHaveBeenCalled();
    });
});

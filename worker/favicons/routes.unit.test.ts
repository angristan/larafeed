import { ApiErrorResponse, FaviconRefreshResponse } from '@shared/http';
import { Effect, Schema } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import type { FaviconAssetRepository } from './assets';
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
const app = (
    rateSuccess = true,
    enabled = true,
    assets?: {
        readonly repository: FaviconAssetRepository;
        readonly cache: Pick<Cache, 'match' | 'put'>;
    },
) => {
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
            faviconAssetHash: 'a'.repeat(64),
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
        ...(assets === undefined
            ? {}
            : {
                  assetRepository: assets.repository,
                  cache: assets.cache,
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
                faviconUrl: `/api/public/favicons/v1/${'a'.repeat(64)}.png`,
            },
        );
        expect(rawBody).not.toContain('publisher.example');
    });

    it('serves durable assets through a public immutable edge cache', async () => {
        const hash = 'b'.repeat(64);
        const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
        const find = vi.fn(async () => png);
        let cached: Response | undefined;
        const match = vi.fn(async () => cached?.clone());
        const put = vi.fn(async (_request: Request, response: Response) => {
            cached = response.clone();
        });
        const repository = {
            put: vi.fn(async () => undefined),
            find,
            deleteOrphans: vi.fn(async () => 0),
        } satisfies FaviconAssetRepository;
        const current = app(true, true, {
            repository,
            cache: { match, put },
        });

        const first = await current.hono.request(
            `/api/public/favicons/v1/${hash}.png`,
        );
        expect(first.status).toBe(200);
        expect(first.headers.get('content-type')).toBe('image/png');
        expect(first.headers.get('cache-control')).toBe(
            'public, max-age=31536000, immutable',
        );
        expect(first.headers.get('etag')).toBe(`"${hash}"`);
        expect(new Uint8Array(await first.arrayBuffer())).toEqual(png);

        const second = await current.hono.request(
            `/api/public/favicons/v1/${hash}.png`,
        );
        expect(second.status).toBe(200);
        expect(find).toHaveBeenCalledTimes(1);
        expect(put).toHaveBeenCalledTimes(1);
        expect(match).toHaveBeenCalledTimes(2);

        const invalid = await current.hono.request(
            '/api/public/favicons/v1/not-a-hash.png',
        );
        expect(invalid.status).toBe(404);
        expect(invalid.headers.get('cache-control')).toBe('no-store');
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

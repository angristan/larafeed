import { Effect } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import { Unauthenticated } from '../auth/errors';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import type { ImageRepository } from './repository';
import {
    type ImageRuntime,
    imagesEnabled,
    registerImageRoutes,
} from './routes';
import type { ImageService } from './service';

const config: AuthConfig = {
    environment: 'test',
    rpId: 'larafeed-test.stanislas.cloud',
    origin: 'https://larafeed-test.stanislas.cloud',
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
};
const session: AuthenticatedSession = {
    sessionId: 1,
    user: {
        id: 7,
        username: 'reader',
        displayName: 'Reader',
        isAdmin: false,
    },
    expiresAt: 2_000_000_000_000,
    csrfTokenHash: new Uint8Array(32),
};

const makeAuth = (
    authenticateSession: AuthService['authenticateSession'] = () =>
        Effect.succeed(session),
): AuthRuntime => ({
    config,
    service: { authenticateSession } as AuthService,
});

const makeApp = (runtime: ImageRuntime) => {
    const app = new Hono<{ Bindings: Env }>();
    registerImageRoutes(app, {
        runtimeFactory: () => Effect.succeed(runtime),
    });
    return app;
};

const makeRuntime = (overrides: Partial<ImageRuntime> = {}) =>
    ({
        auth: makeAuth(),
        repository: {
            findOwnedFeedSource: () =>
                Effect.succeed({
                    faviconUrl: 'https://images.example.test/icon.png',
                }),
            findOwnedArticleSource: () =>
                Effect.succeed({
                    contentHtml:
                        '<img src="https://images.example.test/article.png">',
                    entryUrl: 'https://publisher.example.test/article',
                }),
        } as ImageRepository,
        service: {
            transformFeedImage: async () =>
                new Response(new Uint8Array([1, 2, 3]).buffer, {
                    headers: { 'content-type': 'image/webp' },
                }),
            transformArticleImage: async () =>
                new Response(new Uint8Array([1, 2, 3]).buffer, {
                    headers: { 'content-type': 'image/webp' },
                }),
        } as ImageService,
        rateLimit: async () => ({ success: true }),
        ...overrides,
    }) satisfies ImageRuntime;

const get = {
    headers: {
        Cookie: `${config.sessionCookie.name}=session-secret`,
        Accept: 'image/webp,*/*',
    },
};

describe('feed image routes', () => {
    it('enables transforms only for the exact rollout value', () => {
        expect(imagesEnabled({ IMAGES_ENABLED: 'true' })).toBe(true);
        expect(imagesEnabled({ IMAGES_ENABLED: 'false' })).toBe(false);
        expect(imagesEnabled({ IMAGES_ENABLED: 'TRUE' })).toBe(false);
    });

    it('requires a web session before ownership or source lookup', async () => {
        const findOwnedFeedSource = vi.fn(() =>
            Effect.succeed({
                faviconUrl: 'https://should-not-fetch.test/a.png',
            }),
        );
        const transformFeedImage = vi.fn();
        const runtime = makeRuntime({
            auth: makeAuth(() => Effect.fail(new Unauthenticated())),
            repository: {
                ...makeRuntime().repository,
                findOwnedFeedSource,
            },
            service: {
                ...makeRuntime().service,
                transformFeedImage,
            },
        });

        const response = await makeApp(runtime).request(
            '/api/images/feeds/21/small',
        );

        expect(response.status).toBe(401);
        expect(findOwnedFeedSource).not.toHaveBeenCalled();
        expect(transformFeedImage).not.toHaveBeenCalled();
        expect(response.headers.get('cache-control')).toBe('private, no-store');
    });

    it('returns not found without source fetch when subscription ownership fails', async () => {
        const findOwnedFeedSource = vi.fn(() => Effect.succeed(null));
        const transformFeedImage = vi.fn();
        const runtime = makeRuntime({
            repository: {
                ...makeRuntime().repository,
                findOwnedFeedSource,
            },
            service: {
                ...makeRuntime().service,
                transformFeedImage,
            },
        });

        const response = await makeApp(runtime).request(
            '/api/images/feeds/21/small',
            get,
        );

        expect(response.status).toBe(404);
        expect(findOwnedFeedSource).toHaveBeenCalledWith(7, 21);
        expect(transformFeedImage).not.toHaveBeenCalled();
    });

    it('uses only the authoritative stored source and fixed path preset', async () => {
        const transformFeedImage = vi.fn(
            async () =>
                new Response(new Uint8Array([1, 2, 3]).buffer, {
                    headers: { 'content-type': 'image/webp' },
                }),
        );
        const rateLimit = vi.fn(async () => ({ success: true }));
        const runtime = makeRuntime({
            service: {
                ...makeRuntime().service,
                transformFeedImage,
            },
            rateLimit,
        });

        const response = await makeApp(runtime).request(
            '/api/images/feeds/21/medium',
            get,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/webp');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(rateLimit).toHaveBeenCalledWith('image:7:21:medium');
        expect(transformFeedImage).toHaveBeenCalledWith({
            sourceUrl: 'https://images.example.test/icon.png',
            preset: 'medium',
            accept: 'image/webp,*/*',
        });
    });

    it('cannot become an open proxy through query or preset input', async () => {
        const transformFeedImage = vi.fn();
        const runtime = makeRuntime({
            service: {
                ...makeRuntime().service,
                transformFeedImage,
            },
        });
        const app = makeApp(runtime);

        for (const path of [
            '/api/images/feeds/21/small?url=https://attacker.example/icon.png',
            '/api/images/feeds/21/128',
            '/api/images/feeds/21/small/https%3A%2F%2Fattacker.example',
        ]) {
            const response = await app.request(path, get);
            expect(response.status).toBe(404);
        }
        expect(transformFeedImage).not.toHaveBeenCalled();
    });

    it('returns one bounded placeholder for missing, upstream, and transform failures', async () => {
        const cases: ImageRuntime[] = [
            makeRuntime({
                repository: {
                    ...makeRuntime().repository,
                    findOwnedFeedSource: () =>
                        Effect.succeed({ faviconUrl: null }),
                },
            }),
            makeRuntime({
                service: {
                    ...makeRuntime().service,
                    transformFeedImage: async () => {
                        throw new Error('private upstream failure');
                    },
                },
            }),
            makeRuntime({
                service: {
                    ...makeRuntime().service,
                    transformFeedImage: async () =>
                        new Response(new Uint8Array([1]).buffer, {
                            headers: { 'content-type': 'image/svg+xml' },
                        }),
                },
            }),
        ];

        for (const runtime of cases) {
            const response = await makeApp(runtime).request(
                '/api/images/feeds/21/small',
                get,
            );
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('image/png');
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            );
            expect((await response.arrayBuffer()).byteLength).toBeLessThan(256);
        }
    });

    it('rate limits by user, feed, and preset before source lookup', async () => {
        const findOwnedFeedSource = vi.fn(() =>
            Effect.succeed({ faviconUrl: 'https://images.example.test/a.png' }),
        );
        const runtime = makeRuntime({
            repository: {
                ...makeRuntime().repository,
                findOwnedFeedSource,
            },
            rateLimit: async () => ({ success: false }),
        });

        const response = await makeApp(runtime).request(
            '/api/images/feeds/21/small',
            get,
        );

        expect(response.status).toBe(429);
        expect(findOwnedFeedSource).not.toHaveBeenCalled();
    });
});

import { Effect } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import type { FullContentRepository, FullContentStore } from '../fullcontent';
import type { ImageRepository } from './repository';
import { type ImageRuntime, registerImageRoutes } from './routes';
import { type ImageService, makeImageService } from './service';

const config = {
    sessionCookie: { name: '__Host-larafeed-test-session' },
} as AuthConfig;
const session = {
    sessionId: 1,
    user: {
        id: 7,
        username: 'reader',
        displayName: 'Reader',
        isAdmin: false,
    },
    expiresAt: 2_000_000_000_000,
    csrfTokenHash: new Uint8Array(32),
} as AuthenticatedSession;
const auth = {
    config,
    service: {
        authenticateSession: () => Effect.succeed(session),
    } as unknown as AuthService,
} as AuthRuntime;

const app = (runtime: ImageRuntime) => {
    const hono = new Hono<{ Bindings: Env }>();
    registerImageRoutes(hono, {
        runtimeFactory: () => Effect.succeed(runtime),
    });
    return hono;
};

const request = {
    headers: {
        Cookie: `${config.sessionCookie.name}=session-secret`,
        Accept: 'image/webp,*/*',
    },
};

describe('article image route', () => {
    it('resolves only the indexed source from owned article content', async () => {
        const transformArticleImage = vi.fn(
            async () =>
                new Response(new Uint8Array([1, 2, 3]).buffer, {
                    headers: { 'content-type': 'image/webp' },
                }),
        );
        const findOwnedArticleSource = vi.fn(() =>
            Effect.succeed({
                contentHtml:
                    '<p><img src="https://cdn.example.test/first.png"><img src="/second.png"></p>',
                entryUrl: 'https://publisher.example.test/posts/one',
            }),
        );
        const runtime = {
            auth,
            repository: {
                findOwnedFeedSource: () => Effect.succeed(null),
                findOwnedArticleSource,
            } as ImageRepository,
            service: {
                transformFeedImage: vi.fn(),
                transformArticleImage,
            } as unknown as ImageService,
            rateLimit: vi.fn(async () => ({ success: true })),
        } satisfies ImageRuntime;

        const response = await app(runtime).request(
            '/api/images/entries/41/2',
            request,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/webp');
        expect(response.headers.get('cache-control')).toBe(
            'private, max-age=86400',
        );
        expect(response.headers.get('vary')).toBe('Accept');
        expect(findOwnedArticleSource).toHaveBeenCalledWith(7, 41);
        expect(transformArticleImage).toHaveBeenCalledWith({
            sourceUrl: 'https://publisher.example.test/second.png',
            accept: 'image/webp,*/*',
            admitFetch: expect.any(Function),
        });
    });

    it('rejects unowned entries and arbitrary source input', async () => {
        const transformArticleImage = vi.fn();
        const runtime = {
            auth,
            repository: {
                findOwnedFeedSource: () => Effect.succeed(null),
                findOwnedArticleSource: () => Effect.succeed(null),
            } as ImageRepository,
            service: {
                transformFeedImage: vi.fn(),
                transformArticleImage,
            } as unknown as ImageService,
            rateLimit: async () => ({ success: true }),
        } satisfies ImageRuntime;

        for (const path of [
            '/api/images/entries/41/1',
            '/api/images/entries/41/1?url=https://attacker.example/pixel',
            '/api/images/entries/41/101',
        ]) {
            const response = await app(runtime).request(path, request);
            expect(response.status).toBe(404);
            expect(response.headers.get('cache-control')).toBe(
                'private, no-store',
            );
        }
        expect(transformArticleImage).not.toHaveBeenCalled();
    });
});

describe('article image rate limiting', () => {
    const makeService = () => {
        const entries = new Map<string, Response>();
        const cache = {
            match: async (request: Request) =>
                entries.get(request.url)?.clone(),
            put: async (request: Request, response: Response) => {
                entries.set(request.url, response.clone());
            },
        } as unknown as Cache;
        const fetch = vi.fn(
            async () =>
                new Response(new Uint8Array([1, 2, 3]).buffer, {
                    headers: { 'content-type': 'image/png' },
                }),
        );
        const transformer: {
            readonly transform: () => unknown;
            readonly output: () => Promise<{
                readonly response: () => Response;
            }>;
        } = {
            transform: () => transformer,
            output: async () => ({
                response: () =>
                    new Response(new Uint8Array([4, 5, 6]).buffer, {
                        headers: { 'content-type': 'image/webp' },
                    }),
            }),
        };
        const service = makeImageService({
            images: { input: () => transformer } as unknown as ImagesBinding,
            fetch: fetch as typeof globalThis.fetch,
            cache,
            cacheOrigin: 'https://larafeed.example.test',
        });
        return { service, fetch };
    };

    const makeRuntime = (
        service: ImageService,
        rateLimit: ImageRuntime['rateLimit'],
    ): ImageRuntime => ({
        auth,
        repository: {
            findOwnedFeedSource: () => Effect.succeed(null),
            findOwnedArticleSource: () =>
                Effect.succeed({
                    contentHtml: '<img src="https://cdn.example.test/one.png">',
                    entryUrl: 'https://publisher.example.test/posts/one',
                }),
        } as ImageRepository,
        service,
        rateLimit,
        fullContent: {
            repository: {
                findOwnedEntry: () =>
                    Effect.succeed({ entryId: 41, title: 'Entry', url: null }),
            } as FullContentRepository,
            store: {
                load: () =>
                    Effect.succeed({
                        html: '<img src="https://cdn.example.test/full.png">',
                        sourceUrl: 'https://publisher.example.test/posts/one',
                    }),
            } as unknown as FullContentStore,
        },
    });

    it.each(['/api/images/entries/41/1', '/api/images/entries/41/full/1'])(
        'spends a token only on a transform cache miss for %s',
        async (path) => {
            const { service, fetch } = makeService();
            const rateLimit = vi.fn(async () => ({ success: false }));
            const hono = app(makeRuntime(service, rateLimit));

            const limited = await hono.request(path, request);
            expect(limited.status).toBe(429);
            expect(fetch).not.toHaveBeenCalled();

            rateLimit.mockResolvedValue({ success: true });
            const fetched = await hono.request(path, request);
            expect(fetched.status).toBe(200);
            expect(fetched.headers.get('content-type')).toBe('image/webp');

            // The limiter would reject this request, but the cache serves it.
            rateLimit.mockResolvedValue({ success: false });
            const cached = await hono.request(path, request);
            expect(cached.status).toBe(200);
            expect(new Uint8Array(await cached.arrayBuffer())).toEqual(
                new Uint8Array([4, 5, 6]),
            );

            expect(rateLimit).toHaveBeenCalledTimes(2);
            expect(rateLimit).toHaveBeenCalledWith('image:7');
            expect(fetch).toHaveBeenCalledTimes(1);
        },
    );
});

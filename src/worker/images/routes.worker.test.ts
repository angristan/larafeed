import { Effect } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import type { ImageRepository } from './repository';
import { type ImageRuntime, registerImageRoutes } from './routes';
import type { ImageService } from './service';

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
        });
        expect(runtime.rateLimit).toHaveBeenCalledWith('image:7');
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

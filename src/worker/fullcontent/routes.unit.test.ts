import { ApiErrorResponse, EntryFullContentResponse } from '@shared/http';
import { Effect, Schema } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AuthConfig } from '../auth/config';
import { CsrfInvalid } from '../auth/errors';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import {
    FullContentFetchError,
    FullContentNotFound,
    FullContentUnavailable,
} from './errors';
import { registerFullContentRoutes } from './routes';
import type { FullContentService } from './service';

const origin = 'https://larafeed-test.stanislas.cloud';
const config: AuthConfig = {
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
const response = EntryFullContentResponse.make({
    fullContent: {
        entryId: 31,
        html: '<p>Full article.</p>',
        sourceUrl: 'https://example.test/article',
        fetchedAt: 1_900_000_000_000,
        summary: null,
    },
});

const makeAuthService = (overrides: Partial<AuthService> = {}): AuthService =>
    ({
        authenticateSession: () => Effect.succeed(session),
        authorizeMutation: () => Effect.void,
        ...overrides,
    }) as AuthService;
const makeService = (
    overrides: Partial<FullContentService> = {},
): FullContentService =>
    ({
        get: () =>
            Effect.succeed(
                EntryFullContentResponse.make({ fullContent: null }),
            ),
        fetchContent: () => Effect.succeed(response),
        summarize: () => Effect.succeed(response),
        ...overrides,
    }) as FullContentService;

const makeApp = (service = makeService(), authService = makeAuthService()) => {
    const app = new Hono<{ Bindings: Env }>();
    const auth: AuthRuntime = { config, service: authService };
    registerFullContentRoutes(app, {
        runtimeFactory: () => Effect.succeed({ auth, service }),
    });
    return app;
};
const cookie = `${config.sessionCookie.name}=session-secret`;
const csrfCookie = `${config.csrfCookie.name}=csrf-secret`;
const post = {
    method: 'POST',
    headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-secret',
        Cookie: `${cookie}; ${csrfCookie}`,
    },
    body: '{}',
};
const envWithLimit = (limit: ReturnType<typeof vi.fn>) =>
    ({ AUTH_RATE_LIMITER: { limit } }) as unknown as Env;

describe('full content routes', () => {
    it('returns a side-effect-free authenticated GET response', async () => {
        const get = vi.fn(() =>
            Effect.succeed(
                EntryFullContentResponse.make({ fullContent: null }),
            ),
        );
        const fetchContent = vi.fn(() => Effect.succeed(response));
        const app = makeApp(makeService({ get, fetchContent }));
        const result = await app.request('/api/entries/31/full-content', {
            headers: { Cookie: cookie },
        });

        expect(result.status).toBe(200);
        expect(result.headers.get('cache-control')).toBe('no-store');
        expect(
            Schema.decodeUnknownSync(EntryFullContentResponse)(
                await result.json(),
            ),
        ).toEqual({ fullContent: null });
        expect(get).toHaveBeenCalledWith(7, 31);
        expect(fetchContent).not.toHaveBeenCalled();
    });

    it('maps ownership failures to an opaque not found response', async () => {
        const app = makeApp(
            makeService({
                get: () => Effect.fail(new FullContentNotFound()),
            }),
        );
        const result = await app.request('/api/entries/31/full-content', {
            headers: { Cookie: cookie },
        });
        expect(result.status).toBe(404);
        expect(
            Schema.decodeUnknownSync(ApiErrorResponse)(await result.json()),
        ).toEqual({ error: { code: 'not_found', message: 'Not found' } });
    });

    it('requires session CSRF before consuming the per-user limit', async () => {
        const limit = vi.fn(() => Promise.resolve({ success: true }));
        const fetchContent = vi.fn(() => Effect.succeed(response));
        const app = makeApp(
            makeService({ fetchContent }),
            makeAuthService({
                authorizeMutation: () => Effect.fail(new CsrfInvalid()),
            }),
        );
        const result = await app.request(
            '/api/entries/31/full-content',
            post,
            envWithLimit(limit),
        );

        expect(result.status).toBe(403);
        expect(limit).not.toHaveBeenCalled();
        expect(fetchContent).not.toHaveBeenCalled();
    });

    it('rate limits by authenticated user before fetching', async () => {
        const limit = vi.fn(() => Promise.resolve({ success: false }));
        const fetchContent = vi.fn(() => Effect.succeed(response));
        const app = makeApp(makeService({ fetchContent }));
        const result = await app.request(
            '/api/entries/31/full-content',
            post,
            envWithLimit(limit),
        );

        expect(result.status).toBe(429);
        expect(limit).toHaveBeenCalledWith({ key: 'full-content:7' });
        expect(fetchContent).not.toHaveBeenCalled();
    });

    it('maps upstream fetch failures to a bad gateway response', async () => {
        const limit = vi.fn(() => Promise.resolve({ success: true }));
        const app = makeApp(
            makeService({
                fetchContent: () =>
                    Effect.fail(new FullContentFetchError({ kind: 'timeout' })),
            }),
        );
        const result = await app.request(
            '/api/entries/31/full-content',
            post,
            envWithLimit(limit),
        );

        expect(result.status).toBe(502);
        expect(
            Schema.decodeUnknownSync(ApiErrorResponse)(await result.json()),
        ).toEqual({
            error: {
                code: 'bad_gateway',
                message: 'The publisher’s site timed out',
            },
        });
    });

    it('authorizes and schema-encodes a successful fetch', async () => {
        const authorizeMutation = vi.fn(() => Effect.succeed(undefined));
        const fetchContent = vi.fn(() => Effect.succeed(response));
        const limit = vi.fn(() => Promise.resolve({ success: true }));
        const app = makeApp(
            makeService({ fetchContent }),
            makeAuthService({ authorizeMutation }),
        );
        const result = await app.request(
            '/api/entries/31/full-content',
            post,
            envWithLimit(limit),
        );

        expect(result.status).toBe(200);
        expect(fetchContent).toHaveBeenCalledWith(7, 31);
        expect(authorizeMutation).toHaveBeenCalledWith(
            session,
            expect.objectContaining({
                method: 'POST',
                origin,
                csrfCookieToken: 'csrf-secret',
                csrfHeaderToken: 'csrf-secret',
            }),
        );
        expect(
            Schema.decodeUnknownSync(EntryFullContentResponse)(
                await result.json(),
            ),
        ).toEqual(response);
    });

    it('summarizes through the dedicated route with guards applied', async () => {
        const summarize = vi.fn(() => Effect.succeed(response));
        const limit = vi.fn(() => Promise.resolve({ success: true }));
        const app = makeApp(makeService({ summarize }));
        const result = await app.request(
            '/api/entries/31/full-content/summary',
            post,
            envWithLimit(limit),
        );

        expect(result.status).toBe(200);
        expect(summarize).toHaveBeenCalledWith(7, 31);
        expect(limit).toHaveBeenCalledWith({ key: 'full-content:7' });
    });

    it('maps missing fetched content to a conflict', async () => {
        const limit = vi.fn(() => Promise.resolve({ success: true }));
        const app = makeApp(
            makeService({
                summarize: () => Effect.fail(new FullContentUnavailable()),
            }),
        );
        const result = await app.request(
            '/api/entries/31/full-content/summary',
            post,
            envWithLimit(limit),
        );

        expect(result.status).toBe(409);
        expect(
            Schema.decodeUnknownSync(ApiErrorResponse)(await result.json()),
        ).toEqual({
            error: {
                code: 'conflict',
                message: 'Fetch the full article before summarizing it',
            },
        });
    });
});

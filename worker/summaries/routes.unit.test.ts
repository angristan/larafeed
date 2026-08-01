import { ApiErrorResponse, EntrySummaryResponse } from '@shared/http';
import { Effect, Schema } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AuthConfig } from '../auth/config';
import { CsrfInvalid } from '../auth/errors';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import { SummaryNotFound } from './errors';
import { registerSummaryRoutes } from './routes';
import type { SummaryService } from './service';

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
const response = EntrySummaryResponse.make({
    summary: {
        id: 41,
        entryId: 31,
        html: '<p>Summary</p>',
        model: 'gemini-2.5-flash',
        promptVersion: 'entry-summary-v1',
        generatedAt: 1_900_000_000_000,
    },
});

const makeAuthService = (overrides: Partial<AuthService> = {}): AuthService =>
    ({
        authenticateSession: () => Effect.succeed(session),
        authorizeMutation: () => Effect.void,
        ...overrides,
    }) as AuthService;
const makeSummaryService = (
    overrides: Partial<SummaryService> = {},
): SummaryService =>
    ({
        get: () => Effect.succeed(EntrySummaryResponse.make({ summary: null })),
        generate: () => Effect.succeed(response),
        ...overrides,
    }) as SummaryService;

const makeApp = (
    service = makeSummaryService(),
    authService = makeAuthService(),
) => {
    const app = new Hono<{ Bindings: Env }>();
    const auth: AuthRuntime = { config, service: authService };
    registerSummaryRoutes(app, {
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

describe('summary routes', () => {
    it('returns a side-effect-free authenticated GET response', async () => {
        const get = vi.fn(() =>
            Effect.succeed(EntrySummaryResponse.make({ summary: null })),
        );
        const generate = vi.fn(() => Effect.succeed(response));
        const app = makeApp(makeSummaryService({ get, generate }));
        const result = await app.request('/api/entries/31/summary', {
            headers: { Cookie: cookie },
        });

        expect(result.status).toBe(200);
        expect(result.headers.get('cache-control')).toBe('no-store');
        await expect(
            Schema.decodeUnknownSync(EntrySummaryResponse)(await result.json()),
        ).toEqual({ summary: null });
        expect(get).toHaveBeenCalledWith(7, 31);
        expect(generate).not.toHaveBeenCalled();
    });

    it('maps ownership failures to an opaque not found response', async () => {
        const app = makeApp(
            makeSummaryService({
                get: () => Effect.fail(new SummaryNotFound()),
            }),
        );
        const result = await app.request('/api/entries/31/summary', {
            headers: { Cookie: cookie },
        });
        expect(result.status).toBe(404);
        expect(
            Schema.decodeUnknownSync(ApiErrorResponse)(await result.json()),
        ).toEqual({ error: { code: 'not_found', message: 'Not found' } });
    });

    it('requires session CSRF before consuming the per-user limit', async () => {
        const limit = vi.fn(() => Promise.resolve({ success: true }));
        const generate = vi.fn(() => Effect.succeed(response));
        const app = makeApp(
            makeSummaryService({ generate }),
            makeAuthService({
                authorizeMutation: () => Effect.fail(new CsrfInvalid()),
            }),
        );
        const result = await app.request(
            '/api/entries/31/summary',
            post,
            envWithLimit(limit),
        );

        expect(result.status).toBe(403);
        expect(limit).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
    });

    it('rate limits by authenticated user before generation', async () => {
        const limit = vi.fn(() => Promise.resolve({ success: false }));
        const generate = vi.fn(() => Effect.succeed(response));
        const app = makeApp(makeSummaryService({ generate }));
        const result = await app.request(
            '/api/entries/31/summary',
            post,
            envWithLimit(limit),
        );

        expect(result.status).toBe(429);
        expect(limit).toHaveBeenCalledWith({ key: 'summary:7' });
        expect(generate).not.toHaveBeenCalled();
    });

    it('authorizes and schema-encodes a successful generation', async () => {
        const authorizeMutation = vi.fn(() => Effect.succeed(undefined));
        const generate = vi.fn(() => Effect.succeed(response));
        const limit = vi.fn(() => Promise.resolve({ success: true }));
        const app = makeApp(
            makeSummaryService({ generate }),
            makeAuthService({ authorizeMutation }),
        );
        const result = await app.request(
            '/api/entries/31/summary',
            post,
            envWithLimit(limit),
        );

        expect(result.status).toBe(200);
        expect(generate).toHaveBeenCalledWith(7, 31);
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
            Schema.decodeUnknownSync(EntrySummaryResponse)(await result.json()),
        ).toEqual(response);
    });
});

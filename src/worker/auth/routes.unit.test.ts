import {
    ApiErrorResponse,
    AppTokenListResponse,
    AuthConfigResponse,
    AuthenticatedSessionResponse,
    AuthenticationOptionsResponse,
    PasskeyListResponse,
    RegistrationOptionsResponse,
    UnauthenticatedSessionResponse,
} from '@shared/http';
import { Effect, Schema } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from './config';
import {
    AuthenticationFailed,
    AuthStorageError,
    Unauthenticated,
} from './errors';
import type { AuthOperator } from './operator';
import { type AuthRouteDependencies, registerAuthRoutes } from './routes';
import type {
    AuthenticatedSession,
    AuthService,
    MutationRequestMetadata,
} from './service';

const expiresAt = Date.now() + 3_600_000;
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

const user = {
    id: 7,
    username: 'reader',
    displayName: 'Reader',
    isAdmin: true,
} as const;

const session: AuthenticatedSession = {
    sessionId: 11,
    user,
    expiresAt,
    csrfTokenHash: new Uint8Array(32),
};

const cookies = {
    session: {
        ...config.sessionCookie,
        value: 'session-secret',
        expiresAt,
    },
    csrf: {
        ...config.csrfCookie,
        value: 'csrf-secret',
        expiresAt,
    },
} as const;

const clearedCookies = {
    session: { ...cookies.session, value: '', expiresAt: 0 },
    csrf: { ...cookies.csrf, value: '', expiresAt: 0 },
} as const;

const passkey = {
    id: 41,
    name: 'Laptop',
    transports: ['internal'],
    backedUp: true,
    createdAt: 1_900_000_000_000,
    lastUsedAt: null,
} as const;

const appToken = {
    id: 51,
    name: 'Reader client',
    prefix: 'abcdefghij',
    scopes: ['google-reader'] as const,
    createdAt: 1_900_000_000_000,
    lastUsedAt: null,
    expiresAt: null,
} as const;

const makeService = (overrides: Partial<AuthService> = {}): AuthService =>
    ({
        authenticationOptions: () =>
            Effect.succeed({
                challengeId: 21,
                options: { challenge: 'challenge' },
            }),
        verifyAuthentication: () =>
            Effect.succeed({ user, expiresAt, cookies }),
        accessRegistrationOptions: () =>
            Effect.succeed({
                challengeId: 22,
                purpose: 'enrollment' as const,
                options: { challenge: 'challenge' },
            }),
        accessRegistrationVerify: () =>
            Effect.succeed({ user, expiresAt, cookies }),
        passkeyRegistrationOptions: () =>
            Effect.succeed({
                challengeId: 23,
                purpose: 'enrollment' as const,
                options: { challenge: 'challenge' },
            }),
        passkeyRegistrationVerify: () => Effect.succeed({ passkey }),
        authenticateSession: () => Effect.succeed(session),
        authorizeMutation: () => Effect.succeed(undefined),
        revokeSession: () => Effect.succeed(clearedCookies),
        listPasskeys: () => Effect.succeed({ passkeys: [passkey] }),
        deletePasskey: () => Effect.void,
        createEnrollmentLink: () =>
            Effect.succeed({
                id: 61,
                userId: 62,
                purpose: 'enrollment' as const,
                url: `${origin}/auth/enroll#token=plaintext`,
                expiresAt,
            }),
        createRecoveryLink: (_session, targetUserId) =>
            Effect.succeed({
                id: 63,
                userId: targetUserId,
                purpose: 'recovery' as const,
                url: `${origin}/auth/recover#token=plaintext`,
                expiresAt,
            }),
        revokeAccessLink: () => Effect.void,
        listAppTokens: () => Effect.succeed({ tokens: [appToken] }),
        createAppToken: () =>
            Effect.succeed({
                token: appToken,
                plaintextToken: 'plaintext-token',
            }),
        revokeAppToken: () => Effect.void,
        authenticateAppToken: () =>
            Effect.succeed({
                tokenId: appToken.id,
                user,
                scopes: appToken.scopes,
            }),
        ...overrides,
    }) as AuthService;

const makeApp = (
    service: AuthService = makeService(),
    extraDependencies: Omit<AuthRouteDependencies, 'runtimeFactory'> = {},
    operator?: AuthOperator,
) => {
    const app = new Hono<{ Bindings: Env }>();
    registerAuthRoutes(app, {
        runtimeFactory: () =>
            Effect.succeed({
                config,
                service,
                ...(operator === undefined ? {} : { operator }),
            }),
        ...extraDependencies,
    });
    return app;
};

const publicJson = (body: unknown, headers: Record<string, string> = {}) => ({
    method: 'POST',
    headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...headers,
    },
    body: JSON.stringify(body),
});

const protectedJson = (method: 'POST' | 'DELETE', body: unknown = {}) => ({
    method,
    headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-secret',
        Cookie: `${config.sessionCookie.name}=session-secret; ${config.csrfCookie.name}=csrf-secret`,
    },
    body: JSON.stringify(body),
});

const expectNoStore = (response: Response) =>
    expect(response.headers.get('cache-control')).toBe('no-store');

const decodeResponse = async <S extends Schema.ConstraintDecoder<unknown>>(
    response: Response,
    schema: S,
): Promise<S['Type']> =>
    Schema.decodeUnknownSync(schema)(await response.json());

describe('authentication routes', () => {
    it('encodes config and authenticated session responses with no-store', async () => {
        const app = makeApp();

        const configResponse = await app.request('/api/auth/config');
        expect(configResponse.status).toBe(200);
        expectNoStore(configResponse);
        await expect(
            decodeResponse(configResponse, AuthConfigResponse),
        ).resolves.toEqual({ turnstileSiteKey: 'site-key' });

        const sessionResponse = await app.request('/api/auth/session', {
            headers: {
                Cookie: `${config.sessionCookie.name}=session-secret`,
            },
        });
        expect(sessionResponse.status).toBe(200);
        expectNoStore(sessionResponse);
        await expect(
            decodeResponse(sessionResponse, AuthenticatedSessionResponse),
        ).resolves.toEqual({ authenticated: true, user, expiresAt });
    });

    it('returns the schema-encoded anonymous session without turning it into a 401', async () => {
        const app = makeApp(
            makeService({
                authenticateSession: () => Effect.fail(new Unauthenticated()),
            }),
        );

        const response = await app.request('/api/auth/session');

        expect(response.status).toBe(200);
        expectNoStore(response);
        await expect(
            decodeResponse(response, UnauthenticatedSessionResponse),
        ).resolves.toEqual({ authenticated: false });
    });

    it.each([
        ['a different Origin', { Origin: 'https://attacker.example' }],
        ['a non-JSON media type', { 'Content-Type': 'text/plain' }],
    ])(
        'rejects public ceremonies with %s before service work',
        async (_, headers) => {
            const authenticationOptions = vi.fn(() =>
                Effect.succeed({
                    challengeId: 21,
                    options: { challenge: 'challenge' },
                }),
            );
            const checkPublicCeremony = vi.fn(() => Effect.void);
            const app = makeApp(makeService({ authenticationOptions }), {
                checkPublicCeremony,
            });

            const response = await app.request(
                '/api/auth/authentication/options',
                publicJson({ turnstileToken: 'turnstile' }, headers),
            );

            expect(response.status).toBe(403);
            expectNoStore(response);
            await expect(
                decodeResponse(response, ApiErrorResponse),
            ).resolves.toEqual({
                error: {
                    code: 'csrf_invalid',
                    message: 'Request verification failed',
                },
            });
            expect(authenticationOptions).not.toHaveBeenCalled();
            expect(checkPublicCeremony).not.toHaveBeenCalled();
        },
    );

    it('passes only CF-Connecting-IP and sets secure session cookies after verification', async () => {
        const verifyAuthentication = vi.fn(() =>
            Effect.succeed({ user, expiresAt, cookies }),
        );
        const checkPublicCeremony = vi.fn(() => Effect.void);
        const app = makeApp(makeService({ verifyAuthentication }), {
            checkPublicCeremony,
        });

        const response = await app.request(
            '/api/auth/authentication/verify',
            publicJson(
                {
                    challengeId: 21,
                    turnstileToken: 'turnstile',
                    response: { id: 'credential' },
                },
                {
                    'CF-Connecting-IP': '203.0.113.10',
                    'X-Forwarded-For': '198.51.100.20',
                },
            ),
        );

        expect(response.status).toBe(200);
        expectNoStore(response);
        await expect(
            decodeResponse(response, AuthenticatedSessionResponse),
        ).resolves.toEqual({ authenticated: true, user, expiresAt });
        expect(verifyAuthentication).toHaveBeenCalledWith({
            challengeId: 21,
            turnstileToken: 'turnstile',
            response: { id: 'credential' },
            remoteIp: '203.0.113.10',
        });
        expect(checkPublicCeremony).toHaveBeenCalledWith({
            route: 'authenticationVerify',
            remoteIp: '203.0.113.10',
        });

        const setCookies = response.headers.getSetCookie();
        expect(setCookies).toHaveLength(2);
        expect(setCookies[0]).toContain(
            `${config.sessionCookie.name}=session-secret`,
        );
        expect(setCookies[0]).toContain('HttpOnly');
        expect(setCookies[0]).toContain('Secure');
        expect(setCookies[0]).toContain('SameSite=Lax');
        expect(setCookies[0]).toContain('Path=/');
        expect(setCookies[0]).toContain('Expires=');
        expect(setCookies[1]).toContain(
            `${config.csrfCookie.name}=csrf-secret`,
        );
        expect(setCookies[1]).not.toContain('HttpOnly');
        expect(setCookies[1]).toContain('Secure');
        expect(setCookies[1]).toContain('SameSite=Lax');
    });

    it('authenticates and authorizes logout before clearing both cookies', async () => {
        const authenticateSession = vi.fn(() => Effect.succeed(session));
        let mutationMetadata: MutationRequestMetadata | undefined;
        const authorizeMutation = vi.fn(
            (
                _authenticatedSession: AuthenticatedSession,
                metadata: MutationRequestMetadata,
            ) => {
                mutationMetadata = metadata;
                return Effect.succeed(undefined);
            },
        );
        const revokeSession = vi.fn(() => Effect.succeed(clearedCookies));
        const app = makeApp(
            makeService({
                authenticateSession,
                authorizeMutation,
                revokeSession,
            }),
        );

        const response = await app.request(
            '/api/auth/logout',
            protectedJson('POST'),
        );

        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expectNoStore(response);
        expect(authenticateSession).toHaveBeenCalledWith('session-secret');
        expect(mutationMetadata).toEqual({
            method: 'POST',
            origin,
            contentType: 'application/json',
            csrfCookieToken: 'csrf-secret',
            csrfHeaderToken: 'csrf-secret',
        });
        expect(revokeSession).toHaveBeenCalledWith('session-secret');

        const setCookies = response.headers.getSetCookie();
        expect(setCookies).toHaveLength(2);
        expect(setCookies[0]).toContain(`${config.sessionCookie.name}=;`);
        expect(setCookies[0]).toContain(
            'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        );
        expect(setCookies[0]).toContain('HttpOnly');
        expect(setCookies[1]).toContain(`${config.csrfCookie.name}=;`);
        expect(setCookies[1]).toContain(
            'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        );
        expect(setCookies[1]).not.toContain('HttpOnly');
    });

    it('maps authentication failures to one generic envelope', async () => {
        const app = makeApp(
            makeService({
                verifyAuthentication: () =>
                    Effect.fail(new AuthenticationFailed()),
            }),
        );

        const response = await app.request(
            '/api/auth/authentication/verify',
            publicJson({
                challengeId: 21,
                turnstileToken: 'turnstile',
                response: { id: 'credential' },
            }),
        );

        expect(response.status).toBe(401);
        expectNoStore(response);
        await expect(
            decodeResponse(response, ApiErrorResponse),
        ).resolves.toEqual({
            error: {
                code: 'authentication_failed',
                message: 'Authentication failed',
            },
        });
    });

    it('never exposes storage causes or defects', async () => {
        const failures = [
            Effect.fail(
                new AuthStorageError({
                    operation: 'private operation',
                    cause: new Error('database-password'),
                }),
            ),
            Effect.die(new Error('private defect detail')),
        ];

        for (const failure of failures) {
            const app = makeApp(
                makeService({ authenticationOptions: () => failure }),
            );
            const response = await app.request(
                '/api/auth/authentication/options',
                publicJson({ turnstileToken: 'turnstile' }),
            );
            const text = await response.text();

            expectNoStore(response);
            expect(text).not.toContain('database-password');
            expect(text).not.toContain('private operation');
            expect(text).not.toContain('private defect detail');
            expect([500, 503]).toContain(response.status);
            expect(() =>
                Schema.decodeUnknownSync(ApiErrorResponse)(JSON.parse(text)),
            ).not.toThrow();
        }
    });

    it('uses request and response schemas at the route boundary', async () => {
        const authenticationOptions = vi.fn(() =>
            Effect.succeed({
                challengeId: 21,
                options: { challenge: 'challenge' },
            }),
        );
        const invalidRequestApp = makeApp(
            makeService({ authenticationOptions }),
        );

        const invalidRequest = await invalidRequestApp.request(
            '/api/auth/authentication/options',
            publicJson({
                turnstileToken: 'turnstile',
                unexpected: 'rejected',
            }),
        );

        expect(invalidRequest.status).toBe(400);
        await expect(
            decodeResponse(invalidRequest, ApiErrorResponse),
        ).resolves.toMatchObject({ error: { code: 'validation_error' } });
        expect(authenticationOptions).not.toHaveBeenCalled();

        const invalidResponseApp = makeApp(
            makeService({
                authenticationOptions: () =>
                    Effect.succeed({
                        challengeId: 0,
                        options: { challenge: 'challenge' },
                    }),
            }),
        );
        const invalidResponse = await invalidResponseApp.request(
            '/api/auth/authentication/options',
            publicJson({ turnstileToken: 'turnstile' }),
        );

        expect(invalidResponse.status).toBe(500);
        await expect(
            decodeResponse(invalidResponse, ApiErrorResponse),
        ).resolves.toMatchObject({
            error: { code: 'internal_server_error' },
        });
    });

    it('wires passkey, admin-link, and app-token management routes', async () => {
        const deletePasskey = vi.fn(() => Effect.void);
        const createRecoveryLink = vi.fn(
            (_session: AuthenticatedSession, targetUserId: number) =>
                Effect.succeed({
                    id: 63,
                    userId: targetUserId,
                    purpose: 'recovery' as const,
                    url: `${origin}/auth/recover#token=plaintext`,
                    expiresAt,
                }),
        );
        const revokeAccessLink = vi.fn(() => Effect.void);
        const revokeAppToken = vi.fn(() => Effect.void);
        const app = makeApp(
            makeService({
                deletePasskey,
                createRecoveryLink,
                revokeAccessLink,
                revokeAppToken,
            }),
        );

        const passkeyList = await app.request('/api/auth/passkeys', {
            headers: {
                Cookie: `${config.sessionCookie.name}=session-secret`,
            },
        });
        await expect(
            decodeResponse(passkeyList, PasskeyListResponse),
        ).resolves.toEqual({ passkeys: [passkey] });

        const passkeyOptions = await app.request(
            '/api/auth/passkeys/registration/options',
            protectedJson('POST', { turnstileToken: 'turnstile' }),
        );
        await expect(
            decodeResponse(passkeyOptions, RegistrationOptionsResponse),
        ).resolves.toMatchObject({ challengeId: 23 });

        const passkeyVerify = await app.request(
            '/api/auth/passkeys/registration/verify',
            protectedJson('POST', {
                challengeId: 23,
                name: 'Laptop',
                turnstileToken: 'turnstile',
                response: { id: 'credential' },
            }),
        );
        expect(passkeyVerify.status).toBe(201);

        const passkeyDelete = await app.request(
            '/api/auth/passkeys/41',
            protectedJson('DELETE'),
        );
        expect(passkeyDelete.status).toBe(204);
        expect(deletePasskey).toHaveBeenCalledWith(session, 41);

        const enrollment = await app.request(
            '/api/auth/admin/enrollment-links',
            protectedJson('POST', {
                username: 'new-reader',
                email: 'reader@example.com',
                displayName: 'New Reader',
                isAdmin: false,
            }),
        );
        expect(enrollment.status).toBe(201);

        const recovery = await app.request(
            '/api/auth/admin/users/62/recovery-links',
            protectedJson('POST'),
        );
        expect(recovery.status).toBe(201);
        expect(createRecoveryLink).toHaveBeenCalledWith(session, 62);

        const accessDelete = await app.request(
            '/api/auth/admin/access-links/63',
            protectedJson('DELETE'),
        );
        expect(accessDelete.status).toBe(204);
        expect(revokeAccessLink).toHaveBeenCalledWith(session, 63);

        const tokenList = await app.request('/api/auth/app-tokens', {
            headers: {
                Cookie: `${config.sessionCookie.name}=session-secret`,
            },
        });
        await expect(
            decodeResponse(tokenList, AppTokenListResponse),
        ).resolves.toEqual({ tokens: [appToken] });

        const tokenCreate = await app.request(
            '/api/auth/app-tokens',
            protectedJson('POST', {
                name: 'Reader client',
                scopes: ['google-reader'],
            }),
        );
        expect(tokenCreate.status).toBe(201);

        const tokenDelete = await app.request(
            '/api/auth/app-tokens/51',
            protectedJson('DELETE'),
        );
        expect(tokenDelete.status).toBe(204);
        expect(revokeAppToken).toHaveBeenCalledWith(session, 51);

        for (const response of [
            passkeyList,
            passkeyOptions,
            passkeyVerify,
            passkeyDelete,
            enrollment,
            recovery,
            accessDelete,
            tokenList,
            tokenCreate,
            tokenDelete,
        ]) {
            expectNoStore(response);
        }
    });

    it('forwards only the bearer header and decoded operator command', async () => {
        const createAccessLink = vi.fn(() =>
            Effect.succeed({
                id: 71,
                userId: 72,
                purpose: 'enrollment' as const,
                url: `${origin}/auth/enroll#token=one-time`,
                expiresAt,
            }),
        );
        const operator = { createAccessLink } as AuthOperator;
        const response = await makeApp(makeService(), {}, operator).request(
            '/api/auth/operator/access-link',
            {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer operator-secret',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    mode: 'initial-admin',
                    username: 'admin',
                    email: 'admin@example.test',
                    displayName: 'Admin',
                }),
            },
        );

        expect(response.status).toBe(201);
        expectNoStore(response);
        expect(createAccessLink).toHaveBeenCalledWith(
            'Bearer operator-secret',
            {
                mode: 'initial-admin',
                username: 'admin',
                email: 'admin@example.test',
                displayName: 'Admin',
            },
        );
    });

    it('schema-encodes successful public ceremony options', async () => {
        const response = await makeApp().request(
            '/api/auth/authentication/options',
            publicJson({ turnstileToken: 'turnstile' }),
        );

        expect(response.status).toBe(200);
        await expect(
            decodeResponse(response, AuthenticationOptionsResponse),
        ).resolves.toEqual({
            challengeId: 21,
            options: { challenge: 'challenge' },
        });
    });
});

import {
    AccountActionResponse,
    AccountProfile,
    ApiErrorResponse,
} from '@shared/http';
import { Effect, Schema } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AuthConfig } from '../auth/config';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import { AccountForbidden } from './errors';
import { registerAccountRoutes } from './routes';
import type { AccountService } from './service';

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
const profile = AccountProfile.make({
    id: 7,
    username: 'reader',
    email: 'reader@example.test',
    displayName: 'Reader',
    isAdmin: false,
    createdAt: 1,
});

const app = () => {
    const hono = new Hono<{ Bindings: Env }>();
    const auth: AuthRuntime = {
        config,
        service: {
            authenticateSession: () => Effect.succeed(session),
            authorizeMutation: () => Effect.void,
        } as unknown as AuthService,
    };
    const service = {
        getProfile: () => Effect.succeed(profile),
        updateProfile: (
            _session: AuthenticatedSession,
            input: { readonly email: string; readonly displayName: string },
        ) =>
            Effect.succeed(
                AccountProfile.make({
                    ...profile,
                    email: input.email,
                    displayName: input.displayName,
                }),
            ),
        deleteAccount: () =>
            Effect.succeed(AccountActionResponse.make({ success: true })),
        adminOverview: () => Effect.fail(new AccountForbidden()),
    } as unknown as AccountService;
    registerAccountRoutes(hono, {
        runtimeFactory: () => Effect.succeed({ auth, service }),
    });
    return hono;
};
const decode = async <S extends Schema.ConstraintDecoder<unknown>>(
    response: Response,
    schema: S,
): Promise<S['Type']> =>
    Schema.decodeUnknownSync(schema)(await response.json());

describe('account routes', () => {
    it('returns the authenticated profile and updates typed fields', async () => {
        const get = await app().request('/api/account', {
            headers: { Cookie: `${config.sessionCookie.name}=session` },
        });
        expect(get.status).toBe(200);
        await expect(decode(get, AccountProfile)).resolves.toMatchObject({
            username: 'reader',
        });

        const patch = await app().request('/api/account', {
            method: 'PATCH',
            headers: {
                Cookie: `${config.sessionCookie.name}=session; ${config.csrfCookie.name}=csrf`,
                Origin: origin,
                'Content-Type': 'application/json',
                'X-CSRF-Token': 'csrf',
            },
            body: JSON.stringify({
                email: 'updated@example.test',
                displayName: 'Updated',
            }),
        });
        expect(patch.status).toBe(200);
        await expect(decode(patch, AccountProfile)).resolves.toMatchObject({
            email: 'updated@example.test',
            displayName: 'Updated',
        });
    });

    it('clears secure cookies after account deletion', async () => {
        const result = await app().request('/api/account', {
            method: 'DELETE',
            headers: {
                Cookie: `${config.sessionCookie.name}=session; ${config.csrfCookie.name}=csrf`,
                Origin: origin,
                'Content-Type': 'application/json',
                'X-CSRF-Token': 'csrf',
            },
            body: JSON.stringify({ confirmation: 'reader' }),
        });

        expect(result.status).toBe(200);
        const cookies = result.headers.getSetCookie().join('\n');
        expect(cookies).toContain(`${config.sessionCookie.name}=`);
        expect(cookies).toContain(`${config.csrfCookie.name}=`);
        expect(cookies).toContain('Secure');
        expect(cookies).toContain('Max-Age=0');
    });

    it('rejects excess input and maps non-admin access safely', async () => {
        const invalid = await app().request('/api/account', {
            method: 'PATCH',
            headers: {
                Cookie: `${config.sessionCookie.name}=session`,
                Origin: origin,
                'Content-Type': 'application/json',
                'X-CSRF-Token': 'csrf',
            },
            body: JSON.stringify({
                email: 'reader@example.test',
                displayName: 'Reader',
                isAdmin: true,
            }),
        });
        expect(invalid.status).toBe(400);
        await expect(decode(invalid, ApiErrorResponse)).resolves.toMatchObject({
            error: { code: 'validation_error' },
        });

        const forbidden = await app().request('/api/admin/overview', {
            headers: { Cookie: `${config.sessionCookie.name}=session` },
        });
        expect(forbidden.status).toBe(403);
        await expect(
            decode(forbidden, ApiErrorResponse),
        ).resolves.toMatchObject({
            error: { code: 'forbidden' },
        });
    });
});

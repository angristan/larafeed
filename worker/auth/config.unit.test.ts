import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
    type AuthConfigBindings,
    AuthConfigError,
    PRODUCTION_ORIGIN,
    PRODUCTION_RP_ID,
    parseAuthConfig,
} from './config';

const productionBindings = (
    overrides: Partial<AuthConfigBindings> = {},
): AuthConfigBindings => ({
    AUTH_ENVIRONMENT: 'production',
    AUTH_RP_ID: PRODUCTION_RP_ID,
    AUTH_ORIGIN: PRODUCTION_ORIGIN,
    AUTH_RP_NAME: 'Larafeed',
    AUTH_CHALLENGE_TTL_SECONDS: '300',
    AUTH_SESSION_TTL_SECONDS: '2592000',
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
    ...overrides,
});

const parseFailure = (bindings: AuthConfigBindings) =>
    Effect.runPromise(Effect.flip(parseAuthConfig(bindings)));

describe('authentication configuration', () => {
    it('parses the exact production identity and hardened cookie policy', async () => {
        const config = await Effect.runPromise(
            parseAuthConfig(productionBindings()),
        );

        expect(config).toEqual({
            environment: 'production',
            rpId: PRODUCTION_RP_ID,
            origin: PRODUCTION_ORIGIN,
            rpName: 'Larafeed',
            challengeTtlMs: 300_000,
            sessionTtlMs: 2_592_000_000,
            turnstileSiteKey: 'site-key',
            turnstileSecretKey: 'secret-key',
            sessionCookie: {
                name: '__Host-larafeed-session',
                httpOnly: true,
                secure: true,
                sameSite: 'Lax',
                path: '/',
            },
            csrfCookie: {
                name: '__Host-larafeed-csrf',
                httpOnly: false,
                secure: true,
                sameSite: 'Lax',
                path: '/',
            },
        });
    });

    it('isolates secure preview cookies by environment', async () => {
        const config = await Effect.runPromise(
            parseAuthConfig(
                productionBindings({
                    AUTH_ENVIRONMENT: 'preview',
                    AUTH_RP_ID: 'preview.larafeed.example',
                    AUTH_ORIGIN: 'https://preview.larafeed.example',
                }),
            ),
        );

        expect(config.sessionCookie).toMatchObject({
            name: '__Host-larafeed-preview-session',
            secure: true,
        });
        expect(config.csrfCookie.name).toBe('__Host-larafeed-preview-csrf');
    });

    it('allows insecure cookies only for local development origins', async () => {
        const config = await Effect.runPromise(
            parseAuthConfig(
                productionBindings({
                    AUTH_ENVIRONMENT: 'development',
                    AUTH_RP_ID: 'localhost',
                    AUTH_ORIGIN: 'http://localhost:8787',
                }),
            ),
        );

        expect(config.origin).toBe('http://localhost:8787');
        expect(config.sessionCookie).toMatchObject({
            name: 'larafeed-development-session',
            secure: false,
        });
    });

    it.each([
        [
            'a path-bearing origin',
            { AUTH_ORIGIN: `${PRODUCTION_ORIGIN}/auth` },
            'not_canonical',
        ],
        [
            'a trailing slash',
            { AUTH_ORIGIN: `${PRODUCTION_ORIGIN}/` },
            'not_canonical',
        ],
        [
            'an RP mismatch',
            { AUTH_RP_ID: 'other.stanislas.cloud' },
            'rp_origin_mismatch',
        ],
        [
            'an insecure preview',
            {
                AUTH_ENVIRONMENT: 'preview',
                AUTH_RP_ID: 'preview.local',
                AUTH_ORIGIN: 'http://preview.local',
            },
            'insecure_origin',
        ],
        [
            'a production alias',
            {
                AUTH_RP_ID: 'www.larafeed.stanislas.cloud',
                AUTH_ORIGIN: 'https://www.larafeed.stanislas.cloud',
            },
            'production_identity_mismatch',
        ],
    ] satisfies ReadonlyArray<
        readonly [string, Partial<AuthConfigBindings>, string]
    >)('rejects %s without deriving trust from the request Host', async (_, overrides, reason) => {
        const error = await parseFailure(productionBindings(overrides));

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(AuthConfigError);
        expect(error).toMatchObject({
            _tag: 'AuthConfigError',
            field: 'AUTH_ORIGIN',
            reason,
        });
    });

    it.each([
        ['29', '2592000'],
        ['601', '2592000'],
        ['300.5', '2592000'],
        ['300', '299'],
        ['300', '31536001'],
    ])('rejects unsafe challenge/session TTLs (%s, %s)', async (challengeTtl, sessionTtl) => {
        const error = await parseFailure(
            productionBindings({
                AUTH_CHALLENGE_TTL_SECONDS: challengeTtl,
                AUTH_SESSION_TTL_SECONDS: sessionTtl,
            }),
        );

        expect(error).toBeInstanceOf(AuthConfigError);
        expect(error).toMatchObject({
            field: 'bindings',
            reason: 'invalid',
        });
    });

    it('does not normalize whitespace or expose rejected secret values', async () => {
        const rejectedSecret = ' secret-that-must-not-leak ';
        const error = await parseFailure(
            productionBindings({ TURNSTILE_SECRET_KEY: rejectedSecret }),
        );

        expect(error).toMatchObject({
            field: 'TURNSTILE_SECRET_KEY',
            reason: 'invalid',
        });
        expect(error.message).not.toContain(rejectedSecret);
        expect(JSON.stringify(error)).not.toContain(rejectedSecret);
    });
});

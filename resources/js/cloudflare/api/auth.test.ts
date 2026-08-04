import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    AuthClientError,
    deletePasskey,
    getAuthConfig,
    getAuthSession,
    getPasskeyRegistrationOptions,
    listPasskeys,
    readCsrfToken,
} from './auth';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('AuthClient', () => {
    it('decodes a valid configuration response', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(Response.json({ turnstileSiteKey: 'site-key' })),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(Effect.runPromise(getAuthConfig())).resolves.toEqual({
            turnstileSiteKey: 'site-key',
        });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/auth/config',
            expect.objectContaining({
                credentials: 'same-origin',
                method: 'GET',
            }),
        );
    });

    it('decodes disabled human verification configuration', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(Response.json({ turnstileSiteKey: null })),
            ),
        );

        await expect(Effect.runPromise(getAuthConfig())).resolves.toEqual({
            turnstileSiteKey: null,
        });
    });

    it('rejects a successful response with an invalid schema', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(Response.json({ authenticated: 'yes' })),
            ),
        );

        const error = await Effect.runPromise(getAuthSession()).catch(
            (cause: unknown) => cause,
        );

        expect(error).toBeInstanceOf(AuthClientError);
        expect(error).toMatchObject({ kind: 'decode', status: 200 });
    });

    it('lists passkeys and protects registration requests with CSRF', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({
                    passkeys: [
                        {
                            id: 1,
                            name: 'Laptop',
                            transports: ['internal'],
                            backedUp: true,
                            createdAt: 1,
                            lastUsedAt: null,
                        },
                    ],
                }),
            )
            .mockResolvedValueOnce(
                Response.json({
                    challengeId: 2,
                    purpose: 'enrollment',
                    options: {},
                }),
            )
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(Effect.runPromise(listPasskeys())).resolves.toMatchObject({
            passkeys: [{ name: 'Laptop' }],
        });
        await Effect.runPromise(
            getPasskeyRegistrationOptions({
                turnstileToken: 'turnstile',
                csrfToken: 'csrf',
            }),
        );
        await Effect.runPromise(
            deletePasskey({ passkeyId: 1, csrfToken: 'csrf' }),
        );

        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            '/api/auth/passkeys/registration/options',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }),
            }),
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            '/api/auth/passkeys/1',
            expect.objectContaining({ method: 'DELETE' }),
        );
    });

    it('decodes a safe API error envelope', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json(
                        {
                            error: {
                                code: 'rate_limited',
                                message: 'Try again later.',
                            },
                        },
                        { status: 429 },
                    ),
                ),
            ),
        );

        const error = await Effect.runPromise(getAuthSession()).catch(
            (cause: unknown) => cause,
        );

        expect(error).toBeInstanceOf(AuthClientError);
        expect(error).toMatchObject({
            kind: 'status',
            status: 429,
            code: 'rate_limited',
            message: 'Try again later.',
        });
    });
});

describe('readCsrfToken', () => {
    it('reads only a Larafeed CSRF cookie', () => {
        expect(
            readCsrfToken(
                'other=value; __Host-larafeed-preview-csrf=encoded%20token',
            ),
        ).toBe('encoded token');
        expect(readCsrfToken('session=secret')).toBeUndefined();
    });
});

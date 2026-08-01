import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    AuthClientError,
    getAuthConfig,
    getAuthSession,
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

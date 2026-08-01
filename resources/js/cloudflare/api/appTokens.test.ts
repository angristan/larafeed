import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    AppTokenClientError,
    createAppToken,
    listAppTokens,
    revokeAppToken,
} from './appTokens';

const token = {
    id: 17,
    name: 'Phone reader',
    prefix: 'lf_app_abc',
    scopes: ['google-reader', 'fever'],
    createdAt: 1_900_000_000_000,
    lastUsedAt: null,
    expiresAt: null,
} as const;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('AppTokenClient', () => {
    it('lists token metadata without plaintext secrets', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.json({ tokens: [token] }))),
        );

        await expect(Effect.runPromise(listAppTokens())).resolves.toEqual({
            tokens: [token],
        });
    });

    it('creates a scoped token with CSRF and decodes the one-time secret', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(
                Response.json(
                    { token, plaintextToken: 'lf_app_one-time-secret' },
                    { status: 201 },
                ),
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(
                createAppToken({
                    name: 'Phone reader',
                    scopes: ['google-reader', 'fever'],
                    csrfToken: 'csrf-token',
                }),
            ),
        ).resolves.toEqual({
            token,
            plaintextToken: 'lf_app_one-time-secret',
        });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/auth/app-tokens',
            expect.objectContaining({
                method: 'POST',
                credentials: 'same-origin',
                body: JSON.stringify({
                    name: 'Phone reader',
                    scopes: ['google-reader', 'fever'],
                }),
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'csrf-token',
                }),
            }),
        );
    });

    it('revokes by owned token id with CSRF and accepts an empty response', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(new Response(null, { status: 204 })),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(
                revokeAppToken({ tokenId: 17, csrfToken: 'csrf-token' }),
            ),
        ).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/auth/app-tokens/17',
            expect.objectContaining({
                method: 'DELETE',
                credentials: 'same-origin',
                headers: expect.objectContaining({
                    'X-CSRF-Token': 'csrf-token',
                }),
            }),
        );
    });

    it('rejects malformed successful list responses', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.json({ tokens: 'bad' }))),
        );

        const error = await Effect.runPromise(listAppTokens()).catch(
            (cause: unknown) => cause,
        );
        expect(error).toBeInstanceOf(AppTokenClientError);
        expect(error).toMatchObject({ kind: 'decode', status: 200 });
    });
});

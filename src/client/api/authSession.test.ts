import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeAuthSession, fetchAuthSession } from './authSession';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('decodeAuthSession', () => {
    it('decodes authenticated and anonymous sessions', () => {
        expect(decodeAuthSession({ authenticated: false })).toEqual({
            authenticated: false,
        });
        expect(
            decodeAuthSession({
                authenticated: true,
                user: {
                    id: 1,
                    username: 'owner',
                    displayName: 'Owner',
                    isAdmin: true,
                },
                expiresAt: 1_900_000_000_000,
            }),
        ).toEqual({
            authenticated: true,
            user: {
                id: 1,
                username: 'owner',
                displayName: 'Owner',
                isAdmin: true,
            },
            expiresAt: 1_900_000_000_000,
        });
    });

    it('rejects malformed sessions', () => {
        expect(() =>
            decodeAuthSession({ authenticated: true, user: null }),
        ).toThrow(TypeError);
        expect(() =>
            decodeAuthSession({
                authenticated: true,
                user: {
                    id: 0,
                    username: 'owner',
                    displayName: 'Owner',
                    isAdmin: true,
                },
                expiresAt: 1,
            }),
        ).toThrow(TypeError);
    });
});

describe('fetchAuthSession', () => {
    it('preserves status and safe server messages', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json(
                        { error: { message: 'Sign in again.' } },
                        { status: 401 },
                    ),
                ),
            ),
        );

        await expect(
            fetchAuthSession(new AbortController().signal),
        ).rejects.toMatchObject({
            kind: 'status',
            status: 401,
            message: 'Sign in again.',
        });
    });
});

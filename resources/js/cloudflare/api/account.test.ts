import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    AccountClientError,
    createEnrollmentLink,
    getAccount,
    revokeAccessLink,
    updateAccount,
} from './account';

const profile = {
    id: 7,
    username: 'reader',
    email: 'reader@example.test',
    displayName: 'Reader',
    isAdmin: true,
    createdAt: 1,
};

afterEach(() => vi.unstubAllGlobals());

describe('AccountClient', () => {
    it('decodes profiles and sends CSRF-protected updates', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(Response.json(profile)));
        vi.stubGlobal('fetch', fetchMock);

        await expect(Effect.runPromise(getAccount())).resolves.toMatchObject({
            username: 'reader',
        });
        await Effect.runPromise(
            updateAccount({
                email: 'updated@example.test',
                displayName: 'Updated',
                csrfToken: 'csrf',
            }),
        );

        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            '/api/account',
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({
                    email: 'updated@example.test',
                    displayName: 'Updated',
                }),
                headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }),
            }),
        );
    });

    it('returns one-time enrollment links and revokes by id', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({
                    id: 10,
                    userId: 11,
                    purpose: 'enrollment',
                    url: 'https://example.test/auth/enroll#token=secret',
                    expiresAt: 100,
                }),
            )
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(
                createEnrollmentLink({
                    username: 'invitee',
                    email: 'invitee@example.test',
                    displayName: 'Invitee',
                    isAdmin: false,
                    csrfToken: 'csrf',
                }),
            ),
        ).resolves.toMatchObject({ purpose: 'enrollment' });
        await Effect.runPromise(
            revokeAccessLink({ linkId: 10, csrfToken: 'csrf' }),
        );

        expect(fetchMock).toHaveBeenLastCalledWith(
            '/api/auth/admin/access-links/10',
            expect.objectContaining({ method: 'DELETE' }),
        );
    });

    it('rejects malformed successful responses', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.json({ id: 'invalid' }))),
        );

        const error = await Effect.runPromise(getAccount()).catch(
            (cause: unknown) => cause,
        );
        expect(error).toBeInstanceOf(AccountClientError);
        expect(error).toMatchObject({ kind: 'decode', status: 200 });
    });
});

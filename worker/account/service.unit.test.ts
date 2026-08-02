import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedSession } from '../auth/service';
import { AccountForbidden, AccountValidationError } from './errors';
import type { AccountRepository } from './repository';
import { makeAccountService } from './service';

const session = (isAdmin = false): AuthenticatedSession => ({
    sessionId: 1,
    user: {
        id: 7,
        username: 'reader',
        displayName: 'Reader',
        isAdmin,
    },
    expiresAt: 2_000_000_000_000,
    csrfTokenHash: new Uint8Array(32),
});
const profile = {
    id: 7,
    username: 'reader',
    email: 'reader@example.test',
    displayName: 'Reader',
    isAdmin: false,
    createdAt: 1,
};
const repository = (): AccountRepository =>
    ({
        getProfile: () => Effect.succeed(profile),
        updateProfile: (input) =>
            Effect.succeed({
                ...profile,
                email: input.email,
                displayName: input.displayName,
            }),
        wipeReaderData: () => Effect.void,
        deleteAccount: () => Effect.void,
        adminOverview: () =>
            Effect.succeed({ users: [], accessLinks: [], securityEvents: [] }),
        setUserDisabled: () =>
            Effect.succeed({
                ...profile,
                disabledAt: 1,
                passkeyCount: 1,
                subscriptionCount: 0,
            }),
    }) as AccountRepository;

describe('account service', () => {
    it('normalizes valid profile fields and rejects invalid email', async () => {
        const service = makeAccountService({
            repository: repository(),
            now: () => 10,
            safeId: () => Effect.succeed(11),
        });

        await expect(
            Effect.runPromise(
                service.updateProfile(session(), {
                    email: ' READER@EXAMPLE.TEST ',
                    displayName: ' Updated Reader ',
                }),
            ),
        ).resolves.toMatchObject({
            email: 'reader@example.test',
            displayName: 'Updated Reader',
        });
        await expect(
            Effect.runPromise(
                service.updateProfile(session(), {
                    email: 'invalid',
                    displayName: 'Reader',
                }),
            ),
        ).rejects.toBeInstanceOf(AccountValidationError);
    });

    it('requires the exact username before destructive actions', async () => {
        const accountRepository = repository();
        const wipe = vi.spyOn(accountRepository, 'wipeReaderData');
        const service = makeAccountService({
            repository: accountRepository,
            safeId: () => Effect.succeed(11),
        });

        await expect(
            Effect.runPromise(service.wipeReaderData(session(), 'wrong')),
        ).rejects.toBeInstanceOf(AccountValidationError);
        expect(wipe).not.toHaveBeenCalled();
        await expect(
            Effect.runPromise(service.wipeReaderData(session(), ' reader ')),
        ).resolves.toMatchObject({ success: true });
    });

    it('keeps admin overview and lifecycle actions admin-only', async () => {
        const service = makeAccountService({
            repository: repository(),
            safeId: () => Effect.succeed(11),
        });

        await expect(
            Effect.runPromise(service.adminOverview(session(false))),
        ).rejects.toBeInstanceOf(AccountForbidden);
        await expect(
            Effect.runPromise(service.adminOverview(session(true))),
        ).resolves.toMatchObject({ users: [] });
    });
});

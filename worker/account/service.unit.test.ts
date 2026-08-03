import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedSession } from '../auth/service';
import {
    AccountForbidden,
    AccountFreshAuthenticationRequired,
    AccountValidationError,
} from './errors';
import type { AccountRepository } from './repository';
import { FRESH_AUTHENTICATION_WINDOW_MS, makeAccountService } from './service';

const currentTime = 2_000_000_000_000;
const session = (
    isAdmin = false,
    createdAt: number | null = currentTime,
): AuthenticatedSession => ({
    sessionId: 1,
    user: {
        id: 7,
        username: 'reader',
        displayName: 'Reader',
        isAdmin,
    },
    expiresAt: 2_100_000_000_000,
    ...(createdAt === null ? {} : { createdAt }),
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
                    email: 'valid@example.test',
                    displayName: 'x'.repeat(255),
                }),
            ),
        ).resolves.toMatchObject({ displayName: 'x'.repeat(255) });
        await expect(
            Effect.runPromise(
                service.updateProfile(session(), {
                    email: 'invalid',
                    displayName: 'Reader',
                }),
            ),
        ).rejects.toMatchObject({
            _tag: 'AccountValidationError',
            field: 'email',
        });
        await expect(
            Effect.runPromise(
                service.updateProfile(session(), {
                    email: 'reader@example.test',
                    displayName: 'x'.repeat(256),
                }),
            ),
        ).rejects.toMatchObject({
            _tag: 'AccountValidationError',
            field: 'displayName',
        });
    });

    it('requires the exact username before destructive actions', async () => {
        const accountRepository = repository();
        const wipe = vi.spyOn(accountRepository, 'wipeReaderData');
        const remove = vi.spyOn(accountRepository, 'deleteAccount');
        const service = makeAccountService({
            repository: accountRepository,
            now: () => currentTime,
            safeId: () => Effect.succeed(11),
        });

        await expect(
            Effect.runPromise(service.wipeReaderData(session(), 'wrong')),
        ).rejects.toBeInstanceOf(AccountValidationError);
        expect(wipe).not.toHaveBeenCalled();

        const stale = session(
            false,
            currentTime - FRESH_AUTHENTICATION_WINDOW_MS - 1,
        );
        await expect(
            Effect.runPromise(service.wipeReaderData(stale, 'reader')),
        ).rejects.toBeInstanceOf(AccountFreshAuthenticationRequired);
        await expect(
            Effect.runPromise(
                service.deleteAccount(session(false, null), 'reader'),
            ),
        ).rejects.toBeInstanceOf(AccountFreshAuthenticationRequired);
        expect(wipe).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();

        await expect(
            Effect.runPromise(service.wipeReaderData(session(), ' reader ')),
        ).resolves.toMatchObject({ success: true });
        await expect(
            Effect.runPromise(service.deleteAccount(session(), 'reader')),
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

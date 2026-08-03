import {
    AccountActionResponse,
    AccountProfile,
    AdminOverviewResponse,
} from '@shared/schemas/account';
import { Effect } from 'effect';

import { generateSafeId } from '../auth/crypto';
import type { AuthenticatedSession } from '../auth/service';
import { AccountForbidden, AccountValidationError } from './errors';
import type { AccountRepository } from './repository';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export interface AccountServiceDependencies {
    readonly repository: AccountRepository;
    readonly now?: () => number;
    readonly safeId?: () => Effect.Effect<number, unknown>;
}

export const makeAccountService = (
    dependencies: AccountServiceDependencies,
) => {
    const now = dependencies.now ?? Date.now;
    const safeId = dependencies.safeId ?? generateSafeId;
    const event = () => safeId();
    const requireAdmin = (session: AuthenticatedSession) =>
        session.user.isAdmin
            ? Effect.succeed(session)
            : Effect.fail(new AccountForbidden());
    const confirm = (session: AuthenticatedSession, confirmation: string) =>
        confirmation.trim() === session.user.username
            ? Effect.void
            : Effect.fail(
                  new AccountValidationError({ field: 'confirmation' }),
              );

    return {
        getProfile: (session: AuthenticatedSession) =>
            dependencies.repository
                .getProfile(session.user.id)
                .pipe(Effect.map((value) => AccountProfile.make(value))),

        updateProfile: (
            session: AuthenticatedSession,
            input: { readonly email: string; readonly displayName: string },
        ) =>
            Effect.gen(function* () {
                const email = input.email.trim().toLocaleLowerCase();
                const displayName = input.displayName.trim();
                if (!EMAIL_PATTERN.test(email) || email.length > 320) {
                    return yield* Effect.fail(
                        new AccountValidationError({ field: 'email' }),
                    );
                }
                if (displayName.length < 1 || displayName.length > 255) {
                    return yield* Effect.fail(
                        new AccountValidationError({ field: 'displayName' }),
                    );
                }
                const updated = yield* dependencies.repository.updateProfile({
                    userId: session.user.id,
                    email,
                    displayName,
                    eventId: yield* event(),
                    now: now(),
                });
                return AccountProfile.make(updated);
            }),

        wipeReaderData: (session: AuthenticatedSession, confirmation: string) =>
            Effect.gen(function* () {
                yield* confirm(session, confirmation);
                yield* dependencies.repository.wipeReaderData({
                    userId: session.user.id,
                    sessionId: session.sessionId,
                    eventId: yield* event(),
                    now: now(),
                });
                return AccountActionResponse.make({ success: true });
            }),

        deleteAccount: (session: AuthenticatedSession, confirmation: string) =>
            Effect.gen(function* () {
                yield* confirm(session, confirmation);
                yield* dependencies.repository.deleteAccount({
                    userId: session.user.id,
                    sessionId: session.sessionId,
                    eventId: yield* event(),
                    now: now(),
                });
                return AccountActionResponse.make({ success: true });
            }),

        adminOverview: (session: AuthenticatedSession) =>
            Effect.gen(function* () {
                yield* requireAdmin(session);
                const overview = yield* dependencies.repository.adminOverview();
                return AdminOverviewResponse.make(overview);
            }),

        setUserDisabled: (
            session: AuthenticatedSession,
            input: { readonly userId: number; readonly disabled: boolean },
        ) =>
            Effect.gen(function* () {
                yield* requireAdmin(session);
                return yield* dependencies.repository.setUserDisabled({
                    actorUserId: session.user.id,
                    targetUserId: input.userId,
                    disabled: input.disabled,
                    eventId: yield* event(),
                    now: now(),
                });
            }),
    };
};

export type AccountService = ReturnType<typeof makeAccountService>;

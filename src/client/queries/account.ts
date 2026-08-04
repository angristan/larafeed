import {
    mutationOptions,
    type QueryClient,
    queryOptions,
} from '@tanstack/react-query';
import { Effect } from 'effect';

import {
    AccountClientError,
    createEnrollmentLink,
    createRecoveryLink,
    deleteAccount,
    getAccount,
    getAdminOverview,
    revokeAccessLink,
    setUserDisabled,
    updateAccount,
    wipeAccount,
} from '../api/account';
import { listPasskeys, readCsrfToken } from '../api/auth';
import { authKeys, protectedQueryKeys } from './auth';

export const accountKeys = {
    all: [...protectedQueryKeys.all, 'account'] as const,
    profile: () => [...accountKeys.all, 'profile'] as const,
    passkeys: () => [...accountKeys.all, 'passkeys'] as const,
    admin: () => [...accountKeys.all, 'admin'] as const,
};
export const accountQueryOptions = queryOptions({
    queryKey: accountKeys.profile(),
    queryFn: ({ signal }) => Effect.runPromise(getAccount(), { signal }),
    staleTime: 30_000,
    retry: false,
});
export const passkeysQueryOptions = queryOptions({
    queryKey: accountKeys.passkeys(),
    queryFn: ({ signal }) => Effect.runPromise(listPasskeys(), { signal }),
    staleTime: 30_000,
    retry: false,
});
export const adminOverviewQueryOptions = queryOptions({
    queryKey: accountKeys.admin(),
    queryFn: ({ signal }) => Effect.runPromise(getAdminOverview(), { signal }),
    staleTime: 15_000,
    retry: false,
});

export function requireAccountCsrf(): string {
    const value = readCsrfToken();
    if (value === undefined) {
        throw new AccountClientError(
            'status',
            'Your session security token is missing. Sign in again.',
            401,
            'unauthenticated',
        );
    }
    return value;
}
export const updateAccountMutationOptions = (queryClient: QueryClient) =>
    mutationOptions({
        mutationKey: [...accountKeys.profile(), 'update'],
        retry: false,
        mutationFn: (input: {
            readonly email: string;
            readonly displayName: string;
        }) =>
            Effect.runPromise(
                updateAccount({ ...input, csrfToken: requireAccountCsrf() }),
            ),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: accountKeys.profile(),
                }),
                queryClient.invalidateQueries({ queryKey: authKeys.session() }),
            ]);
        },
    });
export const wipeAccountMutationOptions = (queryClient: QueryClient) =>
    mutationOptions({
        mutationKey: [...accountKeys.profile(), 'wipe'],
        retry: false,
        mutationFn: (input: { readonly confirmation: string }) =>
            Effect.runPromise(
                wipeAccount({ ...input, csrfToken: requireAccountCsrf() }),
            ),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: protectedQueryKeys.all,
            });
        },
    });
export const deleteAccountMutationOptions = () =>
    mutationOptions({
        mutationKey: [...accountKeys.profile(), 'delete'],
        retry: false,
        mutationFn: (input: { readonly confirmation: string }) =>
            Effect.runPromise(
                deleteAccount({ ...input, csrfToken: requireAccountCsrf() }),
            ),
    });
export const setUserDisabledMutationOptions = (queryClient: QueryClient) =>
    mutationOptions({
        mutationKey: [...accountKeys.admin(), 'user-state'],
        retry: false,
        mutationFn: (input: {
            readonly userId: number;
            readonly disabled: boolean;
        }) =>
            Effect.runPromise(
                setUserDisabled({ ...input, csrfToken: requireAccountCsrf() }),
            ),
        onSuccess: async () =>
            queryClient.invalidateQueries({ queryKey: accountKeys.admin() }),
    });
export const createEnrollmentLinkMutationOptions = (queryClient: QueryClient) =>
    mutationOptions({
        mutationKey: [...accountKeys.admin(), 'enrollment'],
        retry: false,
        mutationFn: (input: {
            readonly username: string;
            readonly email: string;
            readonly displayName: string;
            readonly isAdmin: boolean;
        }) =>
            Effect.runPromise(
                createEnrollmentLink({
                    ...input,
                    csrfToken: requireAccountCsrf(),
                }),
            ),
        onSuccess: async () =>
            queryClient.invalidateQueries({ queryKey: accountKeys.admin() }),
    });
export const createRecoveryLinkMutationOptions = (queryClient: QueryClient) =>
    mutationOptions({
        mutationKey: [...accountKeys.admin(), 'recovery'],
        retry: false,
        mutationFn: (input: { readonly userId: number }) =>
            Effect.runPromise(
                createRecoveryLink({
                    ...input,
                    csrfToken: requireAccountCsrf(),
                }),
            ),
        onSuccess: async () =>
            queryClient.invalidateQueries({ queryKey: accountKeys.admin() }),
    });
export const revokeAccessLinkMutationOptions = (queryClient: QueryClient) =>
    mutationOptions({
        mutationKey: [...accountKeys.admin(), 'revoke-link'],
        retry: false,
        mutationFn: (input: { readonly linkId: number }) =>
            Effect.runPromise(
                revokeAccessLink({ ...input, csrfToken: requireAccountCsrf() }),
            ),
        onSuccess: async () =>
            queryClient.invalidateQueries({ queryKey: accountKeys.admin() }),
    });

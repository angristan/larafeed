import type { AppTokenScope } from '@shared/schemas/auth';
import {
    mutationOptions,
    type QueryClient,
    queryOptions,
} from '@tanstack/react-query';
import { Effect } from 'effect';
import {
    type AppToken,
    AppTokenClientError,
    type CreatedAppToken,
    createAppToken,
    listAppTokens,
    revokeAppToken,
} from '../api/appTokens';
import { readCsrfToken } from '../api/auth';
import { protectedQueryKeys } from './auth';

export const appTokenKeys = {
    all: [...protectedQueryKeys.all, 'app-tokens'] as const,
    lists: () => [...appTokenKeys.all, 'list'] as const,
    list: () => [...appTokenKeys.lists(), 'current'] as const,
    create: () => [...appTokenKeys.all, 'create'] as const,
    revoke: (tokenId: number) =>
        [...appTokenKeys.all, tokenId, 'revoke'] as const,
};

export const appTokenListQueryOptions = queryOptions({
    queryKey: appTokenKeys.list(),
    queryFn: ({ signal }) => Effect.runPromise(listAppTokens(), { signal }),
    retry: false,
    staleTime: 30_000,
});

function requireCsrfToken(): string {
    const csrfToken = readCsrfToken();
    if (csrfToken === undefined) {
        throw new AppTokenClientError(
            'status',
            'Your session security token is missing. Sign in again.',
            401,
            'unauthenticated',
        );
    }

    return csrfToken;
}

export interface CreateAppTokenVariables {
    readonly name: string;
    readonly scopes: readonly AppTokenScope[];
}

export type RevealCreatedAppToken = (created: CreatedAppToken) => void;

export function createAppTokenMutationOptions(
    queryClient: QueryClient,
    revealCreatedToken: RevealCreatedAppToken,
) {
    return mutationOptions({
        mutationKey: appTokenKeys.create(),
        retry: false,
        mutationFn: async (
            input: CreateAppTokenVariables,
        ): Promise<AppToken> => {
            const created = await Effect.runPromise(
                createAppToken({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            );

            // Reveal the plaintext only to component-local state. The mutation
            // cache receives token metadata and never stores the secret.
            revealCreatedToken(created);
            return created.token;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: appTokenKeys.lists(),
            });
        },
    });
}

export function revokeAppTokenMutationOptions(
    queryClient: QueryClient,
    tokenId: number,
) {
    return mutationOptions({
        mutationKey: appTokenKeys.revoke(tokenId),
        retry: false,
        mutationFn: () =>
            Effect.runPromise(
                revokeAppToken({
                    tokenId,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: appTokenKeys.lists(),
            });
        },
    });
}

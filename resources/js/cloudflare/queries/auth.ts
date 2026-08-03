import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { Effect } from 'effect';

import {
    AuthClientError,
    type AuthSession,
    getAuthConfig,
    getAuthSession,
} from '../api/auth';

export const authKeys = {
    all: ['auth'] as const,
    config: () => [...authKeys.all, 'config'] as const,
    session: () => [...authKeys.all, 'session'] as const,
};

export const protectedQueryKeys = {
    all: ['protected'] as const,
};

export const authConfigQueryOptions = queryOptions({
    queryKey: authKeys.config(),
    queryFn: ({ signal }) => Effect.runPromise(getAuthConfig(), { signal }),
    retry: false,
    staleTime: 5 * 60_000,
});

export const authSessionQueryOptions = queryOptions({
    queryKey: authKeys.session(),
    queryFn: ({ signal }) => Effect.runPromise(getAuthSession(), { signal }),
    retry: false,
    staleTime: 30_000,
});

export function isUnauthenticatedError(error: unknown): boolean {
    if (error instanceof AuthClientError) {
        return error.status === 401;
    }

    return (
        typeof error === 'object' &&
        error !== null &&
        Reflect.get(error, 'status') === 401
    );
}

export function clearAuthenticatedCache(queryClient: QueryClient): void {
    queryClient.setQueryData<AuthSession>(authKeys.session(), {
        authenticated: false,
    });
    void queryClient.cancelQueries({ queryKey: protectedQueryKeys.all });
    queryClient.removeQueries({ queryKey: protectedQueryKeys.all });
}

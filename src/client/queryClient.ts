import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import type { AuthSession } from './api/auth';
import {
    authKeys,
    clearAuthenticatedCache,
    isUnauthenticatedError,
    protectedQueryKeys,
} from './queries/auth';

export type SessionExpiredHandler = () => void;

let appSessionExpiredHandler: SessionExpiredHandler | undefined;

export function setAppSessionExpiredHandler(
    handler: SessionExpiredHandler,
): void {
    appSessionExpiredHandler = handler;
}

export function createAppQueryClient(
    onSessionExpired?: SessionExpiredHandler,
): QueryClient {
    let client: QueryClient;

    const handleError = (error: unknown) => {
        if (!isUnauthenticatedError(error)) return;

        const session = client.getQueryData<AuthSession>(authKeys.session());
        if (session?.authenticated === false) return;

        clearAuthenticatedCache(client);
        onSessionExpired?.();
    };

    client = new QueryClient({
        queryCache: new QueryCache({ onError: handleError }),
        mutationCache: new MutationCache({ onError: handleError }),
        defaultOptions: {
            queries: {
                enabled: (query) =>
                    query.queryKey[0] !== protectedQueryKeys.all[0] ||
                    client.getQueryData<AuthSession>(authKeys.session())
                        ?.authenticated !== false,
                retry: false,
            },
            mutations: {
                retry: false,
            },
        },
    });

    return client;
}

export const queryClient = createAppQueryClient(() =>
    appSessionExpiredHandler?.(),
);

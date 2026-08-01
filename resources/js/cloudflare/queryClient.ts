import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import {
    clearAuthenticatedCache,
    isUnauthenticatedError,
} from './queries/auth';

export function createAppQueryClient(): QueryClient {
    let client: QueryClient;

    const handleError = (error: unknown) => {
        if (isUnauthenticatedError(error)) {
            clearAuthenticatedCache(client);
        }
    };

    client = new QueryClient({
        queryCache: new QueryCache({ onError: handleError }),
        mutationCache: new MutationCache({ onError: handleError }),
        defaultOptions: {
            queries: {
                retry: false,
            },
            mutations: {
                retry: false,
            },
        },
    });

    return client;
}

export const queryClient = createAppQueryClient();

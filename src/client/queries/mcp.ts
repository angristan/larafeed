import {
    mutationOptions,
    type QueryClient,
    queryOptions,
} from '@tanstack/react-query';
import { Effect } from 'effect';

import { readCsrfToken } from '../api/auth';
import {
    disconnectMcpClient,
    getMcpSettings,
    McpClientError,
    type McpSettings,
    updateMcpSettings,
} from '../api/mcp';
import { protectedQueryKeys } from './auth';

export const mcpKeys = {
    all: [...protectedQueryKeys.all, 'mcp'] as const,
    settings: () => [...mcpKeys.all, 'settings'] as const,
    update: () => [...mcpKeys.all, 'update'] as const,
    disconnect: () => [...mcpKeys.all, 'disconnect'] as const,
};

export const mcpSettingsQueryOptions = queryOptions({
    queryKey: mcpKeys.settings(),
    queryFn: ({ signal }) => Effect.runPromise(getMcpSettings(), { signal }),
    retry: false,
    staleTime: 30_000,
});

function requireCsrfToken(): string {
    const csrfToken = readCsrfToken();
    if (csrfToken === undefined) {
        throw new McpClientError(
            'Your session security token is missing. Sign in again.',
            401,
            'unauthenticated',
        );
    }
    return csrfToken;
}

// Each mutation answers with the full settings, so write them straight into
// the cache instead of refetching.
const storeSettings = (queryClient: QueryClient) => (settings: McpSettings) => {
    queryClient.setQueryData(mcpKeys.settings(), settings);
};

export function updateMcpSettingsMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: mcpKeys.update(),
        retry: false,
        mutationFn: (enabled: boolean) =>
            Effect.runPromise(
                updateMcpSettings({ enabled, csrfToken: requireCsrfToken() }),
            ),
        onSuccess: storeSettings(queryClient),
    });
}

export function disconnectMcpClientMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: mcpKeys.disconnect(),
        retry: false,
        mutationFn: (grantId: string) =>
            Effect.runPromise(
                disconnectMcpClient({ grantId, csrfToken: requireCsrfToken() }),
            ),
        onSuccess: storeSettings(queryClient),
    });
}

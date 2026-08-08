import {
    mutationOptions,
    type QueryClient,
    queryOptions,
} from '@tanstack/react-query';
import { Effect } from 'effect';

import { readCsrfToken } from '../api/auth';
import {
    FullContentClientError,
    fetchEntryFullContent,
    getEntryFullContent,
    summarizeEntryFullContent,
} from '../api/fullContent';
import { protectedQueryKeys } from './auth';

export const fullContentKeys = {
    all: [...protectedQueryKeys.all, 'full-content'] as const,
    details: () => [...fullContentKeys.all, 'detail'] as const,
    detail: (entryId: number) =>
        [...fullContentKeys.details(), entryId] as const,
    fetch: (entryId: number) =>
        [...fullContentKeys.detail(entryId), 'fetch'] as const,
    summarize: (entryId: number) =>
        [...fullContentKeys.detail(entryId), 'summarize'] as const,
};

export function entryFullContentQueryOptions(entryId: number) {
    return queryOptions({
        queryKey: fullContentKeys.detail(entryId),
        queryFn: ({ signal }) =>
            Effect.runPromise(getEntryFullContent(entryId), { signal }),
        staleTime: 60_000,
        retry: false,
    });
}

const requireCsrfToken = (): string => {
    const csrfToken = readCsrfToken();
    if (csrfToken === undefined) {
        throw new FullContentClientError(
            'status',
            'Your session security token is missing. Sign in again.',
            401,
            'unauthenticated',
        );
    }
    return csrfToken;
};

export function fetchEntryFullContentMutationOptions(
    queryClient: QueryClient,
    entryId: number,
) {
    return mutationOptions({
        mutationKey: fullContentKeys.fetch(entryId),
        scope: { id: `entry-full-content-${entryId}` },
        retry: false,
        mutationFn: () =>
            Effect.runPromise(
                fetchEntryFullContent(entryId, requireCsrfToken()),
            ),
        onSuccess: (response) => {
            queryClient.setQueryData(fullContentKeys.detail(entryId), response);
        },
    });
}

export function summarizeEntryFullContentMutationOptions(
    queryClient: QueryClient,
    entryId: number,
) {
    return mutationOptions({
        mutationKey: fullContentKeys.summarize(entryId),
        scope: { id: `entry-full-content-${entryId}` },
        retry: false,
        mutationFn: () =>
            Effect.runPromise(
                summarizeEntryFullContent(entryId, requireCsrfToken()),
            ),
        onSuccess: (response) => {
            queryClient.setQueryData(fullContentKeys.detail(entryId), response);
        },
    });
}

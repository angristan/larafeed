import {
    mutationOptions,
    type QueryClient,
    queryOptions,
} from '@tanstack/react-query';
import { Effect } from 'effect';

import { readCsrfToken } from '../api/auth';
import {
    generateEntrySummary,
    getEntrySummary,
    SummaryClientError,
} from '../api/summaries';
import { protectedQueryKeys } from './auth';

export const summaryKeys = {
    all: [...protectedQueryKeys.all, 'summaries'] as const,
    details: () => [...summaryKeys.all, 'detail'] as const,
    detail: (entryId: number) => [...summaryKeys.details(), entryId] as const,
    generate: (entryId: number) =>
        [...summaryKeys.detail(entryId), 'generate'] as const,
};

export function entrySummaryQueryOptions(entryId: number) {
    return queryOptions({
        queryKey: summaryKeys.detail(entryId),
        queryFn: ({ signal }) =>
            Effect.runPromise(getEntrySummary(entryId), { signal }),
        staleTime: 60_000,
        retry: false,
    });
}

const requireCsrfToken = (): string => {
    const csrfToken = readCsrfToken();
    if (csrfToken === undefined) {
        throw new SummaryClientError(
            'status',
            'Your session security token is missing. Sign in again.',
            401,
            'unauthenticated',
        );
    }
    return csrfToken;
};

export function generateEntrySummaryMutationOptions(
    queryClient: QueryClient,
    entryId: number,
) {
    return mutationOptions({
        mutationKey: summaryKeys.generate(entryId),
        scope: { id: `entry-summary-${entryId}` },
        retry: false,
        mutationFn: () =>
            Effect.runPromise(
                generateEntrySummary(entryId, requireCsrfToken()),
            ),
        onSuccess: (response) => {
            queryClient.setQueryData(summaryKeys.detail(entryId), response);
        },
    });
}

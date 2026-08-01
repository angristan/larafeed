import { queryOptions } from '@tanstack/react-query';
import { Effect } from 'effect';

import { getHealth, HealthClientError } from '../api/health';

export const healthKeys = {
    all: ['health'] as const,
};

function retryHealthRequest(failureCount: number, error: Error): boolean {
    if (failureCount >= 2 || !(error instanceof HealthClientError)) {
        return false;
    }

    if (error.kind === 'transport') {
        return true;
    }

    return (
        error.kind === 'status' &&
        (error.status === 408 ||
            error.status === 429 ||
            (error.status !== undefined && error.status >= 500))
    );
}

export const healthQueryOptions = queryOptions({
    queryKey: healthKeys.all,
    queryFn: ({ signal }) => Effect.runPromise(getHealth(), { signal }),
    retry: retryHealthRequest,
    staleTime: 30_000,
});

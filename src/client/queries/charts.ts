import { queryOptions } from '@tanstack/react-query';
import { Effect } from 'effect';

import { type ChartRequest, getCharts } from '../api/charts';
import { protectedQueryKeys } from './auth';

export const chartKeys = {
    all: [...protectedQueryKeys.all, 'charts'] as const,
    detail: (input: ChartRequest) => [...chartKeys.all, input] as const,
};

export const chartQueryOptions = (input: ChartRequest) =>
    queryOptions({
        queryKey: chartKeys.detail(input),
        queryFn: ({ signal }) =>
            Effect.runPromise(getCharts(input), { signal }),
        staleTime: 30_000,
        retry: false,
    });

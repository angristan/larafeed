import {
    mutationOptions,
    type QueryClient,
    queryOptions,
} from '@tanstack/react-query';
import { Effect } from 'effect';

import { readCsrfToken } from '../api/auth';
import {
    createOpmlImport,
    getOpmlImport,
    listOpmlImports,
    OpmlClientError,
    type OpmlImport,
    type OpmlImportList,
} from '../api/opml';
import { protectedQueryKeys } from './auth';

export const OPML_IMPORT_POLL_INTERVAL_MS = 5_000;

export const opmlKeys = {
    all: [...protectedQueryKeys.all, 'opml'] as const,
    imports: () => [...opmlKeys.all, 'imports'] as const,
    lists: () => [...opmlKeys.imports(), 'list'] as const,
    list: () => [...opmlKeys.lists(), 'recent'] as const,
    details: () => [...opmlKeys.imports(), 'detail'] as const,
    detail: (importId: number) => [...opmlKeys.details(), importId] as const,
    create: () => [...opmlKeys.imports(), 'create'] as const,
};

export function isActiveOpmlImport(opmlImport: OpmlImport): boolean {
    return opmlImport.state === 'pending' || opmlImport.state === 'processing';
}

export function hasActiveOpmlImports(
    response: OpmlImportList | undefined,
): boolean {
    return response?.imports.some(isActiveOpmlImport) ?? false;
}

export const opmlImportListQueryOptions = queryOptions({
    queryKey: opmlKeys.list(),
    queryFn: ({ signal }) => Effect.runPromise(listOpmlImports(), { signal }),
    staleTime: 10_000,
    retry: false,
    refetchInterval: (query) =>
        hasActiveOpmlImports(query.state.data)
            ? OPML_IMPORT_POLL_INTERVAL_MS
            : false,
});

export function opmlImportDetailQueryOptions(importId: number) {
    return queryOptions({
        queryKey: opmlKeys.detail(importId),
        queryFn: ({ signal }) =>
            Effect.runPromise(getOpmlImport(importId), { signal }),
        staleTime: 10_000,
        retry: false,
        refetchInterval: (query) =>
            query.state.data !== undefined &&
            isActiveOpmlImport(query.state.data)
                ? OPML_IMPORT_POLL_INTERVAL_MS
                : false,
    });
}

function requireCsrfToken(): string {
    const csrfToken = readCsrfToken();
    if (csrfToken === undefined) {
        throw new OpmlClientError(
            'status',
            'Your session security token is missing. Sign in again.',
            401,
            'unauthenticated',
        );
    }

    return csrfToken;
}

export interface CreateOpmlImportVariables {
    readonly opml: string;
    readonly filename?: string;
}

export function createOpmlImportMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: opmlKeys.create(),
        retry: false,
        mutationFn: (input: CreateOpmlImportVariables) =>
            Effect.runPromise(
                createOpmlImport({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async (opmlImport) => {
            queryClient.setQueryData(
                opmlKeys.detail(opmlImport.id),
                opmlImport,
            );
            await queryClient.invalidateQueries({
                queryKey: opmlKeys.lists(),
            });
        },
    });
}

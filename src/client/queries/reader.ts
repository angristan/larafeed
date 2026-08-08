import {
    type InfiniteData,
    infiniteQueryOptions,
    type QueryClient,
    queryOptions,
} from '@tanstack/react-query';
import { Effect } from 'effect';

import {
    getEntry,
    getReaderCounts,
    listCategories,
    listEntries,
    listSubscriptions,
    type ReaderEntry,
    type ReaderEntryListInput,
    type ReaderEntryPage,
    type ReaderInteraction,
} from '../api/reader';
import { protectedQueryKeys } from './auth';

export const readerKeys = {
    all: [...protectedQueryKeys.all, 'reader'] as const,
    counts: () => [...readerKeys.all, 'counts'] as const,
};

export const categoryKeys = {
    all: [...readerKeys.all, 'categories'] as const,
    lists: () => [...categoryKeys.all, 'list'] as const,
    list: () => [...categoryKeys.lists(), 'all'] as const,
};

export const subscriptionKeys = {
    all: [...readerKeys.all, 'subscriptions'] as const,
    lists: () => [...subscriptionKeys.all, 'list'] as const,
    list: () => [...subscriptionKeys.lists(), 'all'] as const,
};

export const entryKeys = {
    all: [...readerKeys.all, 'entries'] as const,
    lists: () => [...entryKeys.all, 'infinite-list'] as const,
    list: (scope: ReaderEntryListScope) =>
        [...entryKeys.lists(), scope] as const,
    details: () => [...entryKeys.all, 'detail'] as const,
    detail: (entryId: number) => [...entryKeys.details(), entryId] as const,
    interactions: () => [...entryKeys.all, 'interaction'] as const,
    interaction: (entryId: number, kind: 'read' | 'star' | 'archive') =>
        [...entryKeys.interactions(), entryId, kind] as const,
};

export const categoryListQueryOptions = queryOptions({
    queryKey: categoryKeys.list(),
    queryFn: ({ signal }) => Effect.runPromise(listCategories(), { signal }),
    staleTime: 30_000,
    retry: false,
});

export const subscriptionListQueryOptions = queryOptions({
    queryKey: subscriptionKeys.list(),
    queryFn: ({ signal }) => Effect.runPromise(listSubscriptions(), { signal }),
    staleTime: 20_000,
    retry: false,
});

export const readerCountsQueryOptions = queryOptions({
    queryKey: readerKeys.counts(),
    queryFn: ({ signal }) => Effect.runPromise(getReaderCounts(), { signal }),
    staleTime: 15_000,
    retry: false,
});

export type ReaderEntryListScope = Omit<ReaderEntryListInput, 'cursor'>;

export function entryListInfiniteQueryOptions(scope: ReaderEntryListScope) {
    return infiniteQueryOptions({
        queryKey: entryKeys.list(scope),
        queryFn: ({ pageParam, signal }) =>
            Effect.runPromise(listEntries({ ...scope, cursor: pageParam }), {
                signal,
            }),
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        staleTime: 20_000,
        // A focus refetch replays every loaded page sequentially; entry
        // interactions already patch this cache surgically.
        refetchOnWindowFocus: false,
        retry: false,
    });
}

export function entryDetailQueryOptions(entryId: number) {
    return queryOptions({
        queryKey: entryKeys.detail(entryId),
        queryFn: ({ signal }) =>
            Effect.runPromise(getEntry(entryId), { signal }),
        staleTime: 30_000,
        retry: false,
    });
}

function patchEntry<A extends ReaderEntryPage['entries'][number]>(
    entry: A,
    interaction: ReaderInteraction,
): A {
    if (entry.id !== interaction.entryId) {
        return entry;
    }

    return {
        ...entry,
        read: interaction.read,
        starred: interaction.starred,
        archived: interaction.archived,
    };
}

export function reconcileReaderInteraction(
    queryClient: QueryClient,
    interaction: ReaderInteraction,
): void {
    queryClient.setQueryData<ReaderEntry>(
        entryKeys.detail(interaction.entryId),
        (current) =>
            current === undefined
                ? current
                : {
                      ...current,
                      read: interaction.read,
                      readChangedAt: interaction.readChangedAt,
                      starred: interaction.starred,
                      starredAt: interaction.starredAt,
                      archived: interaction.archived,
                      archivedAt: interaction.archivedAt,
                  },
    );

    queryClient.setQueriesData<InfiniteData<ReaderEntryPage>>(
        { queryKey: entryKeys.lists() },
        (current) =>
            current === undefined
                ? current
                : {
                      ...current,
                      pages: current.pages.map((page) => ({
                          ...page,
                          entries: page.entries.map((entry) =>
                              patchEntry(entry, interaction),
                          ),
                      })),
                  },
    );
}

export async function invalidateReaderAfterInteraction(
    queryClient: QueryClient,
): Promise<void> {
    await Promise.all([
        // The authoritative interaction response already patches all retained
        // pages. Keeping them fresh avoids removing the selected unread or
        // favorite entry while the user reads through the current page.
        queryClient.invalidateQueries({ queryKey: readerKeys.counts() }),
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.lists() }),
    ]);
}

export async function invalidateReaderAfterReadThrough(
    queryClient: QueryClient,
): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: entryKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: readerKeys.counts() }),
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.lists() }),
    ]);
}

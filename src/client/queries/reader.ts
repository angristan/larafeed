import { type QueryClient, queryOptions } from '@tanstack/react-query';
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
    finiteLists: () => [...entryKeys.all, 'finite-list'] as const,
    list: (input: ReaderEntryListInput) =>
        [...entryKeys.finiteLists(), input] as const,
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

function sameEntryListExceptPage(
    previous: ReaderEntryListInput,
    next: ReaderEntryListInput,
): boolean {
    return (
        previous.feedId === next.feedId &&
        previous.categoryId === next.categoryId &&
        previous.filter === next.filter &&
        previous.orderBy === next.orderBy &&
        previous.pageSize === next.pageSize &&
        previous.page !== next.page
    );
}

function isEntryListInput(value: unknown): value is ReaderEntryListInput {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const input = value as Partial<ReaderEntryListInput>;
    return (
        (typeof input.feedId === 'number' || input.feedId === null) &&
        (typeof input.categoryId === 'number' || input.categoryId === null) &&
        typeof input.filter === 'string' &&
        typeof input.orderBy === 'string' &&
        typeof input.page === 'number' &&
        typeof input.pageSize === 'number'
    );
}

export function shouldRetainPreviousEntryPage(
    previousQueryKey: readonly unknown[] | undefined,
    next: ReaderEntryListInput,
): boolean {
    const previousInput = previousQueryKey?.at(-1);
    return (
        isEntryListInput(previousInput) &&
        sameEntryListExceptPage(previousInput, next)
    );
}

export function entryListQueryOptions(input: ReaderEntryListInput) {
    return queryOptions({
        queryKey: entryKeys.list(input),
        queryFn: ({ signal }) =>
            Effect.runPromise(listEntries(input), { signal }),
        placeholderData: (previousData, previousQuery) =>
            shouldRetainPreviousEntryPage(previousQuery?.queryKey, input)
                ? previousData
                : undefined,
        staleTime: 20_000,
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

    queryClient.setQueriesData<ReaderEntryPage>(
        { queryKey: entryKeys.finiteLists() },
        (current) =>
            current === undefined
                ? current
                : {
                      ...current,
                      entries: current.entries.map((entry) =>
                          patchEntry(entry, interaction),
                      ),
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
        queryClient.invalidateQueries({ queryKey: entryKeys.finiteLists() }),
        queryClient.invalidateQueries({ queryKey: readerKeys.counts() }),
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.lists() }),
    ]);
}

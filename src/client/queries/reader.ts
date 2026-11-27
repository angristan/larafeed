import {
    type InfiniteData,
    infiniteQueryOptions,
    type QueryClient,
    queryOptions,
} from '@tanstack/react-query';
import type {
    ReaderCounts,
    ReaderEntry,
    ReaderEntryListInput,
    ReaderEntryPage,
    ReaderInteraction,
    ReaderSubscriptionList,
} from '../api/reader';
import {
    fetchReaderJson,
    type ReaderJsonResponse,
    readerEntryListPath,
} from '../api/readerRequest';
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

type ReaderDecoders = typeof import('../api/readerDecoders');
type ReaderDecoder<A> = (response: ReaderJsonResponse) => Promise<A>;

function fetchAndDecode<A>(
    path: string,
    signal: AbortSignal,
    selectDecoder: (decoders: ReaderDecoders) => ReaderDecoder<A>,
): Promise<A> {
    // Start the request before importing Effect Schema. Network and decoder
    // loading now overlap instead of forming a route-load waterfall.
    const response = fetchReaderJson(path, signal);
    const decoders = import('../api/readerDecoders');

    return Promise.all([response, decoders]).then(([result, loaded]) =>
        selectDecoder(loaded)(result),
    );
}

export const categoryListQueryOptions = queryOptions({
    queryKey: categoryKeys.list(),
    queryFn: ({ signal }) =>
        fetchAndDecode(
            '/api/categories',
            signal,
            (decoders) => decoders.decodeReaderCategoryList,
        ),
    staleTime: 30_000,
    retry: false,
});

const BADGE_STALE_TIME = 5 * 60_000;

export const subscriptionListQueryOptions = queryOptions({
    queryKey: subscriptionKeys.list(),
    queryFn: ({ signal }) =>
        fetchAndDecode(
            '/api/subscriptions',
            signal,
            (decoders) => decoders.decodeReaderSubscriptionList,
        ),
    // Entry interactions patch the unread badges in place, and read-throughs
    // and subscription changes invalidate them, so a short stale time only
    // made every tab focus refetch the library. Feed refreshes still show up
    // on the first focus after this window.
    staleTime: BADGE_STALE_TIME,
    retry: false,
});

export const readerCountsQueryOptions = queryOptions({
    queryKey: readerKeys.counts(),
    queryFn: ({ signal }) =>
        fetchAndDecode(
            '/api/entries/counts',
            signal,
            (decoders) => decoders.decodeReaderCounts,
        ),
    staleTime: BADGE_STALE_TIME,
    retry: false,
});

export type ReaderEntryListScope = Omit<ReaderEntryListInput, 'cursor'>;

export function entryListInfiniteQueryOptions(scope: ReaderEntryListScope) {
    return infiniteQueryOptions({
        queryKey: entryKeys.list(scope),
        queryFn: ({ pageParam, signal }) =>
            fetchAndDecode(
                readerEntryListPath({ ...scope, cursor: pageParam }),
                signal,
                (decoders) => decoders.decodeReaderEntryPage,
            ),
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
            fetchAndDecode(
                `/api/entries/${entryId}`,
                signal,
                (decoders) => decoders.decodeReaderEntry,
            ),
        // A long stale time keeps revisits and prefetched neighbours instant.
        // Single-entry interactions patch this cache through
        // reconcileReaderInteraction, and bulk read-throughs invalidate it.
        // Content that a feed refresh rewrites shows up once the entry goes
        // stale, which is acceptable for a reader.
        staleTime: 5 * 60_000,
        retry: false,
    });
}

function patchEntry<A extends ReaderEntryPage['entries'][number]>(
    entry: A,
    interaction: ReaderInteraction,
): A {
    if (
        entry.id !== interaction.entryId ||
        (entry.read === interaction.read &&
            entry.starred === interaction.starred &&
            entry.archived === interaction.archived)
    ) {
        return entry;
    }

    return {
        ...entry,
        read: interaction.read,
        starred: interaction.starred,
        archived: interaction.archived,
    };
}

// Returns the same page when it does not hold the entry or nothing changed,
// so the other cached lists and pages keep their references.
function patchEntryPage(
    page: ReaderEntryPage,
    interaction: ReaderInteraction,
): ReaderEntryPage {
    const index = page.entries.findIndex(
        (entry) => entry.id === interaction.entryId,
    );
    const entry = page.entries[index];
    if (entry === undefined) {
        return page;
    }
    const patched = patchEntry(entry, interaction);
    if (patched === entry) {
        return page;
    }
    const entries = [...page.entries];
    entries[index] = patched;
    return { ...page, entries };
}

function patchEntryList(
    data: InfiniteData<ReaderEntryPage>,
    interaction: ReaderInteraction,
): InfiniteData<ReaderEntryPage> {
    let changed = false;
    const pages = data.pages.map((page) => {
        const patched = patchEntryPage(page, interaction);
        if (patched !== page) changed = true;
        return patched;
    });
    return changed ? { ...data, pages } : data;
}

function patchSubscriptionUnread(
    queryClient: QueryClient,
    feedId: number,
    unreadDelta: number,
): void {
    if (unreadDelta === 0) {
        return;
    }

    // Only the changed subscription gets a new object. The other rows keep
    // their references so memoized consumers skip them.
    queryClient.setQueriesData<ReaderSubscriptionList>(
        { queryKey: subscriptionKeys.lists() },
        (current) => {
            if (current === undefined) {
                return current;
            }
            const index = current.subscriptions.findIndex(
                (subscription) => subscription.feedId === feedId,
            );
            const subscription = current.subscriptions[index];
            if (subscription === undefined) {
                return current;
            }
            const unreadCount = Math.max(
                0,
                subscription.unreadCount + unreadDelta,
            );
            if (unreadCount === subscription.unreadCount) {
                return current;
            }
            const subscriptions = [...current.subscriptions];
            subscriptions[index] = { ...subscription, unreadCount };
            return { ...current, subscriptions };
        },
    );
}

function patchCounts(
    queryClient: QueryClient,
    unreadDelta: number,
    starredDelta: number,
): void {
    if (unreadDelta === 0 && starredDelta === 0) {
        return;
    }

    queryClient.setQueryData<ReaderCounts>(readerKeys.counts(), (current) =>
        current === undefined
            ? current
            : {
                  ...current,
                  unread: Math.max(0, current.unread + unreadDelta),
                  read: Math.max(0, current.read - unreadDelta),
                  starred: Math.max(0, current.starred + starredDelta),
              },
    );
}

type CachedEntryState = Pick<ReaderEntry, 'feedId' | 'read' | 'starred'>;

// The open entry's detail is the usual source. A list row covers actions
// taken before the detail loads.
function cachedEntryState(
    queryClient: QueryClient,
    entryId: number,
): CachedEntryState | undefined {
    const detail = queryClient.getQueryData<ReaderEntry>(
        entryKeys.detail(entryId),
    );
    if (detail !== undefined) {
        return detail;
    }

    for (const [, data] of queryClient.getQueriesData<
        InfiniteData<ReaderEntryPage>
    >({ queryKey: entryKeys.lists() })) {
        for (const page of data?.pages ?? []) {
            const entry = page.entries.find(
                (candidate) => candidate.id === entryId,
            );
            if (entry !== undefined) {
                return entry;
            }
        }
    }
    return undefined;
}

export function reconcileReaderInteraction(
    queryClient: QueryClient,
    interaction: ReaderInteraction,
): void {
    // The server counts every entry in the user's feeds to answer a counts
    // request, so the badges move by the change instead of refetching.
    const previous = cachedEntryState(queryClient, interaction.entryId);
    if (
        previous === undefined ||
        queryClient.isFetching({ queryKey: readerKeys.counts() }) > 0
    ) {
        // Without the previous state there is no delta, and a counts request
        // already in flight may or may not include this change.
        void queryClient.invalidateQueries({ queryKey: readerKeys.counts() });
    }
    if (previous !== undefined) {
        const unreadDelta =
            previous.read === interaction.read ? 0 : interaction.read ? -1 : 1;
        patchSubscriptionUnread(queryClient, previous.feedId, unreadDelta);
        patchCounts(
            queryClient,
            unreadDelta,
            Number(interaction.starred) - Number(previous.starred),
        );
    }

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
                : patchEntryList(current, interaction),
    );
}

export async function invalidateReaderAfterInteraction(
    queryClient: QueryClient,
): Promise<void> {
    // The interaction response already patched the retained pages and the
    // counts. Keeping the pages fresh avoids removing the selected unread or
    // favorite entry while the user reads through the current page.
    await Promise.all([
        // The feed badge was already patched from the interaction response.
        // Refetching the whole library here re-rendered every feed row in the
        // sidebar, which cost more than the click that triggered it; the list
        // refreshes on the next natural read instead.
        queryClient.invalidateQueries({
            queryKey: subscriptionKeys.lists(),
            refetchType: 'none',
        }),
    ]);
}

export async function invalidateReaderAfterReadThrough(
    queryClient: QueryClient,
): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: entryKeys.lists() }),
        // A read-through flips the read flag of many entries at once, and the
        // response does not list them. Cached details, including prefetched
        // neighbours, would otherwise show them as unread until they go stale.
        queryClient.invalidateQueries({ queryKey: entryKeys.details() }),
        queryClient.invalidateQueries({ queryKey: readerKeys.counts() }),
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.lists() }),
    ]);
}

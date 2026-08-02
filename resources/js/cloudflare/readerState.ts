import type { ReaderFilter, ReaderOrder } from '@shared/http';

export const READER_PAGE_SIZE = 30;

export interface ReaderState {
    readonly feedId: number | null;
    readonly categoryId: number | null;
    readonly filter: ReaderFilter;
    readonly orderBy: ReaderOrder;
    readonly page: number;
    readonly entryId: number | null;
}

export type ReaderStatePatch = Partial<ReaderState>;

const filters = new Set<ReaderFilter>(['all', 'unread', 'read', 'favorites']);
const orders = new Set<ReaderOrder>(['published_at', 'created_at']);

function positiveSafeInteger(
    value: string | null,
    maximum = Number.MAX_SAFE_INTEGER,
): number | null {
    if (value === null || !/^[1-9]\d*$/.test(value)) {
        return null;
    }

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

export function parseReaderState(search: URLSearchParams): ReaderState {
    const feedId = positiveSafeInteger(search.get('feed'));
    const requestedCategoryId = positiveSafeInteger(search.get('category'));
    const requestedFilter = search.get('filter');
    const requestedOrder = search.get('order_by');

    return {
        feedId,
        categoryId: feedId === null ? requestedCategoryId : null,
        filter:
            requestedFilter !== null &&
            filters.has(requestedFilter as ReaderFilter)
                ? (requestedFilter as ReaderFilter)
                : 'all',
        orderBy:
            requestedOrder !== null && orders.has(requestedOrder as ReaderOrder)
                ? (requestedOrder as ReaderOrder)
                : 'published_at',
        page: positiveSafeInteger(search.get('page'), 10_000) ?? 1,
        entryId: positiveSafeInteger(search.get('entry')),
    };
}

export function readerStateSearch(state: ReaderState): URLSearchParams {
    const search = new URLSearchParams();

    if (state.feedId !== null) {
        search.set('feed', state.feedId.toString());
    } else if (state.categoryId !== null) {
        search.set('category', state.categoryId.toString());
    }

    search.set('filter', state.filter);
    search.set('order_by', state.orderBy);
    search.set('page', state.page.toString());

    if (state.entryId !== null) {
        search.set('entry', state.entryId.toString());
    }

    return search;
}

export function canonicalReaderSearch(search: URLSearchParams): string {
    return readerStateSearch(parseReaderState(search)).toString();
}

export function canonicalReaderRouteSearch(search: URLSearchParams): string {
    const canonical = new URLSearchParams(canonicalReaderSearch(search));
    const addFeedUrl = search.get('addFeedUrl');
    if (addFeedUrl !== null && addFeedUrl.length <= 2_048) {
        canonical.set('addFeedUrl', addFeedUrl);
    }
    return canonical.toString();
}

export function patchReaderState(
    current: ReaderState,
    patch: ReaderStatePatch,
): ReaderState {
    const changesList =
        'feedId' in patch ||
        'categoryId' in patch ||
        'filter' in patch ||
        'orderBy' in patch ||
        'page' in patch;

    let feedId = 'feedId' in patch ? (patch.feedId ?? null) : current.feedId;
    let categoryId =
        'categoryId' in patch ? (patch.categoryId ?? null) : current.categoryId;

    if ('feedId' in patch && patch.feedId !== null) {
        categoryId = null;
    } else if ('categoryId' in patch && patch.categoryId !== null) {
        feedId = null;
    }

    return {
        feedId,
        categoryId,
        filter: patch.filter ?? current.filter,
        orderBy: patch.orderBy ?? current.orderBy,
        page: patch.page ?? (changesList ? 1 : current.page),
        entryId:
            'entryId' in patch
                ? (patch.entryId ?? null)
                : changesList
                  ? null
                  : current.entryId,
    };
}

export function readerHref(
    current: ReaderState,
    patch: ReaderStatePatch = {},
): string {
    const search = readerStateSearch(patchReaderState(current, patch));
    return `/feeds?${search.toString()}`;
}

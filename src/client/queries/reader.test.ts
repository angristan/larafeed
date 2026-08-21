import {
    type InfiniteData,
    QueryClient,
    QueryObserver,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    ReaderEntry,
    ReaderEntryPage,
    ReaderInteraction,
} from '../api/reader';
import {
    categoryKeys,
    categoryListQueryOptions,
    entryKeys,
    entryListInfiniteQueryOptions,
    invalidateReaderAfterInteraction,
    type ReaderEntryListScope,
    readerKeys,
    reconcileReaderInteraction,
    subscriptionKeys,
} from './reader';
import {
    entryReadMutationOptions,
    entryStarMutationOptions,
} from './readerMutations';

const listScope: ReaderEntryListScope = {
    feedId: 3,
    categoryId: null,
    filter: 'unread',
    orderBy: 'published_at',
    pageSize: 30,
};

const detail: ReaderEntry = {
    id: 7,
    feedId: 3,
    title: 'A stable entry',
    url: 'https://example.com/entry',
    author: 'Author',
    publishedAt: 1_900_000_000_000,
    createdAt: 1_900_000_000_100,
    feedName: 'Example feed',
    customFeedName: null,
    faviconUrl: null,
    faviconIsDark: null,
    read: false,
    starred: false,
    archived: false,
    contentHtml: '<p>Content</p>',
    readChangedAt: null,
    starredAt: null,
    archivedAt: null,
};

const page: ReaderEntryPage = {
    entries: [
        {
            id: detail.id,
            feedId: detail.feedId,
            title: detail.title,
            url: detail.url,
            author: detail.author,
            publishedAt: detail.publishedAt,
            createdAt: detail.createdAt,
            feedName: detail.feedName,
            customFeedName: detail.customFeedName,
            faviconUrl: detail.faviconUrl,
            faviconIsDark: detail.faviconIsDark,
            read: detail.read,
            starred: detail.starred,
            archived: detail.archived,
        },
    ],
    total: 31,
    nextCursor: '1900000000000:7',
};

const infinitePage: InfiniteData<ReaderEntryPage> = {
    pages: [page],
    pageParams: [null],
};

afterEach(() => {
    vi.unstubAllGlobals();
});

const interaction: ReaderInteraction = {
    entryId: 7,
    feedId: 3,
    read: true,
    readChangedAt: 1_900_000_001_000,
    starred: true,
    starredAt: 1_900_000_001_000,
    archived: false,
    archivedAt: null,
};

describe('reader query contracts', () => {
    it('starts the request immediately and decodes when it completes', async () => {
        let resolveResponse: ((response: Response) => void) | undefined;
        const fetchMock = vi.fn(
            () =>
                new Promise<Response>((resolve) => {
                    resolveResponse = resolve;
                }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });

        const result = queryClient.fetchQuery(categoryListQueryOptions);
        expect(fetchMock).toHaveBeenCalledOnce();

        resolveResponse?.(Response.json({ categories: [] }));
        await expect(result).resolves.toEqual({ categories: [] });
    });

    it('includes the whole list scope in a hierarchical key', () => {
        expect(entryKeys.list(listScope)).toEqual([
            'protected',
            'reader',
            'entries',
            'infinite-list',
            listScope,
        ]);
        expect(entryKeys.detail(7)).toEqual([
            'protected',
            'reader',
            'entries',
            'detail',
            7,
        ]);
        expect(entryListInfiniteQueryOptions(listScope).queryKey).toEqual(
            entryKeys.list(listScope),
        );
    });

    it('follows the server cursor until the last page is loaded', () => {
        const options = entryListInfiniteQueryOptions(listScope);
        expect(options.initialPageParam).toBeNull();
        expect(options.getNextPageParam(page, [page], null, [null])).toBe(
            '1900000000000:7',
        );

        const lastPage: ReaderEntryPage = { ...page, nextCursor: null };
        expect(
            options.getNextPageParam(
                lastPage,
                [page, lastPage],
                '1900000000000:7',
                [null, '1900000000000:7'],
            ),
        ).toBeUndefined();
    });

    it('patches retained detail and list data from authoritative results', () => {
        const queryClient = new QueryClient();
        queryClient.setQueryData<ReaderEntry>(entryKeys.detail(7), detail);
        queryClient.setQueryData<InfiniteData<ReaderEntryPage>>(
            entryKeys.list(listScope),
            infinitePage,
        );

        reconcileReaderInteraction(queryClient, interaction);

        expect(queryClient.getQueryData(entryKeys.detail(7))).toMatchObject({
            read: true,
            readChangedAt: interaction.readChangedAt,
            starred: true,
            starredAt: interaction.starredAt,
            archived: false,
        });
        expect(
            queryClient.getQueryData(entryKeys.list(listScope)),
        ).toMatchObject({
            pages: [
                {
                    entries: [
                        {
                            id: 7,
                            read: true,
                            starred: true,
                            archived: false,
                        },
                    ],
                },
            ],
        });
    });

    it('keeps retained lists stable while invalidating counts', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const queryFn = vi.fn(() => Promise.resolve(page));
        const observer = new QueryObserver(queryClient, {
            queryKey: entryKeys.list(listScope),
            queryFn,
        });
        const unsubscribe = observer.subscribe(() => undefined);
        await observer.refetch();
        queryClient.setQueryData(readerKeys.counts(), { total: 1 });
        queryClient.setQueryData(subscriptionKeys.list(), {
            subscriptions: [],
        });
        queryClient.setQueryData(categoryKeys.list(), { categories: [] });

        await invalidateReaderAfterInteraction(queryClient);

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(observer.getCurrentResult().data).toEqual(page);
        expect(
            queryClient.getQueryState(entryKeys.list(listScope))?.isInvalidated,
        ).toBe(false);
        expect(
            queryClient.getQueryState(readerKeys.counts())?.isInvalidated,
        ).toBe(true);
        expect(
            queryClient.getQueryState(subscriptionKeys.list())?.isInvalidated,
        ).toBe(true);
        expect(
            queryClient.getQueryState(categoryKeys.list())?.isInvalidated,
        ).toBe(false);
        unsubscribe();
    });

    it('serializes all interaction kinds for the same entry', () => {
        const queryClient = new QueryClient();
        const readOptions = entryReadMutationOptions(queryClient, 7);
        const starOptions = entryStarMutationOptions(queryClient, 7);
        const anotherEntry = entryReadMutationOptions(queryClient, 8);

        expect(readOptions.scope).toEqual({ id: 'reader-entry-7' });
        expect(starOptions.scope).toEqual(readOptions.scope);
        expect(anotherEntry.scope).toEqual({ id: 'reader-entry-8' });
        expect(readOptions.retry).toBe(false);
    });
});

import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type {
    ReaderEntry,
    ReaderEntryListInput,
    ReaderEntryPage,
    ReaderInteraction,
} from '../api/reader';
import {
    categoryKeys,
    entryKeys,
    entryListQueryOptions,
    invalidateReaderAfterInteraction,
    readerKeys,
    reconcileReaderInteraction,
    shouldRetainPreviousEntryPage,
    subscriptionKeys,
} from './reader';
import {
    entryReadMutationOptions,
    entryStarMutationOptions,
} from './readerMutations';

const listInput: ReaderEntryListInput = {
    feedId: 3,
    categoryId: null,
    filter: 'unread',
    orderBy: 'published_at',
    page: 2,
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
    pagination: {
        page: 2,
        pageSize: 30,
        total: 31,
        totalPages: 2,
    },
};

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
    it('includes every finite-list input in a hierarchical key', () => {
        expect(entryKeys.list(listInput)).toEqual([
            'protected',
            'reader',
            'entries',
            'finite-list',
            listInput,
        ]);
        expect(entryKeys.detail(7)).toEqual([
            'protected',
            'reader',
            'entries',
            'detail',
            7,
        ]);
        expect(entryListQueryOptions(listInput).queryKey).toEqual(
            entryKeys.list(listInput),
        );
    });

    it('retains placeholder data only for a page transition', () => {
        expect(
            shouldRetainPreviousEntryPage(entryKeys.list(listInput), {
                ...listInput,
                page: 3,
            }),
        ).toBe(true);
        expect(
            shouldRetainPreviousEntryPage(entryKeys.list(listInput), {
                ...listInput,
                filter: 'favorites',
                page: 1,
            }),
        ).toBe(false);
        expect(
            shouldRetainPreviousEntryPage(entryKeys.list(listInput), listInput),
        ).toBe(false);
        expect(entryListQueryOptions(listInput).placeholderData).toBeTypeOf(
            'function',
        );
    });

    it('patches retained detail and finite-list data from authoritative results', () => {
        const queryClient = new QueryClient();
        queryClient.setQueryData<ReaderEntry>(entryKeys.detail(7), detail);
        queryClient.setQueryData<ReaderEntryPage>(
            entryKeys.list(listInput),
            page,
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
            queryClient.getQueryData(entryKeys.list(listInput)),
        ).toMatchObject({
            entries: [
                {
                    id: 7,
                    read: true,
                    starred: true,
                    archived: false,
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
            queryKey: entryKeys.list(listInput),
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
            queryClient.getQueryState(entryKeys.list(listInput))?.isInvalidated,
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

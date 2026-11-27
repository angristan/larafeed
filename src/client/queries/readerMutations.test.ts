import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { entryKeys, readerKeys, subscriptionKeys } from './reader';
import {
    categoryReadThroughMutationOptions,
    readThroughMutationOptions,
} from './readerMutations';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('feed read-through mutation', () => {
    it('invalidates reader data after every successful command', async () => {
        vi.stubGlobal('document', {
            cookie: 'larafeed-csrf=csrf-token',
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json({ feedId: 7, readThroughEntryId: 70 }),
                ),
            ),
        );
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        });
        const entryListKey = [...entryKeys.lists(), 'cached-page'] as const;
        queryClient.setQueryData(entryListKey, { entries: [] });
        queryClient.setQueryData(readerKeys.counts(), { unread: 2 });
        queryClient.setQueryData(subscriptionKeys.list(), {
            subscriptions: [],
        });
        const observer = new MutationObserver(
            queryClient,
            readThroughMutationOptions(queryClient, 7),
        );

        await observer.mutate(undefined);

        expect(queryClient.getQueryState(entryListKey)?.isInvalidated).toBe(
            true,
        );
        expect(
            queryClient.getQueryState(readerKeys.counts())?.isInvalidated,
        ).toBe(true);
        expect(
            queryClient.getQueryState(subscriptionKeys.list())?.isInvalidated,
        ).toBe(true);
    });
});

describe('category read-through mutation', () => {
    it('marks the whole category read with one request and refreshes reader data', async () => {
        vi.stubGlobal('document', {
            cookie: 'larafeed-csrf=csrf-token',
        });
        const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
            Promise.resolve(
                Response.json({
                    subscriptions: [
                        { feedId: 7, readThroughEntryId: 70 },
                        { feedId: 8, readThroughEntryId: 80 },
                    ],
                }),
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        });
        const entryListKey = [...entryKeys.lists(), 'cached-page'] as const;
        queryClient.setQueryData(entryListKey, { entries: [] });
        queryClient.setQueryData(readerKeys.counts(), { unread: 2 });
        queryClient.setQueryData(subscriptionKeys.list(), {
            subscriptions: [],
        });

        const observer = new MutationObserver(
            queryClient,
            categoryReadThroughMutationOptions(queryClient, 3),
        );
        await observer.mutate(undefined);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            '/api/categories/3/read-through',
        );
        expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
        expect(queryClient.getQueryState(entryListKey)?.isInvalidated).toBe(
            true,
        );
        expect(
            queryClient.getQueryState(readerKeys.counts())?.isInvalidated,
        ).toBe(true);
        expect(
            queryClient.getQueryState(subscriptionKeys.list())?.isInvalidated,
        ).toBe(true);
    });
});

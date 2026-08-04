import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { entryKeys, readerKeys, subscriptionKeys } from './reader';
import {
    CategoryReadThroughError,
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
        const entryListKey = [
            ...entryKeys.finiteLists(),
            'cached-page',
        ] as const;
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
    it('invalidates reader data and reports partial failures accurately', async () => {
        vi.stubGlobal('document', {
            cookie: 'larafeed-csrf=csrf-token',
        });
        const fetchMock = vi.fn((path: string) => {
            if (path === '/api/subscriptions/7/read-through') {
                return Promise.resolve(
                    Response.json({ feedId: 7, readThroughEntryId: 70 }),
                );
            }

            return Promise.resolve(
                Response.json(
                    {
                        error: {
                            code: 'internal_server_error',
                            message: 'Refresh failed.',
                        },
                    },
                    { status: 500 },
                ),
            );
        });
        vi.stubGlobal('fetch', fetchMock);

        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        });
        const entryListKey = [
            ...entryKeys.finiteLists(),
            'cached-page',
        ] as const;
        queryClient.setQueryData(entryListKey, { entries: [] });
        queryClient.setQueryData(readerKeys.counts(), { unread: 2 });
        queryClient.setQueryData(subscriptionKeys.list(), {
            subscriptions: [],
        });

        const observer = new MutationObserver(
            queryClient,
            categoryReadThroughMutationOptions(queryClient, 3, [7, 8]),
        );
        const error = await observer.mutate(undefined).catch((cause) => cause);

        expect(error).toBeInstanceOf(CategoryReadThroughError);
        expect(error).toMatchObject({
            succeeded: 1,
            failed: 1,
            total: 2,
            message: '1 of 2 feeds were marked as read. 1 failed.',
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
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

import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    categoryKeys,
    entryKeys,
    readerKeys,
    subscriptionKeys,
} from './reader';
import {
    createCategoryMutationOptions,
    createSubscriptionMutationOptions,
    deleteCategoryMutationOptions,
    dismissMovedFeedMutationOptions,
    moveSubscriptionMutationOptions,
    refreshFaviconMutationOptions,
    refreshSubscriptionMutationOptions,
    subscriptionManagementKeys,
    subscriptionManagementQueryOptions,
    unsubscribeMutationOptions,
    updateCategoryMutationOptions,
} from './subscriptions';

const subscription = {
    feedId: 7,
    categoryId: 3,
    categoryName: 'Technology',
    feedName: 'Example feed',
    customFeedName: null,
    feedUrl: 'https://example.com/feed.xml',
    siteUrl: 'https://example.com',
    faviconUrl: null,
    faviconIsDark: null,
    entryCount: 0,
    unreadCount: 0,
    isGone: false,
    movedToUrl: null,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    lastSuccessfulRefreshAt: null,
    lastFailedRefreshAt: null,
    lastErrorClass: null,
    lastErrorMessage: null,
    filterRules: {
        excludeTitle: [],
        excludeContent: [],
        excludeAuthor: [],
    },
    refreshes: [],
};

const readModelKeys = {
    management: subscriptionManagementKeys.list(),
    categories: categoryKeys.list(),
    subscriptions: subscriptionKeys.list(),
    counts: readerKeys.counts(),
    entries: entryKeys.list({
        feedId: null,
        categoryId: null,
        filter: 'all',
        orderBy: 'published_at',
        pageSize: 50,
    }),
} as const;

type ReadModel = keyof typeof readModelKeys;

function seedReadModels(queryClient: QueryClient): void {
    for (const key of Object.values(readModelKeys)) {
        queryClient.setQueryData(key, { seeded: true });
    }
}

function invalidatedReadModels(queryClient: QueryClient): ReadModel[] {
    return (Object.keys(readModelKeys) as ReadModel[]).filter(
        (name) =>
            queryClient.getQueryState(readModelKeys[name])?.isInvalidated ===
            true,
    );
}

function makeQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('subscription management query contracts', () => {
    it('uses a protected key, cancellation-aware query function, and no retries', () => {
        expect(subscriptionManagementKeys.list()).toEqual([
            'protected',
            'subscription-management',
            'list',
            'current',
        ]);
        expect(subscriptionManagementQueryOptions.queryKey).toEqual(
            subscriptionManagementKeys.list(),
        );
        expect(subscriptionManagementQueryOptions.retry).toBe(false);
    });

    it('keeps a feed creation pending through targeted reader invalidation', async () => {
        vi.stubGlobal('document', { cookie: 'larafeed-csrf=csrf-token' });
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json({
                        kind: 'created',
                        subscription,
                        createdFeed: true,
                        createdSubscription: true,
                    }),
                ),
            ),
        );

        const queryClient = makeQueryClient();
        const keys = [
            subscriptionManagementKeys.list(),
            categoryKeys.list(),
            subscriptionKeys.list(),
            readerKeys.counts(),
            entryKeys.list({
                feedId: null,
                categoryId: null,
                filter: 'all',
                orderBy: 'published_at',
                pageSize: 50,
            }),
        ] as const;
        for (const key of keys) {
            queryClient.setQueryData(key, { seeded: true });
        }

        const options = createSubscriptionMutationOptions(queryClient);
        expect(options.retry).toBe(false);
        const mutation = queryClient
            .getMutationCache()
            .build(queryClient, options);

        await expect(
            mutation.execute({
                feedUrl: subscription.feedUrl,
                categoryId: subscription.categoryId,
            }),
        ).resolves.toMatchObject({ subscription });

        for (const key of keys) {
            expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
        }
    });

    it('does not invalidate reader data when candidate selection is required', async () => {
        vi.stubGlobal('document', { cookie: 'larafeed-csrf=csrf-token' });
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json({
                        kind: 'selection_required',
                        candidates: [
                            {
                                title: 'Example',
                                feedUrl: 'https://example.com/feed.xml',
                                siteUrl: 'https://example.com/',
                                identicalTo: [],
                            },
                            {
                                title: 'Example News',
                                feedUrl: 'https://example.com/news/feed.xml',
                                siteUrl: 'https://example.com/news/',
                                identicalTo: [],
                            },
                        ],
                    }),
                ),
            ),
        );

        const queryClient = makeQueryClient();
        const key = subscriptionManagementKeys.list();
        queryClient.setQueryData(key, { seeded: true });
        const mutation = queryClient
            .getMutationCache()
            .build(queryClient, createSubscriptionMutationOptions(queryClient));

        await expect(
            mutation.execute({
                feedUrl: 'https://example.com/news/',
                categoryId: subscription.categoryId,
            }),
        ).resolves.toMatchObject({ kind: 'selection_required' });
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    });

    it('removes cached entry details after unsubscribe', async () => {
        vi.stubGlobal('document', { cookie: 'larafeed-csrf=csrf-token' });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.json({ deleted: true }))),
        );
        const queryClient = makeQueryClient();
        queryClient.setQueryData(entryKeys.detail(99), { id: 99 });
        const mutation = queryClient
            .getMutationCache()
            .build(queryClient, unsubscribeMutationOptions(queryClient));

        await mutation.execute({ feedId: subscription.feedId });

        expect(queryClient.getQueryData(entryKeys.detail(99))).toBeUndefined();
    });

    it('posts a feed move and refreshes reader data after it', async () => {
        vi.stubGlobal('document', { cookie: 'larafeed-csrf=csrf-token' });
        const fetchMock = vi.fn(
            (_input: RequestInfo | URL, _init?: RequestInit) =>
                Promise.resolve(
                    Response.json({
                        kind: 'moved',
                        subscription: { ...subscription, feedId: 8 },
                        keptOldSubscription: false,
                    }),
                ),
        );
        vi.stubGlobal('fetch', fetchMock);
        const queryClient = makeQueryClient();
        const key = subscriptionManagementKeys.list();
        queryClient.setQueryData(key, { seeded: true });
        queryClient.setQueryData(entryKeys.detail(99), { id: 99 });
        const mutation = queryClient
            .getMutationCache()
            .build(queryClient, moveSubscriptionMutationOptions(queryClient));

        await expect(
            mutation.execute({
                feedId: subscription.feedId,
                feedUrl: 'https://example.com/new.xml',
            }),
        ).resolves.toMatchObject({ kind: 'moved' });

        const [path, init] = fetchMock.mock.calls[0] ?? [];
        expect(path).toBe('/api/subscriptions/7/move');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
            feedUrl: 'https://example.com/new.xml',
        });
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
        expect(queryClient.getQueryData(entryKeys.detail(99))).toBeUndefined();
    });

    it.each([
        {
            name: 'feed refresh',
            response: { jobId: 1, operationId: 'op-1', state: 'queued' },
            run: (queryClient: QueryClient) =>
                queryClient
                    .getMutationCache()
                    .build(
                        queryClient,
                        refreshSubscriptionMutationOptions(queryClient),
                    )
                    .execute({ feedId: 7 }),
            invalidated: ['management'],
        },
        {
            name: 'favicon refresh',
            response: { feedId: 7, faviconUrl: null },
            run: (queryClient: QueryClient) =>
                queryClient
                    .getMutationCache()
                    .build(
                        queryClient,
                        refreshFaviconMutationOptions(queryClient),
                    )
                    .execute({ feedId: 7 }),
            invalidated: ['management'],
        },
        {
            name: 'moved-feed dismissal',
            response: { subscription },
            run: (queryClient: QueryClient) =>
                queryClient
                    .getMutationCache()
                    .build(
                        queryClient,
                        dismissMovedFeedMutationOptions(queryClient),
                    )
                    .execute({
                        feedId: 7,
                        movedToUrl: 'https://example.com/new.xml',
                    }),
            invalidated: ['management'],
        },
        {
            name: 'category creation',
            response: {
                category: { id: 4, name: 'News', subscriptionCount: 0 },
            },
            run: (queryClient: QueryClient) =>
                queryClient
                    .getMutationCache()
                    .build(
                        queryClient,
                        createCategoryMutationOptions(queryClient),
                    )
                    .execute({ name: 'News' }),
            invalidated: ['management', 'categories'],
        },
        {
            name: 'category rename',
            response: {
                category: { id: 3, name: 'Tech', subscriptionCount: 1 },
            },
            run: (queryClient: QueryClient) =>
                queryClient
                    .getMutationCache()
                    .build(
                        queryClient,
                        updateCategoryMutationOptions(queryClient),
                    )
                    .execute({ categoryId: 3, name: 'Tech' }),
            invalidated: ['management', 'categories'],
        },
        {
            name: 'category deletion',
            response: { deleted: true },
            run: (queryClient: QueryClient) =>
                queryClient
                    .getMutationCache()
                    .build(
                        queryClient,
                        deleteCategoryMutationOptions(queryClient),
                    )
                    .execute({ categoryId: 4 }),
            invalidated: ['management', 'categories'],
        },
        {
            name: 'unsubscribe',
            response: { deleted: true },
            run: (queryClient: QueryClient) =>
                queryClient
                    .getMutationCache()
                    .build(queryClient, unsubscribeMutationOptions(queryClient))
                    .execute({ feedId: 7 }),
            invalidated: [
                'management',
                'categories',
                'subscriptions',
                'counts',
                'entries',
            ],
        },
    ])('invalidates only the data a $name changes', async (testCase) => {
        vi.stubGlobal('document', { cookie: 'larafeed-csrf=csrf-token' });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.json(testCase.response))),
        );
        const queryClient = makeQueryClient();
        seedReadModels(queryClient);

        await testCase.run(queryClient);

        expect(invalidatedReadModels(queryClient)).toEqual(
            testCase.invalidated,
        );
    });

    it('fails locally when the CSRF cookie is missing', async () => {
        vi.stubGlobal('document', { cookie: '' });
        const queryClient = makeQueryClient();
        const mutation = queryClient
            .getMutationCache()
            .build(queryClient, createSubscriptionMutationOptions(queryClient));

        await expect(
            mutation.execute({
                feedUrl: subscription.feedUrl,
                categoryId: subscription.categoryId,
            }),
        ).rejects.toMatchObject({
            status: 401,
            code: 'unauthenticated',
        });
    });
});

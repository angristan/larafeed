import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    categoryKeys,
    entryKeys,
    readerKeys,
    subscriptionKeys,
} from './reader';
import {
    createSubscriptionMutationOptions,
    subscriptionManagementKeys,
    subscriptionManagementQueryOptions,
    unsubscribeMutationOptions,
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

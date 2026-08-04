import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createSubscription,
    listManagedSubscriptions,
    refreshFavicon,
    SubscriptionClientError,
    updateSubscription,
} from './subscriptions';

const category = { id: 3, name: 'Technology', subscriptionCount: 1 };
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
    entryCount: 12,
    unreadCount: 2,
    isGone: false,
    consecutiveFailures: 0,
    lastAttemptAt: 1_900_000_000_000,
    lastSuccessfulRefreshAt: 1_900_000_000_000,
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

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('SubscriptionClient', () => {
    it('decodes the management response', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json({
                        categories: [category],
                        subscriptions: [subscription],
                    }),
                ),
            ),
        );

        await expect(
            Effect.runPromise(listManagedSubscriptions()),
        ).resolves.toEqual({
            categories: [category],
            subscriptions: [subscription],
        });
    });

    it('adds a feed with a typed body and CSRF token', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(
                Response.json({
                    subscription,
                    createdFeed: true,
                    createdSubscription: true,
                    refreshOperationId: 'refresh-7',
                }),
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(
                createSubscription({
                    feedUrl: subscription.feedUrl,
                    categoryId: category.id,
                    csrfToken: 'csrf-token',
                }),
            ),
        ).resolves.toMatchObject({ refreshOperationId: 'refresh-7' });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/subscriptions',
            expect.objectContaining({
                method: 'POST',
                credentials: 'same-origin',
                body: JSON.stringify({
                    feedUrl: subscription.feedUrl,
                    categoryId: category.id,
                }),
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'csrf-token',
                }),
            }),
        );
    });

    it('adds a first feed with a new category in one request', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(
                Response.json({
                    subscription,
                    createdFeed: true,
                    createdSubscription: true,
                    refreshOperationId: 'refresh-7',
                }),
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        await Effect.runPromise(
            createSubscription({
                feedUrl: subscription.feedUrl,
                categoryName: 'Technology',
                csrfToken: 'csrf-token',
            }),
        );

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/subscriptions',
            expect.objectContaining({
                body: JSON.stringify({
                    feedUrl: subscription.feedUrl,
                    categoryName: 'Technology',
                }),
            }),
        );
    });

    it('sends camel-case filter rules when updating a subscription', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(Response.json({ subscription })),
        );
        vi.stubGlobal('fetch', fetchMock);

        await Effect.runPromise(
            updateSubscription({
                feedId: subscription.feedId,
                categoryId: category.id,
                customFeedName: 'Renamed',
                filterRules: {
                    excludeTitle: ['sponsored'],
                    excludeContent: [],
                    excludeAuthor: ['bot'],
                },
                csrfToken: 'csrf-token',
            }),
        );

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/subscriptions/7',
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({
                    categoryId: 3,
                    customFeedName: 'Renamed',
                    filterRules: {
                        excludeTitle: ['sponsored'],
                        excludeContent: [],
                        excludeAuthor: ['bot'],
                    },
                }),
            }),
        );
    });

    it('refreshes an owned favicon with CSRF protection', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(
                Response.json({
                    feedId: subscription.feedId,
                    faviconUrl: `/api/images/feeds/${subscription.feedId}/small`,
                }),
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(
                refreshFavicon({
                    feedId: subscription.feedId,
                    csrfToken: 'csrf-token',
                }),
            ),
        ).resolves.toMatchObject({ feedId: subscription.feedId });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/feeds/7/favicon/refresh',
            expect.objectContaining({
                method: 'POST',
                body: '{}',
                headers: expect.objectContaining({
                    'X-CSRF-Token': 'csrf-token',
                }),
            }),
        );
    });

    it('rejects malformed successful responses', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json({ categories: 'invalid', subscriptions: [] }),
                ),
            ),
        );

        const error = await Effect.runPromise(listManagedSubscriptions()).catch(
            (cause: unknown) => cause,
        );
        expect(error).toBeInstanceOf(SubscriptionClientError);
        expect(error).toMatchObject({ kind: 'decode', status: 200 });
    });

    it('propagates query cancellation to fetch', async () => {
        let fetchSignal: AbortSignal | undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn((_path: string, init?: RequestInit) => {
                fetchSignal = init?.signal ?? undefined;
                return new Promise<Response>((_resolve, reject) => {
                    fetchSignal?.addEventListener('abort', () => {
                        reject(new DOMException('Aborted', 'AbortError'));
                    });
                });
            }),
        );

        const controller = new AbortController();
        const running = Effect.runPromise(listManagedSubscriptions(), {
            signal: controller.signal,
        });
        await vi.waitFor(() => expect(fetchSignal).toBeDefined());
        controller.abort();

        await expect(running).rejects.toBeDefined();
        expect(fetchSignal?.aborted).toBe(true);
    });
});

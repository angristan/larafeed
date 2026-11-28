import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ManagedSubscription } from '../api/subscriptions';
import { subscriptionManagementKeys } from '../queries/subscriptions';
import {
    buildAddFeedBookmarklet,
    compareSubscriptions,
    getSubscriptionStatus,
    MoveFeedSection,
    nextSubscriptionSortDirection,
    SubscriptionOverviewPage,
    SubscriptionsPage,
    subscriptionStatusFilterOptions,
} from './SubscriptionsPage';

const subscription: ManagedSubscription = {
    feedId: 7,
    categoryId: 3,
    categoryName: 'Technology',
    feedName: 'Example feed',
    customFeedName: 'Daily example',
    feedUrl: 'https://example.com/feed.xml',
    siteUrl: 'https://example.com',
    faviconUrl: null,
    faviconIsDark: null,
    entryCount: 12,
    unreadCount: 2,
    isGone: false,
    movedToUrl: null,
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
    refreshes: [
        {
            id: 17,
            refreshedAt: 1_900_000_000_000,
            successful: true,
            notModified: false,
            httpStatus: 200,
            entriesCreated: 3,
            errorClass: null,
            errorMessage: null,
        },
    ],
};

function renderPage(
    data?: {
        readonly categories: readonly {
            readonly id: number;
            readonly name: string;
            readonly subscriptionCount: number;
        }[];
        readonly subscriptions: readonly ManagedSubscription[];
    },
    initialEntry = '/settings/subscriptions',
): string {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    if (data !== undefined) {
        queryClient.setQueryData(subscriptionManagementKeys.list(), data);
    }

    const Page = initialEntry.startsWith('/settings/subscriptions/overview')
        ? SubscriptionOverviewPage
        : SubscriptionsPage;

    return renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
            <MantineProvider>
                <MemoryRouter initialEntries={[initialEntry]}>
                    <Page />
                </MemoryRouter>
            </MantineProvider>
        </QueryClientProvider>,
    );
}

describe('SubscriptionsPage', () => {
    it('renders loading without remote data', () => {
        expect(renderPage()).toContain('Loading subscriptions');
    });

    it('links the overview to the stable feed audit route', () => {
        const markup = renderPage(
            { categories: [], subscriptions: [] },
            '/settings/subscriptions/overview',
        );

        expect(markup).toContain('Feed health');
        expect(markup).toContain('Needs attention');
        expect(markup).toContain('Categories');
        expect(markup).toContain('href="/settings/subscriptions"');
        expect(markup).not.toContain('href="#subscription-');
    });

    it('marks only the current view in the subscriptions navigation', () => {
        const currentLinks = (path: string) => [
            ...renderPage({ categories: [], subscriptions: [] }, path)
                .matchAll(/<a [^>]*mantine-NavLink-root[^>]*>/gu)
                .filter(([tag]) => tag.includes('aria-current="page"'))
                .map(([tag]) => /href="([^"]+)"/u.exec(tag)?.[1]),
        ];

        expect(currentLinks('/settings/subscriptions')).toEqual([
            '/settings/subscriptions',
        ]);
        expect(currentLinks('/settings/subscriptions/overview')).toEqual([
            '/settings/subscriptions/overview',
        ]);
    });

    it('renders filters and an empty table on the feed audit page', () => {
        const markup = renderPage(
            { categories: [], subscriptions: [] },
            '/settings/subscriptions',
        );

        expect(markup).toContain('aria-label="Filters"');
        expect(markup).toContain('No subscriptions match the current filters');
    });

    it('renders feed metadata and management controls', () => {
        const markup = renderPage(
            {
                categories: [
                    { id: 3, name: 'Technology', subscriptionCount: 1 },
                ],
                subscriptions: [subscription],
            },
            '/settings/subscriptions',
        );

        expect(markup).toContain('Subscriptions');
        expect(markup).toContain('<th');
        expect(markup).toContain('Daily example');
        expect(markup).toContain('Technology');
        expect(markup).toContain('Healthy');
        expect(markup).toContain('Website');
        expect(markup).toContain('Feed');
        expect(markup).toContain('Last success');
        expect(markup).toContain('Last failure');
        expect(markup).toContain('Details');
        expect(markup).not.toMatch(/<tr[^>]+role="button"/u);
        expect(markup).toContain('Sorted ascending');
    });

    it('uses authoritative statuses for badges, filters, and totals', () => {
        const markup = renderPage(
            {
                categories: [
                    { id: 3, name: 'Technology', subscriptionCount: 4 },
                ],
                subscriptions: [
                    subscription,
                    {
                        ...subscription,
                        feedId: 8,
                        customFeedName: 'Recovering feed',
                        consecutiveFailures: 2,
                    },
                    {
                        ...subscription,
                        feedId: 9,
                        customFeedName: 'Gone feed',
                        isGone: true,
                        movedToUrl: null,
                    },
                    {
                        ...subscription,
                        feedId: 10,
                        customFeedName: 'New feed',
                        lastSuccessfulRefreshAt: null,
                        refreshes: [],
                    },
                ],
            },
            '/settings/subscriptions/overview',
        );

        const text = markup.replaceAll(/<[^>]+>/g, '');
        expect(text).toContain('Total feeds4');
        expect(text).toContain('Failing or gone2');
        expect(text).toContain('Never refreshed1');
        expect(markup).toContain('Failing');
        expect(markup).toContain('Gone');
        expect(markup).toContain('Details');
        expect(markup).not.toMatch(/<tr[^>]+role="button"/u);
        expect(
            subscriptionStatusFilterOptions.map(({ value }) => value),
        ).toEqual(['healthy', 'failing', 'never', 'gone']);
    });

    it('keeps add-feed controls out of the feed audit page', () => {
        const markup = renderPage(
            {
                categories: [
                    { id: 3, name: 'Technology', subscriptionCount: 0 },
                ],
                subscriptions: [],
            },
            '/settings/subscriptions?url=https%3A%2F%2Fexample.com%2Fnews',
        );

        expect(markup).not.toContain('Add a feed');
        expect(markup).not.toContain('Feed added');
    });

    it('builds a same-origin prefill-only bookmarklet', () => {
        expect(buildAddFeedBookmarklet('https://reader.example')).toBe(
            'javascript:location.href="https://reader.example/feeds?addFeedUrl="+encodeURIComponent(location.href)',
        );
        expect(() => buildAddFeedBookmarklet('javascript:alert(1)')).toThrow(
            TypeError,
        );
    });

    it('defaults metric sorts descending and name sorts ascending', () => {
        expect(nextSubscriptionSortDirection('name', 'asc', 'entries')).toBe(
            'desc',
        );
        expect(
            nextSubscriptionSortDirection('entries', 'desc', 'lastSuccess'),
        ).toBe('desc');
        expect(nextSubscriptionSortDirection('entries', 'desc', 'name')).toBe(
            'asc',
        );
        expect(nextSubscriptionSortDirection('name', 'desc', 'name')).toBe(
            'desc',
        );
        expect(nextSubscriptionSortDirection('entries', 'desc', 'status')).toBe(
            'asc',
        );
    });

    it('sorts feeds that need a fix first, then by name', () => {
        const feeds: ManagedSubscription[] = [
            { ...subscription, feedId: 1, customFeedName: 'Beta' },
            { ...subscription, feedId: 2, customFeedName: 'Alpha' },
            {
                ...subscription,
                feedId: 3,
                customFeedName: 'Never',
                lastSuccessfulRefreshAt: null,
                refreshes: [],
            },
            {
                ...subscription,
                feedId: 4,
                customFeedName: 'Gone',
                isGone: true,
            },
            {
                ...subscription,
                feedId: 5,
                customFeedName: 'Zulu failing',
                consecutiveFailures: 1,
            },
            {
                ...subscription,
                feedId: 6,
                customFeedName: 'Able failing',
                consecutiveFailures: 4,
            },
        ];
        const order = (direction: 'asc' | 'desc') =>
            feeds
                .toSorted((left, right) =>
                    compareSubscriptions(left, right, 'status', direction),
                )
                .map((feed) => feed.customFeedName);

        expect(order('asc')).toEqual([
            'Able failing',
            'Zulu failing',
            'Gone',
            'Never',
            'Alpha',
            'Beta',
        ]);
        expect(order('desc')).toEqual([
            'Alpha',
            'Beta',
            'Never',
            'Gone',
            'Able failing',
            'Zulu failing',
        ]);
    });

    it('classifies never, failing, and gone subscriptions', () => {
        expect(
            getSubscriptionStatus({
                ...subscription,
                lastSuccessfulRefreshAt: null,
                refreshes: [],
            }),
        ).toBe('never');
        expect(
            getSubscriptionStatus({ ...subscription, consecutiveFailures: 2 }),
        ).toBe('failing');
        expect(getSubscriptionStatus({ ...subscription, isGone: true })).toBe(
            'gone',
        );
    });
    it('points a moved feed to its new URL', () => {
        const moved = {
            ...subscription,
            consecutiveFailures: 3,
            lastErrorMessage: 'Feed returned HTTP 404',
            movedToUrl: 'https://example.com/new-feed.xml',
        };
        const markup = renderPage(
            {
                categories: [
                    { id: 3, name: 'Technology', subscriptionCount: 1 },
                ],
                subscriptions: [moved],
            },
            '/settings/subscriptions',
        );
        expect(markup).toContain(
            'Feed moved. Open details to switch to the new URL.',
        );
        expect(markup).not.toContain('Feed returned HTTP 404');

        const section = (value: ManagedSubscription) =>
            renderToStaticMarkup(
                <QueryClientProvider client={new QueryClient()}>
                    <MantineProvider>
                        <MoveFeedSection
                            onMoved={() => undefined}
                            subscription={value}
                        />
                    </MantineProvider>
                </QueryClientProvider>,
            );
        const alert = section(moved);
        expect(alert).toContain('This feed has moved');
        expect(alert).toContain('href="https://example.com/new-feed.xml"');
        expect(alert).toContain('Switch to new feed');
        expect(alert).toContain('Dismiss');
        expect(alert).toContain('Change feed URL');

        const healthy = section(subscription);
        expect(healthy).not.toContain('This feed has moved');
        expect(healthy).toContain('Change feed URL');
    });
});

import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ManagedSubscription } from '../api/subscriptions';
import { subscriptionManagementKeys } from '../queries/subscriptions';
import {
    buildAddFeedBookmarklet,
    getSubscriptionStatus,
    nextSubscriptionSortDirection,
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

    return renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
            <MantineProvider>
                <MemoryRouter initialEntries={[initialEntry]}>
                    <SubscriptionsPage />
                </MemoryRouter>
            </MantineProvider>
        </QueryClientProvider>,
    );
}

describe('SubscriptionsPage', () => {
    it('renders loading without remote data', () => {
        expect(renderPage()).toContain('Loading subscriptions');
    });

    it('renders the legacy filter sidebar and empty table', () => {
        const markup = renderPage({ categories: [], subscriptions: [] });

        expect(markup).toContain('Search &amp; Filter');
        expect(markup).toContain('Refine the subscriptions table in real time');
        expect(markup).toContain('No subscriptions match the current filters');
    });

    it('renders feed metadata and management controls', () => {
        const markup = renderPage({
            categories: [{ id: 3, name: 'Technology', subscriptionCount: 1 }],
            subscriptions: [subscription],
        });

        expect(markup).toContain('Subscriptions');
        expect(markup).toContain('<th');
        expect(markup).toContain('Daily example');
        expect(markup).toContain('Technology');
        expect(markup).toContain('Success');
        expect(markup).toContain('Website');
        expect(markup).toContain('Feed');
        expect(markup).toContain('Last success');
        expect(markup).toContain('Last failure');
        expect(markup).toContain('Sorted ascending');
    });

    it('uses authoritative statuses for badges, filters, and totals', () => {
        const markup = renderPage({
            categories: [{ id: 3, name: 'Technology', subscriptionCount: 4 }],
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
                },
                {
                    ...subscription,
                    feedId: 10,
                    customFeedName: 'New feed',
                    lastSuccessfulRefreshAt: null,
                    refreshes: [],
                },
            ],
        });

        expect(markup).toContain('Total: 4');
        expect(markup).toContain('With errors: 2');
        expect(markup).toContain('Never refreshed: 1');
        expect(markup).toContain('Failed');
        expect(markup).toContain('Gone');
        expect(
            subscriptionStatusFilterOptions.map(({ value }) => value),
        ).toEqual(['healthy', 'failing', 'never', 'gone']);
    });

    it('keeps add-feed controls out of the legacy audit page', () => {
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
});

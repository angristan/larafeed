import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ManagedSubscription } from '../api/subscriptions';
import { subscriptionManagementKeys } from '../queries/subscriptions';
import { getSubscriptionStatus, SubscriptionsPage } from './SubscriptionsPage';

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

function renderPage(data?: {
    readonly categories: readonly {
        readonly id: number;
        readonly name: string;
        readonly subscriptionCount: number;
    }[];
    readonly subscriptions: readonly ManagedSubscription[];
}): string {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    if (data !== undefined) {
        queryClient.setQueryData(subscriptionManagementKeys.list(), data);
    }

    return renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
            <MantineProvider>
                <MemoryRouter>
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

    it('renders category guidance and an accessible empty state', () => {
        const markup = renderPage({ categories: [], subscriptions: [] });

        expect(markup).toContain(
            'Create a category before adding your first feed',
        );
        expect(markup).toContain('No subscriptions yet');
        expect(markup).toContain('Search subscriptions');
    });

    it('renders feed metadata and management controls', () => {
        const markup = renderPage({
            categories: [{ id: 3, name: 'Technology', subscriptionCount: 1 }],
            subscriptions: [subscription],
        });

        expect(markup).toContain('Daily example');
        expect(markup).toContain('Technology');
        expect(markup).toContain('Healthy');
        expect(markup).toContain('2 unread');
        expect(markup).toContain('Manage');
        expect(markup).toContain(
            'Move or unsubscribe every feed before deleting this category',
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

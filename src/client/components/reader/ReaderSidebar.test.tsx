import { AppShell, MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { SubscriptionManagement } from '../../api/subscriptions';
import { subscriptionManagementKeys } from '../../queries/subscriptions';

import {
    FeedCategoryFields,
    FilterRuleSection,
    feedMarkedReadNotification,
    ReaderSidebar,
} from './ReaderSidebar';

type SidebarProps = Parameters<typeof ReaderSidebar>[0];

const cloudflare = {
    feedId: 8,
    categoryId: 3,
    feedName: 'Cloudflare Blog',
    customFeedName: null,
    faviconUrl: null,
    faviconIsDark: false,
    totalCount: 20,
    unreadCount: 6,
};

const renderSidebar = (
    overrides: Partial<SidebarProps> = {},
    management?: SubscriptionManagement,
): string => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    if (management !== undefined) {
        queryClient.setQueryData(subscriptionManagementKeys.list(), management);
    }
    return renderToStaticMarkup(
        <MemoryRouter>
            <QueryClientProvider client={queryClient}>
                <MantineProvider>
                    <AppShell
                        header={{ height: 56 }}
                        navbar={{ width: 300, breakpoint: 'sm' }}
                    >
                        <AppShell.Navbar>
                            <ReaderSidebar
                                categories={[
                                    { id: 3, name: 'Technology' },
                                    { id: 4, name: 'Newsletters' },
                                ]}
                                counts={{
                                    total: 40,
                                    unread: 6,
                                    read: 34,
                                    starred: 2,
                                }}
                                error={null}
                                isPending={false}
                                onRetry={() => undefined}
                                state={{
                                    feedId: null,
                                    categoryId: null,
                                    filter: 'unread',
                                    orderBy: 'published_at',
                                    entryId: null,
                                    summarize: false,
                                }}
                                subscriptions={[cloudflare]}
                                {...overrides}
                            />
                        </AppShell.Navbar>
                    </AppShell>
                </MantineProvider>
            </QueryClientProvider>
        </MemoryRouter>,
    );
};

describe('ReaderSidebar', () => {
    it('shows unread counts and speaks them with the feed name', () => {
        const markup = renderSidebar({
            subscriptions: [
                cloudflare,
                {
                    ...cloudflare,
                    feedId: 9,
                    feedName: 'Quiet Feed',
                    totalCount: 50,
                    unreadCount: 0,
                },
            ],
        });
        const badges = [...markup.matchAll(/Badge-label[^>]*>([^<]+)</gu)].map(
            (match) => match[1],
        );
        const text = markup.replace(/<[^>]+>/gu, '');

        // Badges show unread entries, not every stored entry, and a feed
        // with nothing unread shows no badge.
        expect(badges).toContain('6');
        expect(badges).not.toContain('20');
        expect(badges).not.toContain('50');
        expect(badges).not.toContain('0');
        // The count is part of the link name, so screen readers hear it.
        expect(text).toContain('Cloudflare Blog, 6 unread');
        expect(text).toContain('Technology, 6 unread');
        expect(text).not.toContain('Quiet Feed, ');
    });

    it('marks the open view and names failing feeds', () => {
        const markup = renderSidebar(
            {
                state: {
                    feedId: 8,
                    categoryId: null,
                    filter: 'all',
                    orderBy: 'published_at',
                    entryId: null,
                    summarize: false,
                },
            },
            {
                categories: [
                    { id: 3, name: 'Technology', subscriptionCount: 1 },
                ],
                subscriptions: [
                    {
                        ...cloudflare,
                        categoryName: 'Technology',
                        feedUrl: 'https://blog.cloudflare.com/rss/',
                        siteUrl: 'https://blog.cloudflare.com/',
                        entryCount: 20,
                        isGone: false,
                        movedToUrl: null,
                        consecutiveFailures: 3,
                        lastAttemptAt: 1_900_000_000_000,
                        lastSuccessfulRefreshAt: null,
                        lastFailedRefreshAt: 1_900_000_000_000,
                        lastErrorClass: 'http_status',
                        lastErrorMessage: 'The server returned HTTP 503.',
                        filterRules: {
                            excludeTitle: [],
                            excludeContent: [],
                            excludeAuthor: [],
                        },
                        refreshes: [],
                    },
                ],
            },
        );
        const currentLinks = [
            ...markup.matchAll(/<a[^>]*aria-current="page"[^>]*>(.*?)<\/a>/gsu),
        ].map((match) => match[1].replace(/<[^>]+>/gu, ''));

        expect(currentLinks).toHaveLength(1);
        expect(currentLinks[0]).toContain('Cloudflare Blog');
        // The orange dot is not the only sign of a failing feed.
        expect(currentLinks[0]).toContain('last refresh failed');
    });

    it('renders the original filters, categories, and feed hierarchy', () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <MantineProvider>
                        <AppShell
                            header={{ height: 56 }}
                            navbar={{ width: 300, breakpoint: 'sm' }}
                        >
                            <AppShell.Navbar>
                                <ReaderSidebar
                                    categories={[
                                        { id: 3, name: 'Technology' },
                                        { id: 4, name: 'Newsletters' },
                                    ]}
                                    counts={{
                                        total: 40,
                                        unread: 6,
                                        read: 34,
                                        starred: 2,
                                    }}
                                    error={null}
                                    isPending={false}
                                    onRetry={() => undefined}
                                    state={{
                                        feedId: null,
                                        categoryId: null,
                                        filter: 'unread',
                                        orderBy: 'published_at',
                                        entryId: null,
                                        summarize: false,
                                    }}
                                    subscriptions={[
                                        {
                                            feedId: 8,
                                            categoryId: 3,
                                            feedName: 'Cloudflare Blog',
                                            customFeedName: null,
                                            faviconUrl: null,
                                            faviconIsDark: false,
                                            totalCount: 20,
                                            unreadCount: 6,
                                        },
                                    ]}
                                />
                            </AppShell.Navbar>
                        </AppShell>
                    </MantineProvider>
                </QueryClientProvider>
            </MemoryRouter>,
        );

        expect(markup).toContain('Search feeds');
        expect(markup).toContain('Unread');
        expect(markup).toContain('Read');
        expect(markup).toContain('Favorites');
        expect(markup).toContain('Technology');
        expect(markup).toContain('Newsletters');
        expect(markup).toContain('Cloudflare Blog');
        expect(markup).toContain('Create feed or category');
        expect(markup).toContain('aria-label="Manage Technology category"');
        expect(markup).toContain('aria-label="Manage Cloudflare Blog"');
        expect(markup).toContain('aria-label="Collapse Technology feeds"');
        expect(markup).not.toContain('Reader app tokens');
    });

    it('renders only a window of a large library on first render', () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const subscriptions = Array.from({ length: 300 }, (_, index) => ({
            feedId: index + 1,
            categoryId: 3,
            feedName: `Feed ${index + 1}`,
            customFeedName: null,
            faviconUrl: null,
            faviconIsDark: false,
            totalCount: 20,
            unreadCount: 0,
        }));
        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <MantineProvider>
                        <AppShell navbar={{ width: 300, breakpoint: 'sm' }}>
                            <AppShell.Navbar>
                                <ReaderSidebar
                                    categories={[{ id: 3, name: 'Technology' }]}
                                    counts={undefined}
                                    error={null}
                                    isPending={false}
                                    onRetry={() => undefined}
                                    state={{
                                        feedId: null,
                                        categoryId: null,
                                        filter: 'unread',
                                        orderBy: 'published_at',
                                        entryId: null,
                                        summarize: false,
                                    }}
                                    subscriptions={subscriptions}
                                />
                            </AppShell.Navbar>
                        </AppShell>
                    </MantineProvider>
                </QueryClientProvider>
            </MemoryRouter>,
        );

        const renderedFeeds =
            markup.match(/aria-label="Manage Feed \d+"/g)?.length ?? 0;
        expect(renderedFeeds).toBeGreaterThan(0);
        expect(renderedFeeds).toBeLessThan(60);
        expect(markup).toContain('aria-label="Manage Feed 1"');
        expect(markup).not.toContain('aria-label="Manage Feed 300"');
    });

    it('builds success feedback for feed read-through', () => {
        expect(feedMarkedReadNotification('Cloudflare Blog')).toEqual({
            message: 'Marked Cloudflare Blog as read',
            color: 'green',
            withBorder: true,
        });
    });

    it('renders the legacy filter rule editor controls', () => {
        const markup = renderToStaticMarkup(
            <MantineProvider>
                <FilterRuleSection
                    buttonText="Add title filter"
                    filters={['alpha|beta']}
                    label="Exclude by title"
                    onAdd={() => undefined}
                    onRemove={() => undefined}
                    onUpdate={() => undefined}
                    placeholder="e.g. alpha|beta"
                />
            </MantineProvider>,
        );

        expect(markup).toContain('Exclude by title');
        expect(markup).toContain('alpha|beta');
        expect(markup).toContain('Add title filter');
        expect(markup).toContain('Remove exclude by title pattern 1');
    });

    it('offers inline category creation for the first feed', () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <MantineProvider>
                        <FeedCategoryFields
                            categories={[]}
                            categoryName=""
                            categorySelection="new"
                            onCategoryNameChange={() => undefined}
                            onCategorySelectionChange={() => undefined}
                        />
                    </MantineProvider>
                </QueryClientProvider>
            </MemoryRouter>,
        );

        expect(markup).toContain('Create new category');
        expect(markup).toContain('New category name');
    });
});

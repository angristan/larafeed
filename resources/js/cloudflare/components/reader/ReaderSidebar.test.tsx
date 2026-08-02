import { AppShell, MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import {
    FeedCategoryFields,
    FilterRuleSection,
    ReaderSidebar,
} from './ReaderSidebar';

describe('ReaderSidebar', () => {
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
                                        page: 1,
                                        entryId: null,
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
        expect(markup).not.toContain('Reader app tokens');
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
        expect(markup).toContain(
            'We will create this category and add the feed to it automatically',
        );
    });
});

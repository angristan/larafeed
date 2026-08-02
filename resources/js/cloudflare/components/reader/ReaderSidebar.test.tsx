import { AppShell, MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { ReaderSidebar } from './ReaderSidebar';

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
});

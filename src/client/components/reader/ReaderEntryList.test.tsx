import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReaderEntryPage } from '../../api/reader';
import type { ReaderState } from '../../readerState';
import { ReaderEntryList } from './ReaderEntryList';

const state: ReaderState = {
    feedId: null,
    categoryId: null,
    filter: 'all',
    orderBy: 'published_at',
    page: 1,
    entryId: null,
    summarize: false,
};

const page: ReaderEntryPage = {
    entries: [],
    pagination: {
        page: 1,
        pageSize: 30,
        total: 0,
        totalPages: 1,
    },
};

describe('ReaderEntryList pagination', () => {
    it('keeps the pagination footer visible for a one-page result', () => {
        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <MantineProvider>
                    <ReaderEntryList
                        error={null}
                        isFetching={false}
                        isPending={false}
                        isPlaceholderData={false}
                        onPageChange={() => undefined}
                        onPrefetchEntry={() => undefined}
                        onRetry={() => undefined}
                        page={page}
                        scopeTitle="All entries"
                        state={state}
                    />
                </MantineProvider>
            </MemoryRouter>,
        );

        expect(markup).toContain('mantine-Pagination-root');
        expect(markup).toContain('aria-current="page">1</button>');
    });

    it('shows the current scope, result range, and useful feed metadata', () => {
        const scopedPage: ReaderEntryPage = {
            entries: [
                {
                    id: 41,
                    feedId: 21,
                    title: 'A useful entry',
                    url: 'https://example.test/entry',
                    author: 'Ada Author',
                    publishedAt: Date.now() - 60_000,
                    createdAt: Date.now() - 60_000,
                    feedName: 'Example feed',
                    customFeedName: null,
                    faviconUrl: null,
                    faviconIsDark: false,
                    read: false,
                    starred: true,
                    archived: false,
                },
            ],
            pagination: {
                page: 2,
                pageSize: 30,
                total: 74,
                totalPages: 3,
            },
        };

        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <MantineProvider>
                    <ReaderEntryList
                        error={null}
                        isFetching={false}
                        isPending={false}
                        isPlaceholderData={false}
                        onPageChange={() => undefined}
                        onPrefetchEntry={() => undefined}
                        onRetry={() => undefined}
                        page={scopedPage}
                        scopeTitle="Tech dispatch: Unread entries"
                        state={{ ...state, feedId: 21, page: 2 }}
                    />
                </MantineProvider>
            </MemoryRouter>,
        );

        expect(markup).toContain('Tech dispatch: Unread entries');
        expect(markup).toContain('31–60 of 74');
        expect(markup).toContain('Ada Author');
        expect(markup).not.toContain('>Example feed</span>');
        expect(markup).toContain('aria-label="Favorite"');
    });

    it('explains a filtered empty state', () => {
        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <MantineProvider>
                    <ReaderEntryList
                        error={null}
                        isFetching={false}
                        isPending={false}
                        isPlaceholderData={false}
                        onPageChange={() => undefined}
                        onPrefetchEntry={() => undefined}
                        onRetry={() => undefined}
                        page={page}
                        scopeTitle="Favorites"
                        state={{ ...state, filter: 'favorites' }}
                    />
                </MantineProvider>
            </MemoryRouter>,
        );

        expect(markup).toContain('No favorites yet');
        expect(markup).toContain('Star an entry to keep it here.');
    });
});

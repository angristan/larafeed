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

const entries: ReaderEntryPage['entries'] = [
    {
        id: 7,
        feedId: 3,
        title: 'A stable entry',
        url: 'https://example.com/entry',
        author: 'Author',
        publishedAt: 1_900_000_000_000,
        createdAt: 1_900_000_000_100,
        feedName: 'Example feed',
        customFeedName: null,
        faviconUrl: null,
        faviconIsDark: null,
        read: false,
        starred: false,
        archived: false,
    },
];

function render(overrides: Partial<Parameters<typeof ReaderEntryList>[0]>) {
    return renderToStaticMarkup(
        <MemoryRouter>
            <MantineProvider>
                <ReaderEntryList
                    entries={entries}
                    error={null}
                    scopeTitle="All entries"
                    hasNextPage={false}
                    isFetching={false}
                    isFetchingNextPage={false}
                    isPending={false}
                    onLoadMore={() => undefined}
                    onPrefetchEntry={() => undefined}
                    onRetry={() => undefined}
                    state={state}
                    total={entries.length}
                    {...overrides}
                />
            </MantineProvider>
        </MemoryRouter>,
    );
}

describe('ReaderEntryList infinite list', () => {
    it('renders entries with the total and no pagination controls', () => {
        const markup = render({});

        expect(markup).toContain('A stable entry');
        expect(markup).toContain('1 total');
        expect(markup).not.toContain('mantine-Pagination-root');
    });

    it('renders a load-more sentinel only while more pages exist', () => {
        expect(render({ hasNextPage: true })).toContain('listSentinel');
        expect(render({ hasNextPage: false })).not.toContain('listSentinel');
    });

    it('announces loading of the next page', () => {
        const markup = render({
            hasNextPage: true,
            isFetchingNextPage: true,
        });

        expect(markup).toContain('aria-label="Loading more entries"');
    });
});

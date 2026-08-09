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
                    density="comfortable"
                    entries={entries}
                    error={null}
                    scopeTitle="All entries"
                    hasNewEntries={false}
                    hasNextPage={false}
                    isFetching={false}
                    isFetchingNextPage={false}
                    isPending={false}
                    onLoadMore={() => undefined}
                    onPrefetchEntry={() => undefined}
                    onShowNewEntries={() => undefined}
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
        expect(markup).toContain('data-density="comfortable"');
        expect(markup).not.toContain('mantine-Pagination-root');
    });

    it('renders the selected density', () => {
        expect(render({ density: 'compact' })).toContain(
            'data-density="compact"',
        );
        expect(render({ density: 'spacious' })).toContain(
            'data-density="spacious"',
        );
    });

    it('renders a load-more sentinel only while more pages exist', () => {
        expect(render({ hasNextPage: true })).toContain('listSentinel');
        expect(render({ hasNextPage: false })).not.toContain('listSentinel');
    });

    it('offers a refresh only when newer entries exist', () => {
        expect(render({ hasNewEntries: true })).toContain('New entries');
        expect(render({ hasNewEntries: false })).not.toContain('New entries');
    });

    it('announces loading of the next page', () => {
        const markup = render({
            hasNextPage: true,
            isFetchingNextPage: true,
        });

        expect(markup).toContain('aria-label="Loading more entries"');
    });
});

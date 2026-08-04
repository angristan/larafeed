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
                        state={state}
                    />
                </MantineProvider>
            </MemoryRouter>,
        );

        expect(markup).toContain('mantine-Pagination-root');
        expect(markup).toContain('aria-current="page">1</button>');
    });
});

import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ReaderEntry } from '../../api/reader';
import { summaryKeys } from '../../queries/summaries';
import { ReaderEntryDetail } from './ReaderEntryDetail';

const entry: ReaderEntry = {
    id: 31,
    feedId: 21,
    title: 'Article',
    url: 'https://example.test/article',
    author: 'Author',
    publishedAt: 1_900_000_000_000,
    createdAt: 1_900_000_000_100,
    feedName: 'Feed',
    customFeedName: null,
    faviconUrl: null,
    faviconIsDark: null,
    read: true,
    starred: false,
    archived: false,
    contentHtml: '<p>Article content.</p>',
    readChangedAt: 1_900_000_000_200,
    starredAt: null,
    archivedAt: null,
};

const renderDetail = (summary?: unknown): string => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    if (summary !== undefined) {
        queryClient.setQueryData(summaryKeys.detail(entry.id), summary);
    }

    return renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
            <MantineProvider>
                <ReaderEntryDetail
                    archivePending={false}
                    entry={entry}
                    error={null}
                    isFetching={false}
                    isPending={false}
                    mutationError={null}
                    onBack={() => undefined}
                    onRetry={() => undefined}
                    onSetArchived={() => undefined}
                    onSetRead={() => undefined}
                    onSetStarred={() => undefined}
                    readPending={false}
                    selected
                    starPending={false}
                />
            </MantineProvider>
        </QueryClientProvider>,
    );
};

describe('ReaderEntryDetail summaries', () => {
    it('renders cached sanitized summary HTML without regeneration', () => {
        const markup = renderDetail({
            summary: {
                id: 41,
                entryId: entry.id,
                html: '<p><strong>Cached summary.</strong></p>',
                model: 'gemini-2.5-flash',
                promptVersion: 'entry-summary-v1',
                generatedAt: 1_900_000_000_000,
            },
        });
        expect(markup).toContain('AI summary');
        expect(markup).toContain('<strong>Cached summary.</strong>');
        expect(markup).not.toContain('Generate summary');
    });

    it('renders loading state before the side-effect-free GET completes', () => {
        const markup = renderDetail();
        expect(markup).toContain('Loading summary');
        expect(markup).not.toContain('Generate summary');
    });

    it('renders generation action for a cached null response', () => {
        const markup = renderDetail({ summary: null });
        expect(markup).toContain('Generate summary');
        expect(markup).toContain('Generate a concise AI summary');
    });
});

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

const renderDetail = (summary?: unknown, summarize = false): string => {
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
                    onSetSummarize={() => undefined}
                    readPending={false}
                    selected
                    starPending={false}
                    summarize={summarize}
                />
            </MantineProvider>
        </QueryClientProvider>,
    );
};

describe('ReaderEntryDetail summaries', () => {
    it('renders cached sanitized summary HTML without regeneration', () => {
        const markup = renderDetail(
            {
                summary: {
                    id: 41,
                    entryId: entry.id,
                    html: '<p><strong>Cached summary.</strong></p>',
                    model: 'gemini-2.5-flash',
                    promptVersion: 'entry-summary-v1',
                    generatedAt: 1_900_000_000_000,
                },
            },
            true,
        );
        expect(markup).toContain('aria-label="Entry view"');
        expect(markup).toContain('aria-label="Article content"');
        expect(markup).toContain('aria-label="AI summary"');
        expect(markup).toContain(
            'aria-label="Open original article in a new tab"',
        );
        expect(markup).toContain('aria-label="Archive entry"');
        expect(markup).toContain('AI summary');
        expect(markup).toContain('less than a minute read');
        expect(markup).toContain(
            'Estimated reading time at 300 words per minute',
        );
        expect(markup).toContain('<strong>Cached summary.</strong>');
        expect(markup).not.toContain('Generate summary');
    });

    it('does not mount summary content while article mode is active', () => {
        const markup = renderDetail({
            summary: {
                id: 41,
                entryId: entry.id,
                html: '<p>Must stay inactive.</p>',
                model: 'gemini-2.5-flash',
                promptVersion: 'entry-summary-v1',
                generatedAt: 1_900_000_000_000,
            },
        });
        expect(markup).toContain('Article content.');
        expect(markup).not.toContain('Must stay inactive.');
        expect(markup).not.toContain('Loading summary');
    });

    it('shows a skeleton immediately while loading or starting generation', () => {
        expect(renderDetail(undefined, true)).toContain('Loading summary');
        const missing = renderDetail({ summary: null }, true);
        expect(missing).toContain('Loading summary');
        expect(missing).not.toContain('Generate summary');
    });

    it('keeps the mobile back action in the detail pane', () => {
        expect(renderDetail()).toContain('aria-label="Back to entry list"');
    });
});

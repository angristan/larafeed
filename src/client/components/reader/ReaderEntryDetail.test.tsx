import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ReaderEntry } from '../../api/reader';
import { subscriptionManagementKeys } from '../../queries/subscriptions';
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

const managedSubscription = {
    feedId: entry.feedId,
    categoryId: 1,
    categoryName: 'Technology',
    feedName: entry.feedName,
    customFeedName: null,
    feedUrl: 'https://example.test/feed.xml',
    siteUrl: 'https://example.test/',
    faviconUrl: null,
    faviconIsDark: null,
    entryCount: 1,
    unreadCount: 0,
    isGone: false,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    lastSuccessfulRefreshAt: null,
    lastFailedRefreshAt: null,
    lastErrorClass: null,
    lastErrorMessage: null,
    filterRules: {
        excludeTitle: [],
        excludeContent: [],
        excludeAuthor: [],
    },
    refreshes: [],
};

const renderDetail = (summary?: unknown, summarize = false): string => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    if (summary !== undefined) {
        queryClient.setQueryData(summaryKeys.detail(entry.id), summary);
    }
    queryClient.setQueryData(subscriptionManagementKeys.list(), {
        categories: [{ id: 1, name: 'Technology', subscriptionCount: 1 }],
        subscriptions: [managedSubscription],
    });

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
        expect(markup).toContain('aria-label="Manage Feed"');
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

    it('keeps mobile navigation and a stable detail focus target', () => {
        const markup = renderDetail();

        expect(markup).toContain('aria-label="Back to entry list"');
        expect(markup).toMatch(/<h1[^>]*tabindex="-1"[^>]*>Article<\/h1>/u);
    });

    it('offers the full article toggle in the toolbar', () => {
        const markup = renderDetail();

        expect(markup).toContain('aria-label="Fetch the full article"');
        expect(markup).not.toContain('Read the full article');
    });
});

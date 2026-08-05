import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ChartData, ChartRequest } from '../api/charts';
import { chartKeys } from '../queries/charts';
import { subscriptionManagementKeys } from '../queries/subscriptions';
import {
    BacklogChartsPage,
    ChartsPage,
    ReadingChartsPage,
    RefreshChartsPage,
    refreshAttemptSeries,
} from './ChartsPage';

const request: ChartRequest = {
    range: '30',
    feedId: null,
    categoryId: null,
    startDate: null,
    endDate: null,
};
const chart: ChartData = {
    window: {
        startDate: '2026-06-19',
        endDate: '2026-07-18',
        timeZone: 'UTC',
        dayCount: 2,
    },
    scope: { type: 'all', id: null, name: 'All subscriptions' },
    summary: {
        received: 5,
        currentlyRead: 4,
        currentlySaved: 1,
        currentUnread: 7,
        cohortReadThroughRate: 80,
        refreshAttempts: 3,
        refreshSuccesses: 2,
        refreshFailures: 1,
        refreshSuccessRate: 66.67,
        refreshEntriesCreated: 5,
    },
    days: [
        {
            date: '2026-07-17',
            received: 2,
            currentlyRead: 1,
            currentlyUnread: 1,
            currentlySaved: 0,
            cohortReadThroughRate: 50,
            markedRead: null,
            markedUnread: null,
            saved: null,
            unsaved: null,
            refreshSuccesses: 1,
            refreshFailures: 0,
            refreshEntriesCreated: 2,
        },
        {
            date: '2026-07-18',
            received: 3,
            currentlyRead: 3,
            currentlyUnread: 0,
            currentlySaved: 1,
            cohortReadThroughRate: 100,
            markedRead: 2,
            markedUnread: 1,
            saved: 1,
            unsaved: 0,
            refreshSuccesses: 1,
            refreshFailures: 1,
            refreshEntriesCreated: 3,
        },
    ],
    activityCoverageStart: '2026-07-18',
};

function renderCharts(
    Page:
        | typeof ChartsPage
        | typeof ReadingChartsPage
        | typeof RefreshChartsPage
        | typeof BacklogChartsPage,
    initialEntry: string,
): string {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(chartKeys.detail(request), chart);
    queryClient.setQueryData(subscriptionManagementKeys.list(), {
        categories: [],
        subscriptions: [],
    });

    return renderToStaticMarkup(
        <MemoryRouter initialEntries={[initialEntry]}>
            <QueryClientProvider client={queryClient}>
                <MantineProvider>
                    <Page />
                </MantineProvider>
            </QueryClientProvider>
        </MemoryRouter>,
    );
}

describe('chart report pages', () => {
    it('renders a focused overview with real report links', () => {
        const markup = renderCharts(ChartsPage, '/charts');

        expect(markup).toContain('aria-label="Chart date range"');
        expect(markup).toContain('aria-label="Date range"');
        expect(markup).toContain('aria-label="Chart scope"');
        expect(markup).toContain('aria-label="Overview summary"');
        expect(markup).toContain('Reading flow');
        expect(markup).toContain('Unread backlog');
        expect(markup).toContain('Refresh success rate');
        expect(markup).toContain('View daily chart data');
        expect(markup).toContain('Friday, July 17, 2026');
        expect(markup).toContain('href="/charts/reading"');
        expect(markup).toContain('href="/charts/refresh"');
        expect(markup).toContain('href="/charts/backlog"');
        expect(markup).not.toContain('href="#');
    });

    it('renders reading activity as a distinct report', () => {
        const markup = renderCharts(ReadingChartsPage, '/charts/reading');

        expect(markup).toContain('Reading flow');
        expect(markup).toContain('Reading density');
        expect(markup).toContain('Save density');
        expect(markup).toContain(
            'Reader activity tracking is complete from 2026-07-18.',
        );
        expect(markup).not.toContain('Refresh attempts');
    });

    it('renders refresh health as a distinct report', () => {
        const markup = renderCharts(RefreshChartsPage, '/charts/refresh');

        expect(markup).toContain('Refresh attempts');
        expect(markup).toContain('Success rate');
        expect(markup).toContain('Entries created');
        expect(markup).toContain('66.7%');
        expect(refreshAttemptSeries).toContainEqual({
            name: 'totalAttempts',
            label: 'Total attempts',
            color: 'blue.6',
        });
        expect(markup).not.toContain('Reading density');
    });

    it('renders backlog trends as a distinct report', () => {
        const markup = renderCharts(BacklogChartsPage, '/charts/backlog');

        expect(markup).toContain('Unread backlog');
        expect(markup).toContain('Read-through rate');
        expect(markup).toContain('Arrival density');
        expect(markup).not.toContain('Refresh attempts');
    });
});

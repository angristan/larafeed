import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ChartData, ChartRequest } from '../api/charts';
import { chartKeys } from '../queries/charts';
import { subscriptionManagementKeys } from '../queries/subscriptions';
import { ChartsPage, refreshAttemptSeries } from './ChartsPage';

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

function renderCharts(): string {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(chartKeys.detail(request), chart);
    queryClient.setQueryData(subscriptionManagementKeys.list(), {
        categories: [],
        subscriptions: [],
    });

    return renderToStaticMarkup(
        <MemoryRouter initialEntries={['/charts']}>
            <QueryClientProvider client={queryClient}>
                <MantineProvider>
                    <ChartsPage />
                </MantineProvider>
            </QueryClientProvider>
        </MemoryRouter>,
    );
}

describe('ChartsPage', () => {
    it('renders accessible charts with explicit current-state semantics', () => {
        const markup = renderCharts();

        expect(markup).toContain('Filters');
        expect(markup).toContain('Key Metrics');
        expect(markup).toContain('Daily Reads Activity');
        expect(markup).toContain('Daily Subscription Entries');
        expect(markup).toContain('Daily Saved Entries');
        expect(markup).toContain('Refresh Activity');
        expect(markup).toContain('Daily attempts');
        expect(refreshAttemptSeries).toContainEqual({
            name: 'totalAttempts',
            label: 'Total attempts',
            color: 'blue.6',
        });
        expect(markup).toContain('Success rate');
        expect(markup).toContain('Unread Backlog Trend');
        expect(markup).toContain('Daily Read-through Rate');
        expect(markup).toContain(
            'Reader activity tracking is complete from 2026-07-18.',
        );
        expect(markup).toContain('66.7%');
    });
});

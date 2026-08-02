import { Heatmap, LineChart } from '@mantine/charts';
import {
    Alert,
    Button,
    Card,
    Group,
    Loader,
    NavLink,
    ScrollArea,
    SegmentedControl,
    Select,
    SimpleGrid,
    Skeleton,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import {
    IconActivity,
    IconAdjustments,
    IconChartHistogram,
    IconListDetails,
    IconRefresh,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import type { ChartData, ChartRequest } from '../api/charts';
import {
    canonicalChartSearch,
    defaultCustomDates,
    parseChartState,
} from '../chartState';
import { ApplicationPage } from '../components/ApplicationPage';
import { chartQueryOptions } from '../queries/charts';
import { subscriptionManagementQueryOptions } from '../queries/subscriptions';

export const refreshAttemptSeries = [
    {
        name: 'successes',
        label: 'Successful',
        color: 'teal.6',
    },
    {
        name: 'failures',
        label: 'Failed',
        color: 'red.6',
    },
    {
        name: 'totalAttempts',
        label: 'Total attempts',
        color: 'blue.6',
    },
];

const formatDate = (date: string) =>
    new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
    });

function SummaryCard({
    label,
    value,
    description,
}: {
    readonly label: string;
    readonly value: string;
    readonly description?: string;
}) {
    return (
        <Card padding="lg" radius="md" withBorder>
            <Stack gap={2}>
                <Text c="dimmed" fw={500} size="sm">
                    {label}
                </Text>
                <Title order={3}>{value}</Title>
                {description !== undefined && (
                    <Text c="dimmed" size="sm">
                        {description}
                    </Text>
                )}
            </Stack>
        </Card>
    );
}

function heatmapData(
    days: ChartData['days'],
    key: keyof ChartData['days'][number],
): Record<string, number> {
    const result: Record<string, number> = {};
    for (const day of days) {
        const value = day[key];
        if (typeof value === 'number') result[day.date] = value;
    }
    return result;
}

function ChartsDashboard({ data }: { readonly data: ChartData }) {
    const dateRangeLabel =
        data.window.startDate === data.window.endDate
            ? formatDate(data.window.startDate)
            : `${formatDate(data.window.startDate)} → ${formatDate(
                  data.window.endDate,
              )}`;
    const reads = heatmapData(data.days, 'markedRead');
    const entries = heatmapData(data.days, 'received');
    const saved = heatmapData(data.days, 'saved');
    const refreshActivity = data.days.map((day) => ({
        date: day.date,
        successes: day.refreshSuccesses,
        failures: day.refreshFailures,
        totalAttempts: day.refreshSuccesses + day.refreshFailures,
        entriesCreated: day.refreshEntriesCreated,
    }));
    const refreshRates = data.days.map((day) => {
        const attempts = day.refreshSuccesses + day.refreshFailures;
        return {
            date: day.date,
            successRate:
                attempts === 0 ? null : (day.refreshSuccesses / attempts) * 100,
        };
    });
    const backlog = data.days.map((day) => ({
        date: day.date,
        backlog: day.currentlyUnread,
    }));
    const readThrough = data.days.map((day) => ({
        date: day.date,
        rate: day.cohortReadThroughRate,
    }));

    return (
        <Stack gap="xl">
            <Stack gap="md" id="key-metrics">
                <Title order={2}>Key Metrics</Title>
                <SimpleGrid
                    cols={{ base: 1, sm: 2, md: 3, lg: 5 }}
                    spacing="lg"
                >
                    <SummaryCard
                        label="Entries received"
                        value={data.summary.received.toLocaleString()}
                    />
                    <SummaryCard
                        description={`${(
                            data.summary.cohortReadThroughRate ?? 0
                        ).toFixed(1)}% read-through`}
                        label="Entries read"
                        value={data.summary.currentlyRead.toLocaleString()}
                    />
                    <SummaryCard
                        label="Entries saved"
                        value={data.summary.currentlySaved.toLocaleString()}
                    />
                    <SummaryCard
                        label="Current backlog"
                        value={data.summary.currentUnread.toLocaleString()}
                    />
                    <SummaryCard label="Date range" value={dateRangeLabel} />
                </SimpleGrid>
            </Stack>

            <Stack gap="xl" id="activity">
                <Stack gap="sm">
                    <Title order={2}>Daily Reads Activity</Title>
                    <Heatmap
                        colors={[
                            'var(--mantine-color-blue-1)',
                            'var(--mantine-color-blue-4)',
                            'var(--mantine-color-blue-6)',
                            'var(--mantine-color-blue-8)',
                        ]}
                        data={reads}
                        endDate={data.window.endDate}
                        getTooltipLabel={({ date, value }) =>
                            `${formatDate(date)} – ${
                                value === null || value === 0
                                    ? 'No reads'
                                    : `${value} read${value > 1 ? 's' : ''}`
                            }`
                        }
                        startDate={data.window.startDate}
                        withMonthLabels
                        withTooltip
                        withWeekdayLabels
                    />
                </Stack>
                <Stack gap="sm">
                    <Title order={2}>Daily Subscription Entries</Title>
                    <Heatmap
                        colors={[
                            'var(--mantine-color-green-1)',
                            'var(--mantine-color-green-4)',
                            'var(--mantine-color-green-6)',
                            'var(--mantine-color-green-8)',
                        ]}
                        data={entries}
                        endDate={data.window.endDate}
                        getTooltipLabel={({ date, value }) =>
                            `${formatDate(date)} – ${
                                value === null || value === 0
                                    ? 'No entries'
                                    : `${value} entr${value > 1 ? 'ies' : 'y'}`
                            }`
                        }
                        startDate={data.window.startDate}
                        withMonthLabels
                        withTooltip
                        withWeekdayLabels
                    />
                </Stack>
                <Stack gap="sm">
                    <Title order={2}>Daily Saved Entries</Title>
                    <Heatmap
                        colors={[
                            'var(--mantine-color-yellow-1)',
                            'var(--mantine-color-yellow-4)',
                            'var(--mantine-color-yellow-6)',
                            'var(--mantine-color-yellow-8)',
                        ]}
                        data={saved}
                        endDate={data.window.endDate}
                        getTooltipLabel={({ date, value }) =>
                            `${formatDate(date)} – ${
                                value === null || value === 0
                                    ? 'No saves'
                                    : `${value} save${value > 1 ? 's' : ''}`
                            }`
                        }
                        startDate={data.window.startDate}
                        withMonthLabels
                        withTooltip
                        withWeekdayLabels
                    />
                </Stack>
                <Alert color="blue" variant="light">
                    {data.activityCoverageStart === null
                        ? 'Reader activity tracking starts after this chart window.'
                        : `Reader activity tracking is complete from ${data.activityCoverageStart}. Earlier days are shown as unavailable.`}
                </Alert>
            </Stack>

            <Stack gap="xl" id="refreshes">
                <Stack gap="sm">
                    <Title order={2}>Refresh Activity</Title>
                    <SimpleGrid
                        cols={{ base: 1, sm: 2, md: 3, lg: 5 }}
                        spacing="lg"
                    >
                        <SummaryCard
                            label="Refresh attempts"
                            value={data.summary.refreshAttempts.toLocaleString()}
                        />
                        <SummaryCard
                            label="Success rate"
                            value={`${(
                                data.summary.refreshSuccessRate ?? 0
                            ).toFixed(1)}%`}
                        />
                        <SummaryCard
                            label="Successful refreshes"
                            value={data.summary.refreshSuccesses.toLocaleString()}
                        />
                        <SummaryCard
                            label="Failed refreshes"
                            value={data.summary.refreshFailures.toLocaleString()}
                        />
                        <SummaryCard
                            description="Entries gathered during refreshes"
                            label="Entries created"
                            value={data.summary.refreshEntriesCreated.toLocaleString()}
                        />
                    </SimpleGrid>
                </Stack>

                {data.summary.refreshAttempts > 0 ? (
                    <Stack gap="xl">
                        <Stack gap="sm">
                            <Title order={3}>Daily attempts</Title>
                            <LineChart
                                data={refreshActivity}
                                dataKey="date"
                                h={300}
                                series={refreshAttemptSeries}
                                valueFormatter={(value) =>
                                    Number.isFinite(value)
                                        ? Number(value).toLocaleString()
                                        : '–'
                                }
                                withLegend
                                xAxisLabel="Date"
                                yAxisLabel="Attempts"
                            />
                        </Stack>
                        <Stack gap="sm">
                            <Title order={3}>Success rate</Title>
                            <LineChart
                                connectNulls={false}
                                data={refreshRates}
                                dataKey="date"
                                h={300}
                                series={[
                                    {
                                        name: 'successRate',
                                        label: 'Success rate %',
                                        color: 'teal.6',
                                    },
                                ]}
                                unit="%"
                                valueFormatter={(value) =>
                                    Number.isFinite(value)
                                        ? `${Number(value).toFixed(1)}%`
                                        : '–'
                                }
                                withLegend={false}
                                xAxisLabel="Date"
                                yAxisLabel="%"
                            />
                        </Stack>
                    </Stack>
                ) : (
                    <Text c="dimmed" size="sm">
                        No refresh activity recorded for this period.
                    </Text>
                )}
            </Stack>

            <Stack gap="xl" id="trends">
                <Stack gap="sm">
                    <Title order={2}>Unread Backlog Trend</Title>
                    <LineChart
                        data={backlog}
                        dataKey="date"
                        h={300}
                        series={[
                            {
                                name: 'backlog',
                                label: 'Unread backlog',
                                color: 'orange.6',
                            },
                        ]}
                        valueFormatter={(value) =>
                            Number.isFinite(value)
                                ? Number(value).toLocaleString()
                                : '–'
                        }
                        withLegend
                        xAxisLabel="Date"
                        yAxisLabel="Entries"
                    />
                </Stack>
                <Stack gap="sm">
                    <Title order={2}>Daily Read-through Rate</Title>
                    <LineChart
                        connectNulls={false}
                        data={readThrough}
                        dataKey="date"
                        h={300}
                        series={[
                            {
                                name: 'rate',
                                label: 'Read-through %',
                                color: 'indigo.6',
                            },
                        ]}
                        unit="%"
                        valueFormatter={(value) =>
                            Number.isFinite(value)
                                ? `${Number(value).toFixed(1)}%`
                                : '–'
                        }
                        withLegend
                        xAxisLabel="Date"
                        yAxisLabel="%"
                    />
                </Stack>
            </Stack>
        </Stack>
    );
}

export function ChartsPage() {
    const [searchParameters] = useSearchParams();
    const navigate = useNavigate();
    const state = useMemo(
        () => parseChartState(searchParameters),
        [searchParameters],
    );
    const subscriptions = useQuery(subscriptionManagementQueryOptions);
    const charts = useQuery(chartQueryOptions(state));
    const [startDate, setStartDate] = useState(state.startDate ?? '');
    const [endDate, setEndDate] = useState(state.endDate ?? '');
    const [group, setGroup] = useState<'all' | 'feed' | 'category'>(() =>
        state.feedId !== null
            ? 'feed'
            : state.categoryId !== null
              ? 'category'
              : 'all',
    );

    useEffect(() => {
        setStartDate(state.startDate ?? '');
        setEndDate(state.endDate ?? '');
    }, [state.endDate, state.startDate]);

    const update = (next: ChartRequest) => {
        const search = canonicalChartSearch(next);
        void navigate({
            pathname: '/charts',
            search: search.length > 0 ? `?${search}` : '',
        });
    };
    const applyDates = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        update({ ...state, range: 'custom', startDate, endDate });
    };
    useEffect(() => {
        if (state.feedId !== null) {
            setGroup('feed');
        } else if (state.categoryId !== null) {
            setGroup('category');
        } else {
            setGroup('all');
        }
    }, [state.categoryId, state.feedId]);

    const sidebar = (
        <ScrollArea style={{ height: 'calc(100vh - 96px)' }} type="auto">
            <Stack gap="sm" p="md">
                <Title order={4}>Sections</Title>
                <NavLink
                    component="a"
                    description="Range & grouping"
                    href="#filters"
                    label="Filters"
                    leftSection={<IconAdjustments size={16} stroke={1.5} />}
                />
                <NavLink
                    component="a"
                    description="Overall totals"
                    href="#key-metrics"
                    label="Key metrics"
                    leftSection={<IconListDetails size={16} stroke={1.5} />}
                />
                <NavLink
                    component="a"
                    description="Reads, entries, saves"
                    href="#activity"
                    label="Daily activity"
                    leftSection={<IconActivity size={16} stroke={1.5} />}
                />
                <NavLink
                    component="a"
                    description="Attempts & success"
                    href="#refreshes"
                    label="Refresh activity"
                    leftSection={<IconRefresh size={16} stroke={1.5} />}
                />
                <NavLink
                    component="a"
                    description="Backlog & read-through"
                    href="#trends"
                    label="Trends"
                    leftSection={<IconChartHistogram size={16} stroke={1.5} />}
                />
            </Stack>
        </ScrollArea>
    );

    return (
        <ApplicationPage activePage="charts" sidebar={sidebar}>
            <Stack gap="xl">
                <Stack gap="md" id="filters">
                    <Title order={2}>Filters</Title>
                    <Stack gap="sm">
                        <Group gap="sm" wrap="wrap">
                            <SegmentedControl
                                data={[
                                    { value: '30', label: '30 days' },
                                    { value: '90', label: '90 days' },
                                    { value: '365', label: '365 days' },
                                    { value: 'custom', label: 'Custom' },
                                ]}
                                onChange={(value) => {
                                    const range =
                                        value as ChartRequest['range'];
                                    const custom = defaultCustomDates(
                                        Date.now(),
                                    );
                                    update({
                                        ...state,
                                        range,
                                        startDate:
                                            range === 'custom'
                                                ? custom.startDate
                                                : null,
                                        endDate:
                                            range === 'custom'
                                                ? custom.endDate
                                                : null,
                                    });
                                }}
                                value={state.range}
                            />
                            {state.range === 'custom' && (
                                <form onSubmit={applyDates}>
                                    <Group
                                        align="flex-end"
                                        gap="xs"
                                        wrap="wrap"
                                    >
                                        <TextInput
                                            label="Start"
                                            max={endDate}
                                            onChange={(event) =>
                                                setStartDate(
                                                    event.currentTarget.value,
                                                )
                                            }
                                            size="sm"
                                            type="date"
                                            value={startDate}
                                        />
                                        <TextInput
                                            label="End"
                                            max={
                                                defaultCustomDates(Date.now())
                                                    .endDate
                                            }
                                            min={startDate}
                                            onChange={(event) =>
                                                setEndDate(
                                                    event.currentTarget.value,
                                                )
                                            }
                                            size="sm"
                                            type="date"
                                            value={endDate}
                                        />
                                        <Button size="sm" type="submit">
                                            Apply
                                        </Button>
                                    </Group>
                                </form>
                            )}
                        </Group>
                        <Group gap="sm" wrap="wrap">
                            <SegmentedControl
                                data={[
                                    {
                                        value: 'all',
                                        label: 'All subscriptions',
                                    },
                                    { value: 'feed', label: 'By feed' },
                                    { value: 'category', label: 'By category' },
                                ]}
                                onChange={(value) => {
                                    const nextGroup = value as
                                        | 'all'
                                        | 'feed'
                                        | 'category';
                                    setGroup(nextGroup);
                                    if (nextGroup === 'feed') {
                                        const feedId =
                                            subscriptions.data?.subscriptions[0]
                                                ?.feedId;
                                        if (feedId === undefined) return;
                                        update({
                                            ...state,
                                            feedId,
                                            categoryId: null,
                                        });
                                    } else if (nextGroup === 'category') {
                                        const categoryId =
                                            subscriptions.data?.categories[0]
                                                ?.id;
                                        if (categoryId === undefined) return;
                                        update({
                                            ...state,
                                            categoryId,
                                            feedId: null,
                                        });
                                    } else {
                                        update({
                                            ...state,
                                            feedId: null,
                                            categoryId: null,
                                        });
                                    }
                                }}
                                value={group}
                            />
                            {group === 'feed' && (
                                <Select
                                    data={
                                        subscriptions.data?.subscriptions.map(
                                            (subscription) => ({
                                                value: String(
                                                    subscription.feedId,
                                                ),
                                                label:
                                                    subscription.customFeedName ??
                                                    subscription.feedName,
                                            }),
                                        ) ?? []
                                    }
                                    nothingFoundMessage="No feeds"
                                    onChange={(value) =>
                                        update({
                                            ...state,
                                            feedId:
                                                value === null
                                                    ? null
                                                    : Number(value),
                                            categoryId: null,
                                        })
                                    }
                                    placeholder="Select feed"
                                    searchable
                                    value={
                                        state.feedId === null
                                            ? null
                                            : String(state.feedId)
                                    }
                                />
                            )}
                            {group === 'category' && (
                                <Select
                                    data={
                                        subscriptions.data?.categories.map(
                                            (category) => ({
                                                value: String(category.id),
                                                label: category.name,
                                            }),
                                        ) ?? []
                                    }
                                    nothingFoundMessage="No categories"
                                    onChange={(value) =>
                                        update({
                                            ...state,
                                            categoryId:
                                                value === null
                                                    ? null
                                                    : Number(value),
                                            feedId: null,
                                        })
                                    }
                                    placeholder="Select category"
                                    searchable
                                    value={
                                        state.categoryId === null
                                            ? null
                                            : String(state.categoryId)
                                    }
                                />
                            )}
                        </Group>
                        {subscriptions.isPending && (
                            <Group gap="xs">
                                <Loader size="xs" />
                                <Text c="dimmed" size="sm">
                                    Loading feeds and categories…
                                </Text>
                            </Group>
                        )}
                        {subscriptions.isError && (
                            <Alert color="red" title="Chart scopes unavailable">
                                <Stack align="flex-start" gap="xs">
                                    <Text size="sm">
                                        {subscriptions.error.message}
                                    </Text>
                                    <Button
                                        onClick={() =>
                                            void subscriptions.refetch()
                                        }
                                        size="xs"
                                        variant="light"
                                    >
                                        Retry
                                    </Button>
                                </Stack>
                            </Alert>
                        )}
                        {charts.data !== undefined && (
                            <Text c="dimmed" size="sm">
                                Showing data from{' '}
                                {formatDate(charts.data.window.startDate)} →{' '}
                                {formatDate(charts.data.window.endDate)}.
                            </Text>
                        )}
                    </Stack>
                </Stack>

                {charts.isPending && (
                    <Stack aria-label="Loading charts" gap="lg">
                        <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 5 }}>
                            {['one', 'two', 'three', 'four', 'five'].map(
                                (key) => (
                                    <Skeleton key={key} height={112} />
                                ),
                            )}
                        </SimpleGrid>
                    </Stack>
                )}
                {charts.isFetching && charts.data !== undefined && (
                    <Loader aria-label="Refreshing charts" size="sm" />
                )}
                {charts.isError && (
                    <Alert color="red" role="alert" title="Charts unavailable">
                        <Stack align="flex-start" gap="sm">
                            <Text size="sm">{charts.error.message}</Text>
                            <Button
                                leftSection={
                                    <IconRefresh aria-hidden="true" size={16} />
                                }
                                onClick={() => void charts.refetch()}
                                size="xs"
                                variant="light"
                            >
                                Retry
                            </Button>
                        </Stack>
                    </Alert>
                )}
                {charts.data !== undefined && (
                    <ChartsDashboard data={charts.data} />
                )}
            </Stack>
        </ApplicationPage>
    );
}

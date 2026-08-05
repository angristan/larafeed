import { Heatmap, LineChart } from '@mantine/charts';
import {
    Alert,
    Button,
    Group,
    Loader,
    NavLink,
    Paper,
    ScrollArea,
    SegmentedControl,
    Select,
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
import {
    type FormEvent,
    type ReactNode,
    useEffect,
    useMemo,
    useState,
} from 'react';
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
import classes from './ChartsPage.module.css';

export const refreshAttemptSeries = [
    {
        name: 'successes',
        label: 'Successful',
        color: 'sage.6',
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

function SummaryMetric({
    label,
    value,
    description,
}: {
    readonly label: string;
    readonly value: string;
    readonly description?: string;
}) {
    return (
        <div className={classes.summaryMetric}>
            <Text className={classes.metricLabel} component="span">
                {label}
            </Text>
            <Text className={classes.metricValue} component="strong">
                {value}
            </Text>
            {description !== undefined && (
                <Text c="dimmed" component="span" size="xs">
                    {description}
                </Text>
            )}
        </div>
    );
}

function ChartSurface({
    children,
    title,
}: {
    readonly children: ReactNode;
    readonly title: string;
}) {
    return (
        <Paper className={classes.chartSurface} component="section" p={0}>
            <header className={classes.surfaceHeader}>
                <Title order={3}>{title}</Title>
            </header>
            <div className={classes.chartBody}>{children}</div>
        </Paper>
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
            <Paper
                className={classes.summarySurface}
                component="section"
                id="key-metrics"
                p={0}
            >
                <header className={classes.surfaceHeader}>
                    <Title order={2}>Key Metrics</Title>
                    <Text c="dimmed" size="xs">
                        {dateRangeLabel}
                    </Text>
                </header>
                <div className={classes.summaryStrip}>
                    <SummaryMetric
                        label="Entries received"
                        value={data.summary.received.toLocaleString()}
                    />
                    <SummaryMetric
                        description={`${(
                            data.summary.cohortReadThroughRate ?? 0
                        ).toFixed(1)}% read-through`}
                        label="Entries read"
                        value={data.summary.currentlyRead.toLocaleString()}
                    />
                    <SummaryMetric
                        label="Entries saved"
                        value={data.summary.currentlySaved.toLocaleString()}
                    />
                    <SummaryMetric
                        label="Current backlog"
                        value={data.summary.currentUnread.toLocaleString()}
                    />
                </div>
            </Paper>

            <Stack component="section" gap="md" id="activity">
                <div className={classes.sectionHeading}>
                    <Title order={2}>Daily activity</Title>
                    <Text c="dimmed" size="sm">
                        Reader actions and feed arrivals across the selected
                        range.
                    </Text>
                </div>
                <ChartSurface title="Daily Reads Activity">
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
                </ChartSurface>
                <ChartSurface title="Daily Subscription Entries">
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
                </ChartSurface>
                <ChartSurface title="Daily Saved Entries">
                    <Heatmap
                        colors={[
                            'var(--mantine-color-orange-1)',
                            'var(--mantine-color-orange-4)',
                            'var(--mantine-color-orange-6)',
                            'var(--mantine-color-orange-8)',
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
                </ChartSurface>
                <Alert color="blue" variant="light">
                    {data.activityCoverageStart === null
                        ? 'Reader activity tracking starts after this chart window.'
                        : `Reader activity tracking is complete from ${data.activityCoverageStart}. Earlier days are shown as unavailable.`}
                </Alert>
            </Stack>

            <Stack component="section" gap="md" id="refreshes">
                <Paper className={classes.summarySurface} p={0}>
                    <header className={classes.surfaceHeader}>
                        <Title order={2}>Refresh Activity</Title>
                    </header>
                    <div
                        className={`${classes.summaryStrip} ${classes.refreshSummary}`}
                    >
                        <SummaryMetric
                            label="Refresh attempts"
                            value={data.summary.refreshAttempts.toLocaleString()}
                        />
                        <SummaryMetric
                            label="Success rate"
                            value={`${(
                                data.summary.refreshSuccessRate ?? 0
                            ).toFixed(1)}%`}
                        />
                        <SummaryMetric
                            label="Successful refreshes"
                            value={data.summary.refreshSuccesses.toLocaleString()}
                        />
                        <SummaryMetric
                            label="Failed refreshes"
                            value={data.summary.refreshFailures.toLocaleString()}
                        />
                        <SummaryMetric
                            label="Entries created"
                            value={data.summary.refreshEntriesCreated.toLocaleString()}
                        />
                    </div>
                </Paper>

                {data.summary.refreshAttempts > 0 ? (
                    <Stack gap="md">
                        <ChartSurface title="Daily attempts">
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
                        </ChartSurface>
                        <ChartSurface title="Success rate">
                            <LineChart
                                connectNulls={false}
                                data={refreshRates}
                                dataKey="date"
                                h={300}
                                series={[
                                    {
                                        name: 'successRate',
                                        label: 'Success rate %',
                                        color: 'sage.6',
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
                        </ChartSurface>
                    </Stack>
                ) : (
                    <Text className={classes.emptyState} c="dimmed" size="sm">
                        No refresh activity recorded for this period.
                    </Text>
                )}
            </Stack>

            <Stack component="section" gap="md" id="trends">
                <div className={classes.sectionHeading}>
                    <Title order={2}>Reading trends</Title>
                    <Text c="dimmed" size="sm">
                        Backlog pressure and cohort completion over time.
                    </Text>
                </div>
                <ChartSurface title="Unread Backlog Trend">
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
                </ChartSurface>
                <ChartSurface title="Daily Read-through Rate">
                    <LineChart
                        connectNulls={false}
                        data={readThrough}
                        dataKey="date"
                        h={300}
                        series={[
                            {
                                name: 'rate',
                                label: 'Read-through %',
                                color: 'sky.6',
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
                </ChartSurface>
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
            <Stack className={classes.page} gap="xl">
                <Stack gap={4}>
                    <Title order={1}>Reading activity</Title>
                    <Text c="dimmed" size="sm">
                        Follow what arrives, what you read, and how reliably
                        feeds refresh.
                    </Text>
                </Stack>

                <Paper
                    className={classes.filterSurface}
                    component="section"
                    id="filters"
                    p={0}
                >
                    <header className={classes.surfaceHeader}>
                        <Title order={2}>Filters</Title>
                        {charts.data !== undefined && (
                            <Text c="dimmed" size="xs">
                                {formatDate(charts.data.window.startDate)} →{' '}
                                {formatDate(charts.data.window.endDate)}
                            </Text>
                        )}
                    </header>
                    <Stack className={classes.filterBody} gap="sm">
                        <Group
                            className={classes.toolbarRow}
                            gap="sm"
                            wrap="wrap"
                        >
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
                        <Group
                            className={classes.toolbarRow}
                            gap="sm"
                            wrap="wrap"
                        >
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
                    </Stack>
                </Paper>

                {charts.isPending && (
                    <Paper
                        aria-label="Loading charts"
                        className={classes.summarySurface}
                        p={0}
                    >
                        <div className={classes.loadingHeader}>
                            <Skeleton height={22} width={140} />
                        </div>
                        <div className={classes.summaryStrip}>
                            {['one', 'two', 'three', 'four'].map((key) => (
                                <Skeleton key={key} height={58} />
                            ))}
                        </div>
                    </Paper>
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

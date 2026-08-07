import { BarChart, Heatmap, LineChart } from '@mantine/charts';
import {
    Alert,
    Button,
    Group,
    Loader,
    NavLink,
    Paper,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
    VisuallyHidden,
} from '@mantine/core';
import {
    IconActivity,
    IconChartHistogram,
    IconListDetails,
    IconRefresh,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
    type FormEvent,
    type ReactNode,
    type PointerEvent as ReactPointerEvent,
    useEffect,
    useId,
    useMemo,
    useState,
} from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';

import type { ChartData, ChartRequest } from '../api/charts';
import {
    canonicalChartSearch,
    defaultCustomDates,
    parseChartState,
} from '../chartState';
import {
    ApplicationPage,
    ApplicationSidebarHeader,
    ApplicationSidebarNavigation,
} from '../components/ApplicationPage';
import { chartQueryOptions } from '../queries/charts';
import { subscriptionManagementQueryOptions } from '../queries/subscriptions';
import classes from './ChartsPage.module.css';

type ChartReportView = 'overview' | 'reading' | 'refresh' | 'backlog';

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

const formatShortDate = (date: string) =>
    new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-US', {
        month: 'short',
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

interface InstrumentMetric {
    readonly description?: string;
    readonly label: string;
    readonly value: string;
}

function InstrumentStrip({
    label,
    metrics,
}: {
    readonly label: string;
    readonly metrics: readonly InstrumentMetric[];
}) {
    return (
        <Paper
            aria-label={`${label} summary`}
            className={classes.instrumentStrip}
            component="section"
            p={0}
        >
            <Text className={classes.instrumentGroupLabel}>{label}</Text>
            <div className={classes.instrumentMetrics}>
                {metrics.map((metric) => (
                    <SummaryMetric key={metric.label} {...metric} />
                ))}
            </div>
        </Paper>
    );
}

function ChartSurface({
    children,
    detail,
    primary = false,
    title,
}: {
    readonly children: ReactNode;
    readonly detail?: string;
    readonly primary?: boolean;
    readonly title: string;
}) {
    const titleId = useId();
    const trackTooltip = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== 'mouse') return;
        const region = event.currentTarget;
        const tooltip = region.querySelector<HTMLElement>(
            '.recharts-tooltip-wrapper',
        );
        if (tooltip === null) return;
        const regionBounds = region.getBoundingClientRect();
        const pointerY = event.clientY - regionBounds.top;
        const tooltipHeight = Math.max(tooltip.offsetHeight, 140);
        const below = pointerY + tooltipHeight + 20;
        const top =
            below > regionBounds.height
                ? pointerY - tooltipHeight - 12
                : pointerY + 12;
        region.style.setProperty('--chart-tooltip-y', `${Math.max(8, top)}px`);
    };

    return (
        <Paper
            aria-labelledby={titleId}
            className={`${classes.chartSurface} ${
                primary ? classes.primaryChart : ''
            }`}
            component="section"
            p={0}
        >
            <header className={classes.surfaceHeader}>
                <div>
                    <Title id={titleId} order={3}>
                        {title}
                    </Title>
                    {detail !== undefined && (
                        <Text c="dimmed" size="xs">
                            {detail}
                        </Text>
                    )}
                </div>
            </header>
            <div className={classes.chartBody} onPointerMove={trackTooltip}>
                {children}
            </div>
        </Paper>
    );
}

function chartTableValue(value: number | null): string {
    return value === null ? '–' : value.toLocaleString();
}

function ChartDataDisclosure({
    data,
    view,
}: {
    readonly data: ChartData;
    readonly view: ChartReportView;
}) {
    const reading = view === 'overview' || view === 'reading';
    const refresh = view === 'refresh';

    return (
        <details className={classes.dataDisclosure}>
            <summary>View daily chart data</summary>
            <Table.ScrollContainer minWidth={reading ? 560 : 500}>
                <Table striped withRowBorders>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Date</Table.Th>
                            {reading && (
                                <>
                                    <Table.Th ta="right">Received</Table.Th>
                                    <Table.Th ta="right">Read</Table.Th>
                                    <Table.Th ta="right">Saved</Table.Th>
                                </>
                            )}
                            {refresh && (
                                <>
                                    <Table.Th ta="right">Successful</Table.Th>
                                    <Table.Th ta="right">Failed</Table.Th>
                                    <Table.Th ta="right">
                                        Entries created
                                    </Table.Th>
                                </>
                            )}
                            {!reading && !refresh && (
                                <>
                                    <Table.Th ta="right">
                                        Unread backlog
                                    </Table.Th>
                                    <Table.Th ta="right">Read-through</Table.Th>
                                    <Table.Th ta="right">Received</Table.Th>
                                </>
                            )}
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {data.days.map((day) => (
                            <Table.Tr key={day.date}>
                                <Table.Td>{formatDate(day.date)}</Table.Td>
                                {reading && (
                                    <>
                                        <Table.Td ta="right">
                                            {day.received.toLocaleString()}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {chartTableValue(day.markedRead)}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {chartTableValue(day.saved)}
                                        </Table.Td>
                                    </>
                                )}
                                {refresh && (
                                    <>
                                        <Table.Td ta="right">
                                            {day.refreshSuccesses.toLocaleString()}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {day.refreshFailures.toLocaleString()}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {day.refreshEntriesCreated.toLocaleString()}
                                        </Table.Td>
                                    </>
                                )}
                                {!reading && !refresh && (
                                    <>
                                        <Table.Td ta="right">
                                            {day.currentlyUnread.toLocaleString()}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {day.cohortReadThroughRate === null
                                                ? '–'
                                                : `${day.cohortReadThroughRate.toFixed(1)}%`}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {day.received.toLocaleString()}
                                        </Table.Td>
                                    </>
                                )}
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </Table.ScrollContainer>
        </details>
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

function ChartsDashboard({
    data,
    view,
}: {
    readonly data: ChartData;
    readonly view: ChartReportView;
}) {
    const reads = heatmapData(data.days, 'markedRead');
    const entries = heatmapData(data.days, 'received');
    const saved = heatmapData(data.days, 'saved');
    const readingFlow = data.days.map((day) => ({
        date: formatShortDate(day.date),
        received: day.received,
        read: day.markedRead ?? 0,
        saved: day.saved ?? 0,
    }));
    const refreshActivity = data.days.map((day) => ({
        date: formatShortDate(day.date),
        successes: day.refreshSuccesses,
        failures: day.refreshFailures,
        totalAttempts: day.refreshSuccesses + day.refreshFailures,
        entriesCreated: day.refreshEntriesCreated,
    }));
    const refreshRates = data.days.map((day) => {
        const attempts = day.refreshSuccesses + day.refreshFailures;
        return {
            date: formatShortDate(day.date),
            successRate:
                attempts === 0 ? null : (day.refreshSuccesses / attempts) * 100,
        };
    });
    const backlog = data.days.map((day) => ({
        date: formatShortDate(day.date),
        backlog: day.currentlyUnread,
    }));
    const readThrough = data.days.map((day) => ({
        date: formatShortDate(day.date),
        rate: day.cohortReadThroughRate,
    }));
    const instrument = {
        overview: {
            label: 'Overview',
            metrics: [
                {
                    label: 'Entries received',
                    value: data.summary.received.toLocaleString(),
                },
                {
                    label: 'Read-through',
                    value: `${(data.summary.cohortReadThroughRate ?? 0).toFixed(
                        1,
                    )}%`,
                },
                {
                    label: 'Current backlog',
                    value: data.summary.currentUnread.toLocaleString(),
                },
                {
                    label: 'Refresh success',
                    value: `${(data.summary.refreshSuccessRate ?? 0).toFixed(
                        1,
                    )}%`,
                },
            ],
        },
        reading: {
            label: 'Reading activity',
            metrics: [
                {
                    label: 'Received',
                    value: data.summary.received.toLocaleString(),
                },
                {
                    label: 'Read',
                    value: data.summary.currentlyRead.toLocaleString(),
                },
                {
                    label: 'Saved',
                    value: data.summary.currentlySaved.toLocaleString(),
                },
                {
                    label: 'Read-through',
                    value: `${(data.summary.cohortReadThroughRate ?? 0).toFixed(
                        1,
                    )}%`,
                },
            ],
        },
        refresh: {
            label: 'Refresh health',
            metrics: [
                {
                    label: 'Attempts',
                    value: data.summary.refreshAttempts.toLocaleString(),
                },
                {
                    label: 'Success rate',
                    value: `${(data.summary.refreshSuccessRate ?? 0).toFixed(
                        1,
                    )}%`,
                },
                {
                    label: 'Failures',
                    value: data.summary.refreshFailures.toLocaleString(),
                },
                {
                    label: 'Entries created',
                    value: data.summary.refreshEntriesCreated.toLocaleString(),
                },
            ],
        },
        backlog: {
            label: 'Backlog pressure',
            metrics: [
                {
                    label: 'Current backlog',
                    value: data.summary.currentUnread.toLocaleString(),
                },
                {
                    label: 'Read-through',
                    value: `${(data.summary.cohortReadThroughRate ?? 0).toFixed(
                        1,
                    )}%`,
                },
                {
                    label: 'Received',
                    value: data.summary.received.toLocaleString(),
                },
                {
                    label: 'Read',
                    value: data.summary.currentlyRead.toLocaleString(),
                },
            ],
        },
    }[view];

    return (
        <Stack gap="md">
            <InstrumentStrip {...instrument} />

            {view === 'overview' && (
                <Stack gap="md">
                    <ChartSurface
                        detail="Arrivals, reads, and saves"
                        primary
                        title="Reading flow"
                    >
                        <BarChart
                            data={readingFlow}
                            dataKey="date"
                            h={300}
                            maxBarWidth={18}
                            series={[
                                {
                                    name: 'received',
                                    label: 'Received',
                                    color: 'teal.7',
                                },
                                {
                                    name: 'read',
                                    label: 'Read',
                                    color: 'sky.6',
                                },
                                {
                                    name: 'saved',
                                    label: 'Saved',
                                    color: 'orange.6',
                                },
                            ]}
                            valueFormatter={(value) =>
                                Number(value).toLocaleString()
                            }
                            withLegend
                            xAxisLabel="Date"
                            yAxisLabel="Entries"
                        />
                    </ChartSurface>
                    <div className={classes.reportGrid}>
                        <ChartSurface title="Unread backlog">
                            <LineChart
                                data={backlog}
                                dataKey="date"
                                h={260}
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
                                withLegend={false}
                                xAxisLabel="Date"
                                yAxisLabel="Entries"
                            />
                        </ChartSurface>
                        <ChartSurface title="Refresh success rate">
                            <LineChart
                                connectNulls={false}
                                data={refreshRates}
                                dataKey="date"
                                h={260}
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
                                        ? Number(value).toFixed(1)
                                        : '–'
                                }
                                withLegend={false}
                                xAxisLabel="Date"
                            />
                        </ChartSurface>
                    </div>
                </Stack>
            )}

            {view === 'reading' && (
                <Stack component="section" gap="md">
                    <ChartSurface
                        detail="Arrivals, reads, and saves"
                        primary
                        title="Reading flow"
                    >
                        <BarChart
                            data={readingFlow}
                            dataKey="date"
                            h={300}
                            maxBarWidth={18}
                            series={[
                                {
                                    name: 'received',
                                    label: 'Received',
                                    color: 'teal.7',
                                },
                                {
                                    name: 'read',
                                    label: 'Read',
                                    color: 'sky.6',
                                },
                                {
                                    name: 'saved',
                                    label: 'Saved',
                                    color: 'orange.6',
                                },
                            ]}
                            valueFormatter={(value) =>
                                Number(value).toLocaleString()
                            }
                            withLegend
                            xAxisLabel="Date"
                            yAxisLabel="Entries"
                        />
                    </ChartSurface>
                    <div className={classes.reportGrid}>
                        <ChartSurface
                            detail="Reads per calendar day"
                            title="Reading density"
                        >
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
                        <ChartSurface
                            detail="Saved entries per calendar day"
                            title="Save density"
                        >
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
                    </div>
                    <Alert color="blue" variant="light">
                        {data.activityCoverageStart === null
                            ? 'Reader activity tracking starts after this chart window.'
                            : `Reader activity tracking is complete from ${data.activityCoverageStart}. Earlier days are shown as unavailable.`}
                    </Alert>
                </Stack>
            )}

            {view === 'refresh' && (
                <Stack component="section" gap="md">
                    {data.summary.refreshAttempts > 0 ? (
                        <Stack gap="md">
                            <ChartSurface
                                detail="Successful and failed refreshes"
                                primary
                                title="Refresh attempts"
                            >
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
                            <div className={classes.reportGrid}>
                                <ChartSurface
                                    detail="Successful attempts by day"
                                    title="Success rate"
                                >
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
                                                ? Number(value).toFixed(1)
                                                : '–'
                                        }
                                        withLegend={false}
                                        xAxisLabel="Date"
                                    />
                                </ChartSurface>
                                <ChartSurface
                                    detail="New entries found during refreshes"
                                    title="Entries created"
                                >
                                    <LineChart
                                        data={refreshActivity}
                                        dataKey="date"
                                        h={260}
                                        series={[
                                            {
                                                name: 'entriesCreated',
                                                label: 'Entries created',
                                                color: 'sky.6',
                                            },
                                        ]}
                                        valueFormatter={(value) =>
                                            Number(value).toLocaleString()
                                        }
                                        withLegend={false}
                                        xAxisLabel="Date"
                                        yAxisLabel="Entries"
                                    />
                                </ChartSurface>
                            </div>
                        </Stack>
                    ) : (
                        <Text
                            className={classes.emptyState}
                            c="dimmed"
                            size="sm"
                        >
                            No refresh activity recorded for this period.
                        </Text>
                    )}
                </Stack>
            )}

            {view === 'backlog' && (
                <Stack component="section" gap="md">
                    <ChartSurface
                        detail="Unread pressure over time"
                        primary
                        title="Unread backlog"
                    >
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
                    <div className={classes.reportGrid}>
                        <ChartSurface
                            detail="Cohort completion by day"
                            title="Read-through rate"
                        >
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
                                        ? Number(value).toFixed(1)
                                        : '–'
                                }
                                withLegend
                                xAxisLabel="Date"
                            />
                        </ChartSurface>
                        <ChartSurface
                            detail="New entries per calendar day"
                            title="Arrival density"
                        >
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
                    </div>
                </Stack>
            )}

            <ChartDataDisclosure data={data} view={view} />
        </Stack>
    );
}

function ChartReportWorkspace({ view }: { readonly view: ChartReportView }) {
    const [searchParameters] = useSearchParams();
    const location = useLocation();
    const navigate = useNavigate();
    const state = useMemo(
        () => parseChartState(searchParameters),
        [searchParameters],
    );
    const subscriptions = useQuery(subscriptionManagementQueryOptions);
    const charts = useQuery(chartQueryOptions(state));
    const [startDate, setStartDate] = useState(state.startDate ?? '');
    const [endDate, setEndDate] = useState(state.endDate ?? '');

    useEffect(() => {
        setStartDate(state.startDate ?? '');
        setEndDate(state.endDate ?? '');
    }, [state.endDate, state.startDate]);

    const update = (next: ChartRequest) => {
        const search = canonicalChartSearch(next);
        void navigate({
            pathname: location.pathname,
            search: search.length > 0 ? `?${search}` : '',
        });
    };
    const applyDates = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        update({ ...state, range: 'custom', startDate, endDate });
    };
    const reportRoutes = [
        {
            view: 'overview',
            to: '/charts',
            label: 'Overview',
            description: 'Important signals',
            icon: IconListDetails,
        },
        {
            view: 'reading',
            to: '/charts/reading',
            label: 'Reading activity',
            description: 'Entries, reads, saves',
            icon: IconActivity,
        },
        {
            view: 'refresh',
            to: '/charts/refresh',
            label: 'Refresh health',
            description: 'Attempts and failures',
            icon: IconRefresh,
        },
        {
            view: 'backlog',
            to: '/charts/backlog',
            label: 'Backlog trends',
            description: 'Unread and read-through',
            icon: IconChartHistogram,
        },
    ] as const;
    const sidebar = (
        <>
            <ApplicationSidebarHeader
                description="Reader reports and feed health"
                title="Charts"
            />
            <ApplicationSidebarNavigation>
                {reportRoutes.map((report) => {
                    const Icon = report.icon;
                    return (
                        <NavLink
                            key={report.to}
                            active={view === report.view}
                            component={Link}
                            description={report.description}
                            label={report.label}
                            leftSection={<Icon size={16} stroke={1.5} />}
                            to={`${report.to}${location.search}`}
                        />
                    );
                })}
            </ApplicationSidebarNavigation>
        </>
    );

    const presentation = {
        overview: {
            title: 'Charts overview',
            description:
                'See the most important reading and refresh signals at a glance.',
        },
        reading: {
            title: 'Reading activity',
            description: 'Compare feed arrivals with reads and saved entries.',
        },
        refresh: {
            title: 'Refresh health',
            description:
                'Track refresh reliability, failures, and new entries.',
        },
        backlog: {
            title: 'Backlog trends',
            description:
                'Follow unread pressure and cohort read-through over time.',
        },
    }[view];
    const scopeValue =
        state.feedId !== null
            ? `feed:${state.feedId}`
            : state.categoryId !== null
              ? `category:${state.categoryId}`
              : 'all';
    const scopeOptions = [
        { value: 'all', label: 'All subscriptions' },
        ...(subscriptions.data?.subscriptions.map((subscription) => ({
            value: `feed:${subscription.feedId}`,
            label: `Feed · ${
                subscription.customFeedName ?? subscription.feedName
            }`,
        })) ?? []),
        ...(subscriptions.data?.categories.map((category) => ({
            value: `category:${category.id}`,
            label: `Category · ${category.name}`,
        })) ?? []),
    ];
    const updateScope = (value: string | null) => {
        if (value === null || value === 'all') {
            update({ ...state, feedId: null, categoryId: null });
            return;
        }
        const [kind, rawId] = value.split(':');
        const id = Number(rawId);
        if (!Number.isSafeInteger(id)) return;
        update({
            ...state,
            feedId: kind === 'feed' ? id : null,
            categoryId: kind === 'category' ? id : null,
        });
    };

    return (
        <ApplicationPage activePage="charts" sidebar={sidebar}>
            <Stack className={classes.content} gap="md">
                <Paper
                    aria-label="Chart date range"
                    className={classes.filterTopbar}
                    component="section"
                    p={0}
                >
                    <header className={classes.topbarHeader}>
                        <Title order={1}>{presentation.title}</Title>
                    </header>
                    <Stack className={classes.filterBody} gap="sm">
                        <Group
                            className={classes.toolbarRow}
                            gap="sm"
                            wrap="wrap"
                        >
                            <SegmentedControl
                                aria-label="Date range"
                                data={[
                                    {
                                        value: '30',
                                        label: (
                                            <span>
                                                <span aria-hidden="true">
                                                    30d
                                                </span>
                                                <VisuallyHidden>
                                                    30 days
                                                </VisuallyHidden>
                                            </span>
                                        ),
                                    },
                                    {
                                        value: '90',
                                        label: (
                                            <span>
                                                <span aria-hidden="true">
                                                    90d
                                                </span>
                                                <VisuallyHidden>
                                                    90 days
                                                </VisuallyHidden>
                                            </span>
                                        ),
                                    },
                                    {
                                        value: '365',
                                        label: (
                                            <span>
                                                <span aria-hidden="true">
                                                    1y
                                                </span>
                                                <VisuallyHidden>
                                                    1 year
                                                </VisuallyHidden>
                                            </span>
                                        ),
                                    },
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
                    </Stack>
                </Paper>

                <Text className={classes.introDescription} c="dimmed">
                    {presentation.description}
                </Text>

                <Group
                    className={classes.scopeRow}
                    justify="space-between"
                    wrap="wrap"
                >
                    <Group gap="xs" wrap="nowrap">
                        <Text fw={700} size="xs">
                            Scope
                        </Text>
                        <Select
                            aria-label="Chart scope"
                            className={classes.scopeSelect}
                            data={scopeOptions}
                            disabled={subscriptions.isError}
                            nothingFoundMessage="No matching feeds or categories"
                            onChange={updateScope}
                            rightSection={
                                subscriptions.isPending ? (
                                    <Loader size="xs" />
                                ) : undefined
                            }
                            searchable
                            size="xs"
                            value={scopeValue}
                        />
                    </Group>
                    {charts.data !== undefined && (
                        <Text c="dimmed" size="xs">
                            {formatDate(charts.data.window.startDate)} →{' '}
                            {formatDate(charts.data.window.endDate)}
                        </Text>
                    )}
                </Group>

                {subscriptions.isError && (
                    <Alert color="red" title="Chart scopes unavailable">
                        <Stack align="flex-start" gap="xs">
                            <Text size="sm">{subscriptions.error.message}</Text>
                            <Button
                                onClick={() => void subscriptions.refetch()}
                                size="xs"
                                variant="light"
                            >
                                Retry
                            </Button>
                        </Stack>
                    </Alert>
                )}

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
                    <ChartsDashboard data={charts.data} view={view} />
                )}
            </Stack>
        </ApplicationPage>
    );
}

export function ChartsPage() {
    return <ChartReportWorkspace view="overview" />;
}

export function ReadingChartsPage() {
    return <ChartReportWorkspace view="reading" />;
}

export function RefreshChartsPage() {
    return <ChartReportWorkspace view="refresh" />;
}

export function BacklogChartsPage() {
    return <ChartReportWorkspace view="backlog" />;
}

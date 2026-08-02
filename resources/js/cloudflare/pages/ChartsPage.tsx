import {
    Alert,
    Badge,
    Button,
    Container,
    Group,
    Loader,
    Paper,
    SegmentedControl,
    Select,
    SimpleGrid,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { IconArrowLeft, IconChartLine, IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import type { ChartData, ChartRequest } from '../api/charts';
import {
    canonicalChartSearch,
    defaultCustomDates,
    parseChartState,
} from '../chartState';
import { chartQueryOptions } from '../queries/charts';
import { subscriptionManagementQueryOptions } from '../queries/subscriptions';
import classes from './ChartsPage.module.css';

const number = new Intl.NumberFormat();
const percent = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
});
const shortDate = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
});

interface Series {
    readonly key: keyof ChartData['days'][number];
    readonly label: string;
    readonly color: string;
}

function seriesPaths(
    days: ChartData['days'],
    key: Series['key'],
    maximum: number,
): string[] {
    const paths: string[] = [];
    let current = '';
    days.forEach((day, index) => {
        const value = day[key];
        if (typeof value !== 'number') {
            if (current.length > 0) paths.push(current);
            current = '';
            return;
        }
        const x =
            days.length === 1 ? 500 : (index / (days.length - 1)) * 980 + 10;
        const y = 230 - (value / maximum) * 210;
        current += `${current.length === 0 ? 'M' : ' L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    if (current.length > 0) paths.push(current);
    return paths;
}

function DailyChart({
    title,
    description,
    days,
    series,
}: {
    readonly title: string;
    readonly description: string;
    readonly days: ChartData['days'];
    readonly series: readonly Series[];
}) {
    const maximum = Math.max(
        1,
        ...days.flatMap((day) =>
            series.map(({ key }) => {
                const value = day[key];
                return typeof value === 'number' ? value : 0;
            }),
        ),
    );
    const start = days[0]?.date;
    const end = days.at(-1)?.date;

    return (
        <Paper component="section" withBorder p={{ base: 'md', sm: 'lg' }}>
            <Stack gap="md">
                <Stack gap={3}>
                    <Title order={2} size="h3">
                        {title}
                    </Title>
                    <Text c="dimmed" size="sm">
                        {description}
                    </Text>
                </Stack>
                <Group gap="md" role="list" wrap="wrap">
                    {series.map((item) => (
                        <Group key={item.label} gap={6} role="listitem">
                            <span
                                aria-hidden="true"
                                className={classes.legendSwatch}
                                style={{ backgroundColor: item.color }}
                            />
                            <Text size="xs">{item.label}</Text>
                        </Group>
                    ))}
                </Group>
                <div className={classes.chartFrame}>
                    <svg
                        aria-label={`${title}. ${description}`}
                        className={classes.chart}
                        preserveAspectRatio="none"
                        role="img"
                        viewBox="0 0 1000 250"
                    >
                        <title>{title}</title>
                        <desc>{description}</desc>
                        {[20, 125, 230].map((y) => (
                            <line
                                key={y}
                                className={classes.gridLine}
                                x1="10"
                                x2="990"
                                y1={y}
                                y2={y}
                            />
                        ))}
                        {series.flatMap((item) =>
                            seriesPaths(days, item.key, maximum).map(
                                (path, index) => (
                                    <path
                                        // biome-ignore lint/suspicious/noArrayIndexKey: split line segments have no domain identifier
                                        key={`${item.label}-${index}`}
                                        d={path}
                                        fill="none"
                                        stroke={item.color}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="3"
                                        vectorEffect="non-scaling-stroke"
                                    />
                                ),
                            ),
                        )}
                    </svg>
                    <Group justify="space-between">
                        <Text c="dimmed" size="xs">
                            {start === undefined
                                ? 'No days'
                                : shortDate.format(
                                      new Date(`${start}T00:00:00.000Z`),
                                  )}
                        </Text>
                        <Text c="dimmed" size="xs">
                            Peak {number.format(maximum)}
                        </Text>
                        <Text c="dimmed" size="xs">
                            {end === undefined
                                ? 'No days'
                                : shortDate.format(
                                      new Date(`${end}T00:00:00.000Z`),
                                  )}
                        </Text>
                    </Group>
                </div>
            </Stack>
        </Paper>
    );
}

function Metric({
    label,
    value,
    detail,
}: {
    readonly label: string;
    readonly value: string;
    readonly detail: string;
}) {
    return (
        <Paper withBorder p="md">
            <Stack gap={3}>
                <Text c="dimmed" fw={600} size="xs" tt="uppercase">
                    {label}
                </Text>
                <Text className={classes.metricValue} fw={700}>
                    {value}
                </Text>
                <Text c="dimmed" size="xs">
                    {detail}
                </Text>
            </Stack>
        </Paper>
    );
}

function formatRate(value: number | null): string {
    return value === null ? 'No data' : `${percent.format(value)}%`;
}

function Dashboard({ data }: { readonly data: ChartData }) {
    const recentDays = data.days.slice(-14).toReversed();
    return (
        <Stack gap="lg">
            <Group justify="space-between" align="center" wrap="wrap">
                <Stack gap={2}>
                    <Group gap="xs">
                        <Title order={2} size="h3">
                            {data.scope.name}
                        </Title>
                        <Badge variant="light">
                            {data.window.dayCount} days
                        </Badge>
                    </Group>
                    <Text c="dimmed" size="sm">
                        {data.window.startDate} to {data.window.endDate}, UTC
                    </Text>
                </Stack>
            </Group>

            <SimpleGrid cols={{ base: 2, md: 4 }}>
                <Metric
                    label="Received"
                    value={number.format(data.summary.received)}
                    detail="Entries received in this window"
                />
                <Metric
                    label="Read-through"
                    value={formatRate(data.summary.cohortReadThroughRate)}
                    detail={`${number.format(data.summary.currentlyRead)} now read from this cohort`}
                />
                <Metric
                    label="Unread now"
                    value={number.format(data.summary.currentUnread)}
                    detail="All current unread entries in this scope"
                />
                <Metric
                    label="Refresh health"
                    value={formatRate(data.summary.refreshSuccessRate)}
                    detail={`${number.format(data.summary.refreshSuccesses)} of ${number.format(data.summary.refreshAttempts)} attempts succeeded`}
                />
            </SimpleGrid>

            <DailyChart
                title="Entry cohort state"
                description="Entries are grouped by the day Larafeed received them. Read and saved lines show their current state, not historical actions."
                days={data.days}
                series={[
                    {
                        key: 'received',
                        label: 'Received',
                        color: 'var(--mantine-color-blue-6)',
                    },
                    {
                        key: 'currentlyRead',
                        label: 'Currently read',
                        color: 'var(--mantine-color-green-6)',
                    },
                    {
                        key: 'currentlySaved',
                        label: 'Currently saved',
                        color: 'var(--mantine-color-yellow-7)',
                    },
                ]}
            />

            <DailyChart
                title="Reader activity"
                description="Actual state transitions made in Larafeed. Missing periods are not presented as zero activity."
                days={data.days}
                series={[
                    {
                        key: 'markedRead',
                        label: 'Marked read',
                        color: 'var(--mantine-color-green-6)',
                    },
                    {
                        key: 'markedUnread',
                        label: 'Marked unread',
                        color: 'var(--mantine-color-orange-6)',
                    },
                    {
                        key: 'saved',
                        label: 'Saved',
                        color: 'var(--mantine-color-yellow-7)',
                    },
                    {
                        key: 'unsaved',
                        label: 'Unsaved',
                        color: 'var(--mantine-color-gray-6)',
                    },
                ]}
            />
            <Alert color="blue" variant="light">
                {data.activityCoverageStart === null
                    ? 'Reader activity tracking starts after this chart window. Cohort and refresh data remain available.'
                    : `Reader activity tracking is complete from ${data.activityCoverageStart}. Earlier days are shown as unavailable.`}
            </Alert>

            <DailyChart
                title="Feed refreshes"
                description="Successful and failed refresh attempts, plus entries created by successful refreshes."
                days={data.days}
                series={[
                    {
                        key: 'refreshSuccesses',
                        label: 'Successful attempts',
                        color: 'var(--mantine-color-green-6)',
                    },
                    {
                        key: 'refreshFailures',
                        label: 'Failed attempts',
                        color: 'var(--mantine-color-red-6)',
                    },
                    {
                        key: 'refreshEntriesCreated',
                        label: 'Entries created',
                        color: 'var(--mantine-color-blue-6)',
                    },
                ]}
            />

            <Paper component="section" withBorder p={{ base: 'md', sm: 'lg' }}>
                <Stack gap="md">
                    <Stack gap={3}>
                        <Title order={2} size="h3">
                            Recent daily detail
                        </Title>
                        <Text c="dimmed" size="sm">
                            The latest 14 UTC days in the selected window.
                        </Text>
                    </Stack>
                    <Table.ScrollContainer minWidth={760}>
                        <Table striped withRowBorders={false}>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Date</Table.Th>
                                    <Table.Th ta="right">Received</Table.Th>
                                    <Table.Th ta="right">Now read</Table.Th>
                                    <Table.Th ta="right">Marked read</Table.Th>
                                    <Table.Th ta="right">Saved</Table.Th>
                                    <Table.Th ta="right">Refreshes</Table.Th>
                                    <Table.Th ta="right">Failures</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {recentDays.map((day) => (
                                    <Table.Tr key={day.date}>
                                        <Table.Td>{day.date}</Table.Td>
                                        <Table.Td ta="right">
                                            {number.format(day.received)}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {number.format(day.currentlyRead)}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {day.markedRead === null
                                                ? '—'
                                                : number.format(day.markedRead)}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {day.saved === null
                                                ? '—'
                                                : number.format(day.saved)}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {number.format(
                                                day.refreshSuccesses,
                                            )}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {number.format(day.refreshFailures)}
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                </Stack>
            </Paper>
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
    const scopeValue =
        state.feedId !== null
            ? `feed:${state.feedId}`
            : state.categoryId !== null
              ? `category:${state.categoryId}`
              : 'all';
    const scopeOptions = [
        { value: 'all', label: 'All subscriptions' },
        ...(subscriptions.data?.categories.map((category) => ({
            value: `category:${category.id}`,
            label: `Category: ${category.name}`,
        })) ?? []),
        ...(subscriptions.data?.subscriptions.map((subscription) => ({
            value: `feed:${subscription.feedId}`,
            label: `Feed: ${subscription.customFeedName ?? subscription.feedName}`,
        })) ?? []),
    ];
    const applyDates = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        update({ ...state, range: 'custom', startDate, endDate });
    };

    return (
        <Container component="main" size="xl" py={{ base: 'lg', sm: 'xl' }}>
            <Stack gap="xl">
                <Group justify="space-between" align="flex-start" wrap="wrap">
                    <Stack gap="xs">
                        <Button
                            component={Link}
                            leftSection={
                                <IconArrowLeft aria-hidden="true" size={16} />
                            }
                            size="compact-sm"
                            to="/feeds"
                            variant="subtle"
                        >
                            Back to reader
                        </Button>
                        <Group gap="sm">
                            <IconChartLine aria-hidden="true" size={30} />
                            <Title order={1}>Charts</Title>
                        </Group>
                        <Text c="dimmed">
                            Current reader state, actual actions, and feed
                            refresh health.
                        </Text>
                    </Stack>
                    {charts.isFetching && charts.data !== undefined && (
                        <Loader aria-label="Refreshing charts" size="sm" />
                    )}
                </Group>

                <Paper
                    component="section"
                    aria-label="Chart filters"
                    withBorder
                    p={{ base: 'md', sm: 'lg' }}
                >
                    <Stack gap="md">
                        <SegmentedControl
                            aria-label="Chart date range"
                            data={[
                                { label: '30 days', value: '30' },
                                { label: '90 days', value: '90' },
                                { label: '1 year', value: '365' },
                                { label: 'Custom', value: 'custom' },
                            ]}
                            fullWidth
                            onChange={(value) => {
                                const range = value as ChartRequest['range'];
                                const custom = defaultCustomDates(Date.now());
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
                        <Select
                            allowDeselect={false}
                            data={scopeOptions}
                            disabled={subscriptions.isPending}
                            label="Subscription scope"
                            onChange={(value) => {
                                if (value === null) return;
                                const [type, rawId] = value.split(':');
                                const id = Number(rawId);
                                update({
                                    ...state,
                                    feedId: type === 'feed' ? id : null,
                                    categoryId: type === 'category' ? id : null,
                                });
                            }}
                            searchable
                            value={scopeValue}
                        />
                        {state.range === 'custom' && (
                            <form onSubmit={applyDates}>
                                <Group align="flex-end" wrap="wrap">
                                    <TextInput
                                        label="Start date"
                                        max={endDate}
                                        onChange={(event) =>
                                            setStartDate(
                                                event.currentTarget.value,
                                            )
                                        }
                                        required
                                        type="date"
                                        value={startDate}
                                    />
                                    <TextInput
                                        label="End date"
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
                                        required
                                        type="date"
                                        value={endDate}
                                    />
                                    <Button type="submit">Apply dates</Button>
                                </Group>
                            </form>
                        )}
                    </Stack>
                </Paper>

                {charts.isPending && (
                    <Stack gap="lg" aria-label="Loading charts">
                        <SimpleGrid cols={{ base: 2, md: 4 }}>
                            {['one', 'two', 'three', 'four'].map((key) => (
                                <Skeleton key={key} height={112} />
                            ))}
                        </SimpleGrid>
                        <Skeleton height={340} />
                        <Skeleton height={340} />
                    </Stack>
                )}
                {charts.isError && (
                    <Alert color="red" role="alert" title="Charts unavailable">
                        <Stack gap="sm" align="flex-start">
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
                {charts.data !== undefined && <Dashboard data={charts.data} />}
            </Stack>
        </Container>
    );
}

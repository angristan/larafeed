import classes from './Import.module.css';

import UserButton from '../Components/UserButton/UserButton';
import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PageProps, User } from '@/types';
import { router, usePage } from '@inertiajs/react';
import { Heatmap, LineChart } from '@mantine/charts';
import {
    AppShell,
    Burger,
    Button,
    Card,
    Code,
    Group,
    SegmentedControl,
    Select,
    SimpleGrid,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { ReactNode, useMemo, useState } from 'react';

type HeatmapSeries = Record<string, number>;

const transformDataForHeatmap = <Key extends string>(
    data: Array<{ date: string } & Record<Key, number>>,
    key: Key,
): HeatmapSeries => {
    const result: HeatmapSeries = {};

    data.forEach((item) => {
        result[item.date] = item[key];
    });

    return result;
};

const formatDate = (date: string) =>
    new Date(date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

const SummaryCard = ({
    label,
    value,
    description,
}: {
    label: string;
    value: string;
    description?: string;
}) => (
    <Card padding="lg" radius="md" withBorder>
        <Stack gap={2}>
            <Text c="dimmed" size="sm" fw={500}>
                {label}
            </Text>
            <Title order={3}>{value}</Title>
            {description && (
                <Text size="sm" c="dimmed">
                    {description}
                </Text>
            )}
        </Stack>
    </Card>
);

interface DailyReads {
    date: string;
    reads: number;
}

interface DailyEntries {
    date: string;
    entries: number;
}

interface DailySaved {
    date: string;
    saved: number;
}

interface MetricPoint {
    date: string;
    value: number;
}

interface RatePoint {
    date: string;
    value: number | null;
}

interface SummaryMetrics {
    totalEntries: number;
    totalReads: number;
    totalSaved: number;
    readThroughRate: number;
    currentBacklog: number;
}

type RangeFilter = '30' | '90' | '365' | 'custom';
type GroupFilter = 'all' | 'feed' | 'category';

interface Filters {
    range: RangeFilter;
    group: GroupFilter;
    feedId: number | null;
    categoryId: number | null;
    startDate: string;
    endDate: string;
}

interface SelectEntity {
    id: number;
    name: string;
}

type ChartsPageProps = PageProps<{
    dailyReads: DailyReads[];
    dailyEntries: DailyEntries[];
    dailySaved: DailySaved[];
    backlogTrend: MetricPoint[];
    readThrough: RatePoint[];
    summary: SummaryMetrics;
    filters: Filters;
    feeds: SelectEntity[];
    categories: SelectEntity[];
}>;

interface MainProps {
    dailyReads: DailyReads[];
    dailyEntries: DailyEntries[];
    dailySaved: DailySaved[];
    backlogTrend: MetricPoint[];
    readThrough: RatePoint[];
    summary: SummaryMetrics;
    filters: Filters;
    feeds: SelectEntity[];
    categories: SelectEntity[];
}

const Main = function Main({
    dailyReads,
    dailyEntries,
    dailySaved,
    backlogTrend,
    readThrough,
    summary,
    filters,
    feeds,
    categories,
}: MainProps) {
    const [localFilters, setLocalFilters] = useState<Filters>(() => filters);
    const [customRangeDraft, setCustomRangeDraft] = useState(() => ({
        startDate: filters.startDate,
        endDate: filters.endDate,
    }));

    const feedOptions = useMemo(
        () =>
            feeds.map((feed) => ({
                value: feed.id.toString(),
                label: feed.name,
            })),
        [feeds],
    );

    const categoryOptions = useMemo(
        () =>
            categories.map((category) => ({
                value: category.id.toString(),
                label: category.name,
            })),
        [categories],
    );

    const readsHeatmapData = useMemo(
        () => transformDataForHeatmap(dailyReads, 'reads'),
        [dailyReads],
    );
    const entriesHeatmapData = useMemo(
        () => transformDataForHeatmap(dailyEntries, 'entries'),
        [dailyEntries],
    );
    const savedHeatmapData = useMemo(
        () => transformDataForHeatmap(dailySaved, 'saved'),
        [dailySaved],
    );

    const backlogChartData = useMemo(
        () =>
            backlogTrend.map((point) => ({
                date: point.date,
                backlog: point.value,
            })),
        [backlogTrend],
    );

    const readThroughChartData = useMemo(
        () =>
            readThrough.map((point) => ({
                date: point.date,
                rate: point.value,
            })),
        [readThrough],
    );

    const submitFilters = (
        next: Filters,
        { skipRequest = false }: { skipRequest?: boolean } = {},
    ) => {
        setLocalFilters(next);

        if (skipRequest) {
            return;
        }

        const params: Record<string, string> = {
            range: next.range,
            group: next.group,
        };

        if (next.feedId !== null) {
            params.feedId = next.feedId.toString();
        }

        if (next.categoryId !== null) {
            params.categoryId = next.categoryId.toString();
        }

        if (next.range === 'custom') {
            params.startDate = next.startDate;
            params.endDate = next.endDate;
        }

        router.get(route('charts.index'), params, {
            preserveScroll: true,
            preserveState: true,
        });
    };

    const handleRangeChange = (value: RangeFilter) => {
        if (value === 'custom') {
            submitFilters(
                {
                    ...localFilters,
                    range: value,
                },
                { skipRequest: true },
            );
            return;
        }

        submitFilters({
            ...localFilters,
            range: value,
            startDate: filters.startDate,
            endDate: filters.endDate,
        });
    };

    const handleGroupChange = (value: GroupFilter) => {
        if (value === 'feed') {
            const fallback = localFilters.feedId ?? feeds[0]?.id ?? null;
            submitFilters(
                {
                    ...localFilters,
                    group: value,
                    feedId: fallback,
                    categoryId: null,
                },
                { skipRequest: fallback === null },
            );
            return;
        }

        if (value === 'category') {
            const fallback =
                localFilters.categoryId ?? categories[0]?.id ?? null;
            submitFilters(
                {
                    ...localFilters,
                    group: value,
                    categoryId: fallback,
                    feedId: null,
                },
                { skipRequest: fallback === null },
            );
            return;
        }

        submitFilters({
            ...localFilters,
            group: 'all',
            feedId: null,
            categoryId: null,
        });
    };

    const applyCustomRange = () => {
        if (!customRangeDraft.startDate || !customRangeDraft.endDate) {
            return;
        }

        const start = new Date(customRangeDraft.startDate);
        const end = new Date(customRangeDraft.endDate);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return;
        }

        if (start > end) {
            return;
        }

        submitFilters({
            ...localFilters,
            range: 'custom',
            startDate: customRangeDraft.startDate,
            endDate: customRangeDraft.endDate,
        });
    };

    const handleFeedChange = (value: string | null) => {
        const nextFeedId = value ? Number.parseInt(value, 10) : null;
        submitFilters(
            {
                ...localFilters,
                group: 'feed',
                feedId: nextFeedId,
                categoryId: null,
            },
            { skipRequest: nextFeedId === null },
        );
    };

    const handleCategoryChange = (value: string | null) => {
        const nextCategoryId = value ? Number.parseInt(value, 10) : null;
        submitFilters(
            {
                ...localFilters,
                group: 'category',
                categoryId: nextCategoryId,
                feedId: null,
            },
            { skipRequest: nextCategoryId === null },
        );
    };

    const dateRangeLabel =
        filters.startDate === filters.endDate
            ? formatDate(filters.startDate)
            : `${formatDate(filters.startDate)} → ${formatDate(filters.endDate)}`;

    return (
        <AppShell.Main>
            <Stack gap="xl">
                <Stack gap="md">
                    <Title order={2}>Filters</Title>
                    <Stack gap="sm">
                        <Group gap="sm" wrap="wrap">
                            <SegmentedControl
                                value={localFilters.range}
                                onChange={(value) =>
                                    handleRangeChange(value as RangeFilter)
                                }
                                data={[
                                    { value: '30', label: '30 days' },
                                    { value: '90', label: '90 days' },
                                    { value: '365', label: '365 days' },
                                    { value: 'custom', label: 'Custom' },
                                ]}
                            />
                            {localFilters.range === 'custom' && (
                                <Group gap="xs" wrap="wrap">
                                    <TextInput
                                        label="Start"
                                        size="sm"
                                        type="date"
                                        value={customRangeDraft.startDate}
                                        onChange={(event) =>
                                            setCustomRangeDraft((current) => ({
                                                ...current,
                                                startDate:
                                                    event.currentTarget.value,
                                            }))
                                        }
                                    />
                                    <TextInput
                                        label="End"
                                        size="sm"
                                        type="date"
                                        value={customRangeDraft.endDate}
                                        onChange={(event) =>
                                            setCustomRangeDraft((current) => ({
                                                ...current,
                                                endDate:
                                                    event.currentTarget.value,
                                            }))
                                        }
                                    />
                                    <Button
                                        size="sm"
                                        onClick={applyCustomRange}
                                    >
                                        Apply
                                    </Button>
                                </Group>
                            )}
                        </Group>

                        <Group gap="sm" wrap="wrap">
                            <SegmentedControl
                                value={localFilters.group}
                                onChange={(value) =>
                                    handleGroupChange(value as GroupFilter)
                                }
                                data={[
                                    {
                                        value: 'all',
                                        label: 'All subscriptions',
                                    },
                                    { value: 'feed', label: 'By feed' },
                                    { value: 'category', label: 'By category' },
                                ]}
                            />
                            {localFilters.group === 'feed' && (
                                <Select
                                    placeholder="Select feed"
                                    data={feedOptions}
                                    value={
                                        localFilters.feedId !== null
                                            ? localFilters.feedId.toString()
                                            : null
                                    }
                                    onChange={handleFeedChange}
                                    searchable
                                    nothingFoundMessage="No feeds"
                                />
                            )}
                            {localFilters.group === 'category' && (
                                <Select
                                    placeholder="Select category"
                                    data={categoryOptions}
                                    value={
                                        localFilters.categoryId !== null
                                            ? localFilters.categoryId.toString()
                                            : null
                                    }
                                    onChange={handleCategoryChange}
                                    searchable
                                    nothingFoundMessage="No categories"
                                />
                            )}
                        </Group>

                        <Text size="sm" c="dimmed">
                            Showing data from {dateRangeLabel}.
                        </Text>
                    </Stack>
                </Stack>

                <Stack gap="md">
                    <Title order={2}>Key Metrics</Title>
                    <SimpleGrid
                        cols={{ base: 1, sm: 2, md: 3, lg: 5 }}
                        spacing="lg"
                    >
                        <SummaryCard
                            label="Entries received"
                            value={summary.totalEntries.toLocaleString()}
                        />
                        <SummaryCard
                            label="Entries read"
                            value={summary.totalReads.toLocaleString()}
                            description={`${summary.readThroughRate.toFixed(1)}% read-through`}
                        />
                        <SummaryCard
                            label="Entries saved"
                            value={summary.totalSaved.toLocaleString()}
                        />
                        <SummaryCard
                            label="Current backlog"
                            value={summary.currentBacklog.toLocaleString()}
                        />
                        <SummaryCard
                            label="Date range"
                            value={dateRangeLabel}
                        />
                    </SimpleGrid>
                </Stack>

                <Stack gap="xl">
                    <Stack gap="sm">
                        <Title order={2}>Daily Reads Activity</Title>
                        <Heatmap
                            data={readsHeatmapData}
                            startDate={filters.startDate}
                            endDate={filters.endDate}
                            withTooltip
                            withMonthLabels
                            withWeekdayLabels
                            getTooltipLabel={({ date, value }) =>
                                `${formatDate(date)} – ${
                                    value === null || value === 0
                                        ? 'No reads'
                                        : `${value} read${value > 1 ? 's' : ''}`
                                }`
                            }
                            colors={[
                                'var(--mantine-color-blue-1)',
                                'var(--mantine-color-blue-4)',
                                'var(--mantine-color-blue-6)',
                                'var(--mantine-color-blue-8)',
                            ]}
                        />
                    </Stack>

                    <Stack gap="sm">
                        <Title order={2}>Daily Subscription Entries</Title>
                        <Heatmap
                            data={entriesHeatmapData}
                            startDate={filters.startDate}
                            endDate={filters.endDate}
                            withTooltip
                            withMonthLabels
                            withWeekdayLabels
                            getTooltipLabel={({ date, value }) =>
                                `${formatDate(date)} – ${
                                    value === null || value === 0
                                        ? 'No entries'
                                        : `${value} entr${value > 1 ? 'ies' : 'y'}`
                                }`
                            }
                            colors={[
                                'var(--mantine-color-green-1)',
                                'var(--mantine-color-green-4)',
                                'var(--mantine-color-green-6)',
                                'var(--mantine-color-green-8)',
                            ]}
                        />
                    </Stack>

                    <Stack gap="sm">
                        <Title order={2}>Daily Saved Entries</Title>
                        <Heatmap
                            data={savedHeatmapData}
                            startDate={filters.startDate}
                            endDate={filters.endDate}
                            withTooltip
                            withMonthLabels
                            withWeekdayLabels
                            getTooltipLabel={({ date, value }) =>
                                `${formatDate(date)} – ${
                                    value === null || value === 0
                                        ? 'No saves'
                                        : `${value} save${value > 1 ? 's' : ''}`
                                }`
                            }
                            colors={[
                                'var(--mantine-color-yellow-1)',
                                'var(--mantine-color-yellow-4)',
                                'var(--mantine-color-yellow-6)',
                                'var(--mantine-color-yellow-8)',
                            ]}
                        />
                    </Stack>

                    <Stack gap="sm">
                        <Title order={2}>Unread Backlog Trend</Title>
                        <LineChart
                            h={300}
                            data={backlogChartData}
                            dataKey="date"
                            series={[
                                {
                                    name: 'backlog',
                                    label: 'Unread backlog',
                                    color: 'orange.6',
                                },
                            ]}
                            withLegend
                            valueFormatter={(value) =>
                                Number.isFinite(value)
                                    ? Number(value).toLocaleString()
                                    : '–'
                            }
                            xAxisLabel="Date"
                            yAxisLabel="Entries"
                        />
                    </Stack>

                    <Stack gap="sm">
                        <Title order={2}>Daily Read-through Rate</Title>
                        <LineChart
                            h={300}
                            data={readThroughChartData}
                            dataKey="date"
                            series={[
                                {
                                    name: 'rate',
                                    label: 'Read-through %',
                                    color: 'indigo.6',
                                },
                            ]}
                            withLegend
                            unit="%"
                            valueFormatter={(value) =>
                                Number.isFinite(value)
                                    ? `${Number(value).toFixed(1)}%`
                                    : '–'
                            }
                            xAxisLabel="Date"
                            yAxisLabel="%"
                            connectNulls={false}
                        />
                    </Stack>
                </Stack>
            </Stack>
        </AppShell.Main>
    );
};

const NavBar = function Navbar({ user }: { user: User }) {
    return (
        <AppShell.Navbar>
            <AppShell.Section pr="md" pl="md" pt="md">
                <TextInput
                    placeholder="Search"
                    size="xs"
                    leftSection={<IconSearch size={12} stroke={1.5} />}
                    rightSectionWidth={70}
                    rightSection={
                        <Code className={classes.searchCode}>Ctrl + K</Code>
                    }
                    styles={{ section: { pointerEvents: 'none' } }}
                    mb="sm"
                />
            </AppShell.Section>

            <AppShell.Section>
                <UserButton user={user} />
            </AppShell.Section>
        </AppShell.Navbar>
    );
};

const Charts = () => {
    const { props } = usePage<ChartsPageProps>();
    const {
        auth,
        dailyReads,
        dailyEntries,
        dailySaved,
        backlogTrend,
        readThrough,
        summary,
        filters,
        feeds,
        categories,
    } = props;

    const [opened, { toggle }] = useDisclosure();
    const filtersKey = [
        filters.range,
        filters.group,
        filters.feedId ?? 'null',
        filters.categoryId ?? 'null',
        filters.startDate,
        filters.endDate,
    ].join('|');

    return (
        <AppShell
            header={{ height: 60 }}
            navbar={{
                width: 300,
                breakpoint: 'sm',
                collapsed: { mobile: !opened },
            }}
            padding="md"
        >
            <AppShell.Header>
                <Group h="100%" px="md">
                    <Burger
                        opened={opened}
                        onClick={toggle}
                        hiddenFrom="sm"
                        size="sm"
                    />
                    <ApplicationLogo width={50} />
                    <Title order={3} style={{ margin: 0 }}>
                        Larafeed
                    </Title>
                </Group>
            </AppShell.Header>

            <NavBar user={auth.user} />

            <Main
                key={filtersKey}
                dailyReads={dailyReads}
                dailyEntries={dailyEntries}
                dailySaved={dailySaved}
                backlogTrend={backlogTrend}
                readThrough={readThrough}
                summary={summary}
                filters={filters}
                feeds={feeds}
                categories={categories}
            />
        </AppShell>
    );
};

Charts.layout = (page: ReactNode) => (
    <AuthenticatedLayout pageTitle="Charts">{page}</AuthenticatedLayout>
);

export default Charts;

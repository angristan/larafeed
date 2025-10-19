import AppShellLayout from '@/Layouts/AppShellLayout/AppShellLayout';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PageProps } from '@/types';
import { router } from '@inertiajs/react';
import {
    ActionIcon,
    Anchor,
    AppShell,
    Avatar,
    Badge,
    Button,
    Divider,
    Drawer,
    Group,
    ScrollArea,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
    Tooltip,
} from '@mantine/core';
import {
    IconArrowNarrowDown,
    IconArrowNarrowUp,
    IconRefresh,
    IconSearch,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ReactNode, useMemo, useState } from 'react';

dayjs.extend(relativeTime);

type FeedRefreshDto = {
    id: number;
    refreshed_at: string | null;
    was_successful: boolean;
    entries_created: number;
    error_message: string | null;
};

type SubscriptionCategoryDto = {
    id: number;
    name: string;
};

type SubscriptionFeedDto = {
    id: number;
    name: string;
    original_name: string;
    feed_url: string;
    site_url: string;
    favicon_url: string | null;
    entries_count: number;
    last_successful_refresh_at: string | null;
    last_failed_refresh_at: string | null;
    last_error_message: string | null;
    category: SubscriptionCategoryDto | null;
    refreshes: FeedRefreshDto[];
};

type SubscriptionsPageProps = PageProps<{
    feeds: SubscriptionFeedDto[];
    categories: SubscriptionCategoryDto[];
}>;

const statusLabel = {
    success: 'Success',
    failed: 'Failed',
    never: 'Never refreshed',
} as const;

type StatusKey = keyof typeof statusLabel;

const statusColor: Record<StatusKey, string> = {
    success: 'green',
    failed: 'red',
    never: 'gray',
};

const formatRelative = (value: string | null): string => {
    if (!value) {
        return 'Never';
    }

    return dayjs(value).fromNow();
};

const formatAbsolute = (value: string | null): string => {
    if (!value) {
        return '—';
    }

    return dayjs(value).format('YYYY-MM-DD HH:mm');
};

const getLatestRefresh = (feed: SubscriptionFeedDto): FeedRefreshDto | null =>
    feed.refreshes[0] ?? null;

const getStatus = (feed: SubscriptionFeedDto): StatusKey => {
    const latest = getLatestRefresh(feed);

    if (!latest) {
        return 'never';
    }

    return latest.was_successful ? 'success' : 'failed';
};

const Subscriptions = ({ feeds, categories }: SubscriptionsPageProps) => {
    const [searchValue, setSearchValue] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string | null>('all');
    const [statusFilter, setStatusFilter] = useState<StatusKey | 'all'>('all');
    const [sortField, setSortField] = useState<
        'name' | 'entries' | 'lastSuccess' | 'lastFailure'
    >('name');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [selectedFeed, setSelectedFeed] =
        useState<SubscriptionFeedDto | null>(null);
    const [refreshingFeedId, setRefreshingFeedId] = useState<number | null>(
        null,
    );

    const categoryOptions = useMemo(
        () => [
            { label: 'All categories', value: 'all' },
            ...categories.map((category) => ({
                label: category.name,
                value: String(category.id),
            })),
        ],
        [categories],
    );

    const feedStats = useMemo(() => {
        const withErrors = feeds.filter(
            (feed) => getStatus(feed) === 'failed',
        ).length;
        const neverRefreshed = feeds.filter(
            (feed) => getStatus(feed) === 'never',
        ).length;

        return {
            total: feeds.length,
            withErrors,
            neverRefreshed,
        };
    }, [feeds]);

    const filteredFeeds = useMemo<SubscriptionFeedDto[]>(() => {
        const normalizedSearch = searchValue.trim().toLowerCase();

        const matchesSearch = (feed: SubscriptionFeedDto) => {
            if (!normalizedSearch) {
                return true;
            }

            return (
                feed.name.toLowerCase().includes(normalizedSearch) ||
                feed.original_name.toLowerCase().includes(normalizedSearch) ||
                feed.site_url.toLowerCase().includes(normalizedSearch) ||
                feed.feed_url.toLowerCase().includes(normalizedSearch)
            );
        };

        const matchesCategory = (feed: SubscriptionFeedDto) => {
            if (!categoryFilter || categoryFilter === 'all') {
                return true;
            }

            return String(feed.category?.id ?? '') === categoryFilter;
        };

        const matchesStatus = (feed: SubscriptionFeedDto) => {
            if (statusFilter === 'all') {
                return true;
            }

            return getStatus(feed) === statusFilter;
        };

        const sorter = (a: SubscriptionFeedDto, b: SubscriptionFeedDto) => {
            const direction = sortDirection === 'asc' ? 1 : -1;

            if (sortField === 'name') {
                return direction * a.name.localeCompare(b.name);
            }

            if (sortField === 'entries') {
                return direction * (a.entries_count - b.entries_count);
            }

            if (sortField === 'lastSuccess') {
                const aValue = a.last_successful_refresh_at
                    ? dayjs(a.last_successful_refresh_at).valueOf()
                    : 0;
                const bValue = b.last_successful_refresh_at
                    ? dayjs(b.last_successful_refresh_at).valueOf()
                    : 0;

                return direction * (aValue - bValue);
            }

            const aValue = a.last_failed_refresh_at
                ? dayjs(a.last_failed_refresh_at).valueOf()
                : 0;
            const bValue = b.last_failed_refresh_at
                ? dayjs(b.last_failed_refresh_at).valueOf()
                : 0;

            return direction * (aValue - bValue);
        };

        return feeds
            .filter(
                (feed) =>
                    matchesSearch(feed) &&
                    matchesCategory(feed) &&
                    matchesStatus(feed),
            )
            .slice()
            .sort(sorter);
    }, [
        feeds,
        searchValue,
        categoryFilter,
        statusFilter,
        sortField,
        sortDirection,
    ]);

    const sortOptions = useMemo(
        () => [
            { label: 'Name', value: 'name' },
            { label: 'Entries count', value: 'entries' },
            { label: 'Last success', value: 'lastSuccess' },
            { label: 'Last failure', value: 'lastFailure' },
        ],
        [],
    );

    const statusOptions = useMemo(
        () => [
            { label: 'All statuses', value: 'all' },
            { label: statusLabel.success, value: 'success' },
            { label: statusLabel.failed, value: 'failed' },
            { label: statusLabel.never, value: 'never' },
        ],
        [],
    );

    const toggleSortDirection = () => {
        setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    };

    const handleSortFieldChange = (value: string | null) => {
        if (!value) {
            return;
        }

        setSortField(value as typeof sortField);

        setSortDirection((current) => {
            if (value === sortField) {
                return current;
            }

            if (value === 'name') {
                return 'asc';
            }

            return 'desc';
        });
    };

    const openDrawer = (feed: SubscriptionFeedDto) => {
        setSelectedFeed(feed);
    };

    const closeDrawer = () => {
        setSelectedFeed(null);
    };

    const renderTimestampCell = (value: string | null) => (
        <Tooltip label={formatAbsolute(value)} position="top" withArrow>
            <Text size="sm">{formatRelative(value)}</Text>
        </Tooltip>
    );

    const renderStatusBadge = (feed: SubscriptionFeedDto) => {
        const status = getStatus(feed);

        return (
            <Badge color={statusColor[status]} variant="light" radius="sm">
                {statusLabel[status]}
            </Badge>
        );
    };

    const renderSortIndicator = (field: typeof sortField) => {
        if (sortField !== field) {
            return null;
        }

        return sortDirection === 'asc' ? (
            <IconArrowNarrowUp size={14} />
        ) : (
            <IconArrowNarrowDown size={14} />
        );
    };

    const resetFilters = () => {
        setSearchValue('');
        setCategoryFilter('all');
        setStatusFilter('all');
        setSortField('name');
        setSortDirection('asc');
    };

    const refreshFeed = (feed: SubscriptionFeedDto) => {
        setRefreshingFeedId(feed.id);

        router.post(
            route('feed.refresh', { feed_id: feed.id }),
            {},
            {
                preserveScroll: true,
                onFinish: () => setRefreshingFeedId(null),
            },
        );
    };

    const filtersSidebar = (
        <AppShell.Navbar p="md">
            <ScrollArea style={{ height: 'calc(100vh - 96px)' }} type="auto">
                <Stack gap="lg">
                    <Stack gap={4}>
                        <Title order={4}>Search &amp; Filter</Title>
                        <Text size="sm" c="dimmed">
                            Refine the subscriptions table in real time.
                        </Text>
                    </Stack>

                    <Stack gap="sm">
                        <TextInput
                            label="Search"
                            placeholder="Name or URL"
                            leftSection={<IconSearch size={16} />}
                            value={searchValue}
                            onChange={(event) =>
                                setSearchValue(event.currentTarget.value)
                            }
                        />

                        <Select
                            label="Category"
                            value={categoryFilter}
                            onChange={setCategoryFilter}
                            data={categoryOptions}
                        />

                        <Select
                            label="Status"
                            value={statusFilter}
                            onChange={(value) =>
                                setStatusFilter(
                                    (value ?? 'all') as StatusKey | 'all',
                                )
                            }
                            data={statusOptions}
                        />
                    </Stack>

                    <Divider label="Sorting" labelPosition="center" />

                    <Stack gap="sm">
                        <Group align="flex-end" gap="xs">
                            <Select
                                label="Sort by"
                                style={{ flex: 1 }}
                                value={sortField}
                                onChange={handleSortFieldChange}
                                data={sortOptions}
                            />

                            <Tooltip
                                label={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
                                withArrow
                            >
                                <ActionIcon
                                    aria-label="Toggle sort direction"
                                    variant="light"
                                    onClick={toggleSortDirection}
                                    size="lg"
                                >
                                    {sortDirection === 'asc' ? (
                                        <IconArrowNarrowUp size={18} />
                                    ) : (
                                        <IconArrowNarrowDown size={18} />
                                    )}
                                </ActionIcon>
                            </Tooltip>
                        </Group>
                    </Stack>

                    <Divider />

                    <Button variant="light" color="gray" onClick={resetFilters}>
                        Reset filters
                    </Button>
                </Stack>
            </ScrollArea>
        </AppShell.Navbar>
    );

    return (
        <AppShellLayout
            activePage="subscriptions"
            sidebar={filtersSidebar}
            navbarWidth={320}
        >
            <AppShell.Main>
                <Stack gap="lg" px="md" py="md">
                    <Stack gap={4}>
                        <Title order={1}>Subscriptions</Title>
                        <Text size="sm" c="dimmed">
                            Search, filter, and audit refresh activity across
                            all of your feeds.
                        </Text>
                    </Stack>

                    <Group gap="sm" wrap="wrap">
                        <Badge color="blue" variant="light">
                            Total: {feedStats.total}
                        </Badge>
                        <Badge color="red" variant="light">
                            With errors: {feedStats.withErrors}
                        </Badge>
                        <Badge color="gray" variant="light">
                            Never refreshed: {feedStats.neverRefreshed}
                        </Badge>
                    </Group>

                    <Table.ScrollContainer minWidth={900}>
                        <Table
                            verticalSpacing="sm"
                            highlightOnHover
                            withRowBorders
                        >
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th
                                        style={{ width: '32%', minWidth: 280 }}
                                    >
                                        <Group gap={4} align="center">
                                            Name
                                            {renderSortIndicator('name')}
                                        </Group>
                                    </Table.Th>
                                    <Table.Th>Category</Table.Th>
                                    <Table.Th ta="right">
                                        <Group
                                            gap={4}
                                            align="center"
                                            justify="flex-end"
                                        >
                                            Entries
                                            {renderSortIndicator('entries')}
                                        </Group>
                                    </Table.Th>
                                    <Table.Th>Status</Table.Th>
                                    <Table.Th>
                                        <Group gap={4} align="center">
                                            Last success
                                            {renderSortIndicator('lastSuccess')}
                                        </Group>
                                    </Table.Th>
                                    <Table.Th>
                                        <Group gap={4} align="center">
                                            Last failure
                                            {renderSortIndicator('lastFailure')}
                                        </Group>
                                    </Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {filteredFeeds.length === 0 && (
                                    <Table.Tr>
                                        <Table.Td colSpan={6}>
                                            <Text
                                                size="sm"
                                                c="dimmed"
                                                ta="center"
                                            >
                                                No subscriptions match the
                                                current filters.
                                            </Text>
                                        </Table.Td>
                                    </Table.Tr>
                                )}

                                {filteredFeeds.map(
                                    (feed: SubscriptionFeedDto) => {
                                        const avatarFallback = feed.name
                                            ? feed.name.charAt(0).toUpperCase()
                                            : 'F';
                                        const isSelected =
                                            selectedFeed?.id === feed.id;

                                        return (
                                            <Table.Tr
                                                key={feed.id}
                                                onClick={() => openDrawer(feed)}
                                                onKeyDown={(event) => {
                                                    if (
                                                        event.key === 'Enter' ||
                                                        event.key === ' '
                                                    ) {
                                                        event.preventDefault();
                                                        openDrawer(feed);
                                                    }
                                                }}
                                                role="button"
                                                tabIndex={0}
                                                aria-label={`View details for ${feed.name}`}
                                                aria-expanded={isSelected}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <Table.Td
                                                    style={{
                                                        width: '32%',
                                                        minWidth: 280,
                                                    }}
                                                >
                                                    <Group
                                                        gap="sm"
                                                        wrap="nowrap"
                                                    >
                                                        <Avatar
                                                            src={
                                                                feed.favicon_url ??
                                                                undefined
                                                            }
                                                            radius="sm"
                                                            size="md"
                                                        >
                                                            {avatarFallback}
                                                        </Avatar>
                                                        <Stack gap={0}>
                                                            <Group
                                                                gap={6}
                                                                align="center"
                                                            >
                                                                <Text fw={600}>
                                                                    {feed.name}
                                                                </Text>
                                                                {feed.name !==
                                                                    feed.original_name && (
                                                                    <Tooltip
                                                                        label={`Original: ${feed.original_name}`}
                                                                        withArrow
                                                                    >
                                                                        <Badge
                                                                            size="xs"
                                                                            color="gray"
                                                                            variant="light"
                                                                        >
                                                                            Renamed
                                                                        </Badge>
                                                                    </Tooltip>
                                                                )}
                                                            </Group>
                                                            <Group
                                                                gap={8}
                                                                wrap="wrap"
                                                            >
                                                                <Anchor
                                                                    href={
                                                                        feed.site_url
                                                                    }
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    size="xs"
                                                                    onClick={(
                                                                        event,
                                                                    ) =>
                                                                        event.stopPropagation()
                                                                    }
                                                                >
                                                                    Website
                                                                </Anchor>
                                                                <Anchor
                                                                    href={
                                                                        feed.feed_url
                                                                    }
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    size="xs"
                                                                    onClick={(
                                                                        event,
                                                                    ) =>
                                                                        event.stopPropagation()
                                                                    }
                                                                >
                                                                    Feed
                                                                </Anchor>
                                                            </Group>
                                                        </Stack>
                                                    </Group>
                                                </Table.Td>
                                                <Table.Td>
                                                    {feed.category ? (
                                                        <Badge
                                                            variant="light"
                                                            color="blue"
                                                        >
                                                            {feed.category.name}
                                                        </Badge>
                                                    ) : (
                                                        <Text
                                                            size="sm"
                                                            c="dimmed"
                                                        >
                                                            —
                                                        </Text>
                                                    )}
                                                </Table.Td>
                                                <Table.Td ta="right">
                                                    <Text size="sm">
                                                        {feed.entries_count.toLocaleString()}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    {renderStatusBadge(feed)}
                                                </Table.Td>
                                                <Table.Td>
                                                    {renderTimestampCell(
                                                        feed.last_successful_refresh_at,
                                                    )}
                                                </Table.Td>
                                                <Table.Td>
                                                    {renderTimestampCell(
                                                        feed.last_failed_refresh_at,
                                                    )}
                                                </Table.Td>
                                            </Table.Tr>
                                        );
                                    },
                                )}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>

                    <Drawer
                        opened={selectedFeed !== null}
                        onClose={closeDrawer}
                        title={selectedFeed?.name ?? 'Subscription'}
                        position="right"
                        size="lg"
                    >
                        {selectedFeed && (
                            <Stack gap="md">
                                <Group
                                    justify="space-between"
                                    align="flex-start"
                                >
                                    <Stack gap={4}>
                                        <Text size="sm" c="dimmed">
                                            Feed details
                                        </Text>
                                        <Group gap="sm">
                                            {renderStatusBadge(selectedFeed)}
                                            <Badge variant="light" color="gray">
                                                {selectedFeed.entries_count.toLocaleString()}{' '}
                                                entries
                                            </Badge>
                                            {selectedFeed.category && (
                                                <Badge
                                                    variant="light"
                                                    color="blue"
                                                >
                                                    {selectedFeed.category.name}
                                                </Badge>
                                            )}
                                        </Group>
                                    </Stack>

                                    <Button
                                        size="xs"
                                        variant="light"
                                        leftSection={<IconRefresh size={14} />}
                                        loading={
                                            refreshingFeedId === selectedFeed.id
                                        }
                                        onClick={() =>
                                            refreshFeed(selectedFeed)
                                        }
                                    >
                                        Refresh feed
                                    </Button>
                                </Group>

                                <Stack gap={4}>
                                    <Text size="sm" c="dimmed">
                                        Links
                                    </Text>
                                    <Stack gap={4}>
                                        <Anchor
                                            href={selectedFeed.site_url}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            {selectedFeed.site_url}
                                        </Anchor>
                                        <Anchor
                                            href={selectedFeed.feed_url}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            {selectedFeed.feed_url}
                                        </Anchor>
                                    </Stack>
                                </Stack>

                                {selectedFeed.last_error_message && (
                                    <Stack gap={4}>
                                        <Text size="sm" c="red">
                                            Latest error
                                        </Text>
                                        <Text size="sm">
                                            {selectedFeed.last_error_message}
                                        </Text>
                                    </Stack>
                                )}

                                <Stack gap={4}>
                                    <Group
                                        justify="space-between"
                                        align="center"
                                    >
                                        <Text fw={600}>Recent refreshes</Text>
                                        <Text size="sm" c="dimmed">
                                            Showing{' '}
                                            {selectedFeed.refreshes.length}{' '}
                                            attempts
                                        </Text>
                                    </Group>

                                    <ScrollArea h={360} type="auto">
                                        <Table
                                            striped
                                            highlightOnHover
                                            withRowBorders={false}
                                            verticalSpacing="sm"
                                        >
                                            <Table.Thead>
                                                <Table.Tr>
                                                    <Table.Th>
                                                        Refreshed at
                                                    </Table.Th>
                                                    <Table.Th>Status</Table.Th>
                                                    <Table.Th ta="right">
                                                        New entries
                                                    </Table.Th>
                                                    <Table.Th>Error</Table.Th>
                                                </Table.Tr>
                                            </Table.Thead>
                                            <Table.Tbody>
                                                {selectedFeed.refreshes
                                                    .length === 0 && (
                                                    <Table.Tr>
                                                        <Table.Td colSpan={4}>
                                                            <Text
                                                                size="sm"
                                                                c="dimmed"
                                                            >
                                                                No refresh
                                                                attempts
                                                                recorded yet.
                                                            </Text>
                                                        </Table.Td>
                                                    </Table.Tr>
                                                )}

                                                {selectedFeed.refreshes.map(
                                                    (
                                                        refresh: FeedRefreshDto,
                                                    ) => (
                                                        <Table.Tr
                                                            key={refresh.id}
                                                        >
                                                            <Table.Td>
                                                                {formatAbsolute(
                                                                    refresh.refreshed_at,
                                                                )}
                                                            </Table.Td>
                                                            <Table.Td>
                                                                <Badge
                                                                    color={
                                                                        refresh.was_successful
                                                                            ? 'green'
                                                                            : 'red'
                                                                    }
                                                                    variant="light"
                                                                >
                                                                    {refresh.was_successful
                                                                        ? 'Success'
                                                                        : 'Failed'}
                                                                </Badge>
                                                            </Table.Td>
                                                            <Table.Td ta="right">
                                                                {
                                                                    refresh.entries_created
                                                                }
                                                            </Table.Td>
                                                            <Table.Td>
                                                                {refresh.error_message ? (
                                                                    <Text
                                                                        size="sm"
                                                                        c="red"
                                                                    >
                                                                        {
                                                                            refresh.error_message
                                                                        }
                                                                    </Text>
                                                                ) : (
                                                                    <Text
                                                                        size="sm"
                                                                        c="dimmed"
                                                                    >
                                                                        —
                                                                    </Text>
                                                                )}
                                                            </Table.Td>
                                                        </Table.Tr>
                                                    ),
                                                )}
                                            </Table.Tbody>
                                        </Table>
                                    </ScrollArea>
                                </Stack>
                            </Stack>
                        )}
                    </Drawer>
                </Stack>
            </AppShell.Main>
        </AppShellLayout>
    );
};

Subscriptions.layout = (page: ReactNode) => (
    <AuthenticatedLayout pageTitle="Subscriptions">{page}</AuthenticatedLayout>
);

export default Subscriptions;

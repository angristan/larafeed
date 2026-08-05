import {
    ActionIcon,
    Alert,
    Anchor,
    Badge,
    Button,
    Drawer,
    Group,
    Loader,
    Paper,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { ManagedSubscription } from '../api/subscriptions';
import { ApplicationPage } from '../components/ApplicationPage';
import { FeedFavicon } from '../components/reader/FeedFavicon';
import {
    refreshSubscriptionMutationOptions,
    subscriptionManagementQueryOptions,
} from '../queries/subscriptions';
import classes from './SubscriptionsPage.module.css';

export { buildAddFeedBookmarklet } from '../bookmarklet';

type SubscriptionStatus = 'healthy' | 'failing' | 'never' | 'gone';
type SortField = 'name' | 'entries' | 'lastSuccess' | 'lastFailure';

export const subscriptionStatusFilterOptions = [
    { label: 'Success', value: 'healthy' },
    { label: 'Failed', value: 'failing' },
    { label: 'Never refreshed', value: 'never' },
    { label: 'Gone', value: 'gone' },
] as const satisfies readonly {
    readonly label: string;
    readonly value: SubscriptionStatus;
}[];
type SortDirection = 'asc' | 'desc';

export function nextSubscriptionSortDirection(
    currentField: SortField,
    currentDirection: SortDirection,
    nextField: SortField,
): SortDirection {
    if (nextField === currentField) return currentDirection;
    return nextField === 'name' ? 'asc' : 'desc';
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: 'auto',
});

function formatRelative(timestamp: number | null): string {
    if (timestamp === null) return 'Never';
    const seconds = Math.round((timestamp - Date.now()) / 1_000);
    const ranges = [
        ['year', 31_536_000],
        ['month', 2_592_000],
        ['week', 604_800],
        ['day', 86_400],
        ['hour', 3_600],
        ['minute', 60],
    ] as const;
    for (const [unit, duration] of ranges) {
        if (Math.abs(seconds) >= duration) {
            return relativeTimeFormatter.format(
                Math.round(seconds / duration),
                unit,
            );
        }
    }
    return relativeTimeFormatter.format(seconds, 'second');
}

function formatAbsolute(timestamp: number | null): string {
    if (timestamp === null) return '—';
    return new Intl.DateTimeFormat('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
        .format(new Date(timestamp))
        .replace(' ', ' ');
}

export function getSubscriptionStatus(
    subscription: ManagedSubscription,
): SubscriptionStatus {
    if (subscription.isGone) return 'gone';
    if (
        subscription.consecutiveFailures > 0 ||
        subscription.refreshes[0]?.successful === false
    ) {
        return 'failing';
    }
    return subscription.lastSuccessfulRefreshAt === null ? 'never' : 'healthy';
}

function StatusBadge({ subscription }: { subscription: ManagedSubscription }) {
    const status = getSubscriptionStatus(subscription);
    const presentation = {
        healthy: { label: 'Success', color: 'green' },
        failing: { label: 'Failed', color: 'red' },
        never: { label: 'Never refreshed', color: 'gray' },
        gone: { label: 'Gone', color: 'gray' },
    }[status];
    return (
        <Badge color={presentation.color} radius="sm" variant="light">
            {presentation.label}
        </Badge>
    );
}

function SubscriptionDrawer({
    subscription,
    onClose,
}: {
    readonly subscription: ManagedSubscription | null;
    readonly onClose: () => void;
}) {
    const queryClient = useQueryClient();
    const refresh = useMutation(
        refreshSubscriptionMutationOptions(queryClient),
    );

    return (
        <Drawer
            onClose={onClose}
            opened={subscription !== null}
            position="right"
            size="lg"
            title={
                subscription?.customFeedName ??
                subscription?.feedName ??
                'Subscription'
            }
        >
            {subscription !== null && (
                <Stack gap="md">
                    <Group align="flex-start" justify="space-between">
                        <Stack gap={4}>
                            <Text c="dimmed" size="sm">
                                Feed details
                            </Text>
                            <Group gap="sm">
                                <StatusBadge subscription={subscription} />
                                <Text c="dimmed" size="sm">
                                    {subscription.entryCount.toLocaleString()}{' '}
                                    entries
                                </Text>
                                <Text c="dimmed" size="sm">
                                    {subscription.categoryName}
                                </Text>
                            </Group>
                        </Stack>
                        <Button
                            leftSection={<IconRefresh size={14} />}
                            loading={refresh.isPending}
                            onClick={() =>
                                refresh.mutate({ feedId: subscription.feedId })
                            }
                            size="xs"
                            variant="light"
                        >
                            Refresh feed
                        </Button>
                    </Group>

                    <Stack gap={4}>
                        <Text c="dimmed" size="sm">
                            Links
                        </Text>
                        {subscription.siteUrl !== null && (
                            <Anchor
                                href={subscription.siteUrl}
                                rel="noreferrer"
                                target="_blank"
                            >
                                {subscription.siteUrl}
                            </Anchor>
                        )}
                        <Anchor
                            href={subscription.feedUrl}
                            rel="noreferrer"
                            target="_blank"
                        >
                            {subscription.feedUrl}
                        </Anchor>
                    </Stack>

                    {subscription.lastErrorMessage !== null && (
                        <Stack gap={4}>
                            <Text c="red" size="sm">
                                Latest error
                            </Text>
                            <Text size="sm">
                                {subscription.lastErrorMessage}
                            </Text>
                        </Stack>
                    )}

                    <Stack gap={4}>
                        <Group align="center" justify="space-between">
                            <Text fw={600}>Recent refreshes</Text>
                            <Text c="dimmed" size="sm">
                                Showing {subscription.refreshes.length} attempts
                            </Text>
                        </Group>
                        <ScrollArea h={360} type="auto">
                            <Table
                                highlightOnHover
                                striped
                                verticalSpacing="sm"
                                withRowBorders={false}
                            >
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Refreshed at</Table.Th>
                                        <Table.Th>Status</Table.Th>
                                        <Table.Th ta="right">
                                            New entries
                                        </Table.Th>
                                        <Table.Th>Error</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {subscription.refreshes.length === 0 && (
                                        <Table.Tr>
                                            <Table.Td colSpan={4}>
                                                <Text c="dimmed" size="sm">
                                                    No refresh attempts recorded
                                                    yet.
                                                </Text>
                                            </Table.Td>
                                        </Table.Tr>
                                    )}
                                    {subscription.refreshes.map((record) => (
                                        <Table.Tr key={record.id}>
                                            <Table.Td>
                                                {formatAbsolute(
                                                    record.refreshedAt,
                                                )}
                                            </Table.Td>
                                            <Table.Td>
                                                <Badge
                                                    color={
                                                        record.successful
                                                            ? 'green'
                                                            : 'red'
                                                    }
                                                    variant="light"
                                                >
                                                    {record.successful
                                                        ? 'Success'
                                                        : 'Failed'}
                                                </Badge>
                                            </Table.Td>
                                            <Table.Td ta="right">
                                                {record.entriesCreated}
                                            </Table.Td>
                                            <Table.Td>
                                                {record.errorMessage ?? '—'}
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </ScrollArea>
                    </Stack>
                </Stack>
            )}
        </Drawer>
    );
}

export function SubscriptionsPage() {
    const management = useQuery(subscriptionManagementQueryOptions);
    const data = management.data;
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('all');
    const [status, setStatus] = useState<SubscriptionStatus | 'all'>('all');
    const [sortField, setSortField] = useState<SortField>('name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);

    const subscriptions = data?.subscriptions ?? [];
    const categories = data?.categories ?? [];
    const selected =
        subscriptions.find((item) => item.feedId === selectedFeedId) ?? null;

    const filtered = useMemo(() => {
        const normalized = search.trim().toLocaleLowerCase();
        const direction = sortDirection === 'asc' ? 1 : -1;
        return subscriptions
            .filter((subscription) => {
                const name =
                    subscription.customFeedName ?? subscription.feedName;
                const matchesSearch =
                    normalized === '' ||
                    `${name} ${subscription.feedName} ${subscription.siteUrl ?? ''} ${subscription.feedUrl}`
                        .toLocaleLowerCase()
                        .includes(normalized);
                const matchesCategory =
                    category === 'all' ||
                    String(subscription.categoryId) === category;
                const matchesStatus =
                    status === 'all' ||
                    getSubscriptionStatus(subscription) === status;
                return matchesSearch && matchesCategory && matchesStatus;
            })
            .toSorted((left, right) => {
                if (sortField === 'entries') {
                    return direction * (left.entryCount - right.entryCount);
                }
                if (sortField === 'lastSuccess') {
                    return (
                        direction *
                        ((left.lastSuccessfulRefreshAt ?? 0) -
                            (right.lastSuccessfulRefreshAt ?? 0))
                    );
                }
                if (sortField === 'lastFailure') {
                    return (
                        direction *
                        ((left.lastFailedRefreshAt ?? 0) -
                            (right.lastFailedRefreshAt ?? 0))
                    );
                }
                const leftName = left.customFeedName ?? left.feedName;
                const rightName = right.customFeedName ?? right.feedName;
                return direction * leftName.localeCompare(rightName);
            });
    }, [category, search, sortDirection, sortField, status, subscriptions]);

    const handleSortFieldChange = (value: string | null) => {
        if (value === null) return;
        const nextField = value as SortField;
        setSortField(nextField);
        setSortDirection((currentDirection) =>
            nextSubscriptionSortDirection(
                sortField,
                currentDirection,
                nextField,
            ),
        );
    };

    const renderSortIndicator = (field: SortField) => {
        if (sortField !== field) return null;
        return sortDirection === 'asc' ? (
            <IconArrowNarrowUp aria-label="Sorted ascending" size={14} />
        ) : (
            <IconArrowNarrowDown aria-label="Sorted descending" size={14} />
        );
    };

    const resetFilters = () => {
        setSearch('');
        setCategory('all');
        setStatus('all');
        setSortField('name');
        setSortDirection('asc');
    };

    const errorCount = subscriptions.filter((subscription) => {
        const subscriptionStatus = getSubscriptionStatus(subscription);
        return (
            subscriptionStatus === 'failing' || subscriptionStatus === 'gone'
        );
    }).length;
    const neverCount = subscriptions.filter(
        (subscription) => getSubscriptionStatus(subscription) === 'never',
    ).length;

    return (
        <ApplicationPage activePage="subscriptions">
            <SubscriptionDrawer
                onClose={() => setSelectedFeedId(null)}
                subscription={selected}
            />
            <Stack className={classes.page} gap="lg">
                <Stack gap={4}>
                    <Title order={1}>Subscriptions</Title>
                    <Text c="dimmed" size="sm">
                        Search, filter, and audit refresh activity across all of
                        your feeds.
                    </Text>
                </Stack>

                <Paper className={classes.auditSurface} p={0}>
                    <div className={classes.statusSummary}>
                        <Text component="span" size="sm">
                            {`Total: ${subscriptions.length}`}
                        </Text>
                        <Text component="span" size="sm">
                            {`With errors: ${errorCount}`}
                        </Text>
                        <Text component="span" size="sm">
                            {`Never refreshed: ${neverCount}`}
                        </Text>
                    </div>

                    <section aria-labelledby="audit-filters-heading">
                        <header className={classes.toolbarHeader}>
                            <Stack gap={1}>
                                <Title id="audit-filters-heading" order={2}>
                                    Search &amp; Filter
                                </Title>
                                <Text c="dimmed" size="xs">
                                    Refine the subscriptions table in real time.
                                </Text>
                            </Stack>
                            <Button
                                color="gray"
                                onClick={resetFilters}
                                size="xs"
                                variant="subtle"
                            >
                                Reset filters
                            </Button>
                        </header>
                        <div className={classes.filterGrid}>
                            <TextInput
                                label="Search"
                                leftSection={<IconSearch size={16} />}
                                onChange={(event) =>
                                    setSearch(event.currentTarget.value)
                                }
                                placeholder="Name or URL"
                                value={search}
                            />
                            <Select
                                data={[
                                    {
                                        label: 'All categories',
                                        value: 'all',
                                    },
                                    ...categories.map((item) => ({
                                        label: item.name,
                                        value: String(item.id),
                                    })),
                                ]}
                                label="Category"
                                onChange={(value) =>
                                    setCategory(value ?? 'all')
                                }
                                value={category}
                            />
                            <Select
                                data={[
                                    { label: 'All statuses', value: 'all' },
                                    ...subscriptionStatusFilterOptions,
                                ]}
                                label="Status"
                                onChange={(value) =>
                                    setStatus(
                                        (value ?? 'all') as
                                            | SubscriptionStatus
                                            | 'all',
                                    )
                                }
                                value={status}
                            />
                            <Group align="flex-end" gap="xs" wrap="nowrap">
                                <Select
                                    data={[
                                        { label: 'Name', value: 'name' },
                                        {
                                            label: 'Entries count',
                                            value: 'entries',
                                        },
                                        {
                                            label: 'Last success',
                                            value: 'lastSuccess',
                                        },
                                        {
                                            label: 'Last failure',
                                            value: 'lastFailure',
                                        },
                                    ]}
                                    label="Sort by"
                                    onChange={handleSortFieldChange}
                                    style={{ flex: 1 }}
                                    value={sortField}
                                />
                                <Tooltip
                                    label={`Sort ${
                                        sortDirection === 'asc'
                                            ? 'ascending'
                                            : 'descending'
                                    }`}
                                    withArrow
                                >
                                    <ActionIcon
                                        aria-label="Toggle sort direction"
                                        onClick={() =>
                                            setSortDirection((current) =>
                                                current === 'asc'
                                                    ? 'desc'
                                                    : 'asc',
                                            )
                                        }
                                        size="lg"
                                        variant="light"
                                    >
                                        {sortDirection === 'asc' ? (
                                            <IconArrowNarrowUp size={18} />
                                        ) : (
                                            <IconArrowNarrowDown size={18} />
                                        )}
                                    </ActionIcon>
                                </Tooltip>
                            </Group>
                        </div>
                    </section>

                    {management.isError && data !== undefined && (
                        <Alert
                            className={classes.inlineAlert}
                            color="red"
                            title="Subscription data may be outdated"
                        >
                            {management.error.message}
                        </Alert>
                    )}

                    {management.isPending && data === undefined && (
                        <Group className={classes.stateRegion} role="status">
                            <Loader size="sm" />
                            <Text size="sm">Loading subscriptions…</Text>
                        </Group>
                    )}
                    {management.isError && data === undefined && (
                        <Alert
                            className={classes.stateRegion}
                            color="red"
                            title="Subscriptions are unavailable"
                        >
                            {management.error.message}
                        </Alert>
                    )}

                    {data !== undefined && (
                        <>
                            <div className={classes.tableSummary}>
                                <Text c="dimmed" size="xs">
                                    {`Showing ${filtered.length.toLocaleString()} of ${subscriptions.length.toLocaleString()} subscriptions`}
                                </Text>
                                {management.isFetching && (
                                    <Group gap="xs" role="status">
                                        <Loader size="xs" />
                                        <Text c="dimmed" size="xs">
                                            Updating…
                                        </Text>
                                    </Group>
                                )}
                            </div>
                            <Table.ScrollContainer minWidth={900}>
                                <Table
                                    className={classes.table}
                                    highlightOnHover
                                    verticalSpacing="sm"
                                    withRowBorders
                                >
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th
                                                style={{
                                                    width: '32%',
                                                    minWidth: 280,
                                                }}
                                            >
                                                <Group align="center" gap={4}>
                                                    Name
                                                    {renderSortIndicator(
                                                        'name',
                                                    )}
                                                </Group>
                                            </Table.Th>
                                            <Table.Th>Category</Table.Th>
                                            <Table.Th ta="right">
                                                <Group
                                                    align="center"
                                                    gap={4}
                                                    justify="flex-end"
                                                >
                                                    Entries
                                                    {renderSortIndicator(
                                                        'entries',
                                                    )}
                                                </Group>
                                            </Table.Th>
                                            <Table.Th>Status</Table.Th>
                                            <Table.Th>
                                                <Group align="center" gap={4}>
                                                    Last success
                                                    {renderSortIndicator(
                                                        'lastSuccess',
                                                    )}
                                                </Group>
                                            </Table.Th>
                                            <Table.Th>
                                                <Group align="center" gap={4}>
                                                    Last failure
                                                    {renderSortIndicator(
                                                        'lastFailure',
                                                    )}
                                                </Group>
                                            </Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {filtered.length === 0 && (
                                            <Table.Tr>
                                                <Table.Td colSpan={6}>
                                                    <Text
                                                        c="dimmed"
                                                        size="sm"
                                                        ta="center"
                                                    >
                                                        No subscriptions match
                                                        the current filters.
                                                    </Text>
                                                </Table.Td>
                                            </Table.Tr>
                                        )}
                                        {filtered.map((subscription) => {
                                            const name =
                                                subscription.customFeedName ??
                                                subscription.feedName;
                                            const lastFailure =
                                                subscription.lastFailedRefreshAt;
                                            const subscriptionStatus =
                                                getSubscriptionStatus(
                                                    subscription,
                                                );
                                            const issue =
                                                subscriptionStatus ===
                                                    'failing' ||
                                                subscriptionStatus === 'gone'
                                                    ? (subscription.lastErrorMessage ??
                                                      subscription.lastErrorClass ??
                                                      (subscriptionStatus ===
                                                      'gone'
                                                          ? 'Feed is no longer available.'
                                                          : `${subscription.consecutiveFailures.toLocaleString()} consecutive refresh failures`))
                                                    : null;
                                            return (
                                                <Table.Tr
                                                    key={subscription.feedId}
                                                    aria-expanded={
                                                        selectedFeedId ===
                                                        subscription.feedId
                                                    }
                                                    aria-label={`View details for ${name}`}
                                                    onClick={() =>
                                                        setSelectedFeedId(
                                                            subscription.feedId,
                                                        )
                                                    }
                                                    onKeyDown={(event) => {
                                                        if (
                                                            event.key ===
                                                                'Enter' ||
                                                            event.key === ' '
                                                        ) {
                                                            event.preventDefault();
                                                            setSelectedFeedId(
                                                                subscription.feedId,
                                                            );
                                                        }
                                                    }}
                                                    role="button"
                                                    style={{
                                                        cursor: 'pointer',
                                                    }}
                                                    tabIndex={0}
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
                                                            <FeedFavicon
                                                                isDark={
                                                                    subscription.faviconIsDark
                                                                }
                                                                size={32}
                                                                src={
                                                                    subscription.faviconUrl
                                                                }
                                                            />
                                                            <Stack gap={0}>
                                                                <Group gap={6}>
                                                                    <Text
                                                                        fw={600}
                                                                    >
                                                                        {name}
                                                                    </Text>
                                                                    {subscription.customFeedName !==
                                                                        null && (
                                                                        <Text
                                                                            c="dimmed"
                                                                            component="span"
                                                                            size="xs"
                                                                        >
                                                                            Renamed
                                                                        </Text>
                                                                    )}
                                                                </Group>
                                                                <Group gap={8}>
                                                                    {subscription.siteUrl !==
                                                                        null && (
                                                                        <Anchor
                                                                            href={
                                                                                subscription.siteUrl
                                                                            }
                                                                            onClick={(
                                                                                event,
                                                                            ) =>
                                                                                event.stopPropagation()
                                                                            }
                                                                            rel="noreferrer"
                                                                            size="xs"
                                                                            target="_blank"
                                                                        >
                                                                            Website
                                                                        </Anchor>
                                                                    )}
                                                                    <Anchor
                                                                        href={
                                                                            subscription.feedUrl
                                                                        }
                                                                        onClick={(
                                                                            event,
                                                                        ) =>
                                                                            event.stopPropagation()
                                                                        }
                                                                        rel="noreferrer"
                                                                        size="xs"
                                                                        target="_blank"
                                                                    >
                                                                        Feed
                                                                    </Anchor>
                                                                </Group>
                                                            </Stack>
                                                        </Group>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Text size="sm">
                                                            {
                                                                subscription.categoryName
                                                            }
                                                        </Text>
                                                    </Table.Td>
                                                    <Table.Td ta="right">
                                                        {subscription.entryCount.toLocaleString()}
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Stack gap={3}>
                                                            <StatusBadge
                                                                subscription={
                                                                    subscription
                                                                }
                                                            />
                                                            {issue !== null && (
                                                                <Text
                                                                    className={
                                                                        classes.issue
                                                                    }
                                                                    c="red"
                                                                    lineClamp={
                                                                        2
                                                                    }
                                                                    size="xs"
                                                                    title={
                                                                        issue
                                                                    }
                                                                >
                                                                    {issue}
                                                                </Text>
                                                            )}
                                                        </Stack>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Tooltip
                                                            label={formatAbsolute(
                                                                subscription.lastSuccessfulRefreshAt,
                                                            )}
                                                            withArrow
                                                        >
                                                            <Text size="sm">
                                                                {formatRelative(
                                                                    subscription.lastSuccessfulRefreshAt,
                                                                )}
                                                            </Text>
                                                        </Tooltip>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Tooltip
                                                            label={formatAbsolute(
                                                                lastFailure,
                                                            )}
                                                            withArrow
                                                        >
                                                            <Text size="sm">
                                                                {formatRelative(
                                                                    lastFailure,
                                                                )}
                                                            </Text>
                                                        </Tooltip>
                                                    </Table.Td>
                                                </Table.Tr>
                                            );
                                        })}
                                    </Table.Tbody>
                                </Table>
                            </Table.ScrollContainer>
                        </>
                    )}
                </Paper>
            </Stack>
        </ApplicationPage>
    );
}

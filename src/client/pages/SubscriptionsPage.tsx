import {
    ActionIcon,
    Alert,
    Anchor,
    Badge,
    Button,
    Drawer,
    Group,
    Loader,
    NavLink,
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
import { notifications } from '@mantine/notifications';
import {
    IconArrowNarrowDown,
    IconArrowNarrowUp,
    IconArrowsExchange,
    IconListDetails,
    IconRefresh,
    IconSearch,
    IconTable,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    type FormEvent,
    memo,
    useDeferredValue,
    useMemo,
    useState,
} from 'react';
import { Link } from 'react-router';

import type {
    FeedDiscoveryCandidate,
    ManagedCategory,
    ManagedSubscription,
} from '../api/subscriptions';
import {
    ApplicationContent,
    ApplicationPage,
    ApplicationSidebarHeader,
    ApplicationSidebarNavigation,
} from '../components/ApplicationPage';
import { FeedCandidateSelector } from '../components/reader/FeedCandidateSelector';
import { FeedFavicon } from '../components/reader/FeedFavicon';
import {
    feedRefreshQueuedMessage,
    notifyActionError,
    notifyDone,
} from '../components/reader/ReaderSidebar';
import {
    dismissMovedFeedMutationOptions,
    moveSubscriptionMutationOptions,
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

const absoluteTimeFormatter = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
});

function formatAbsolute(timestamp: number | null): string {
    if (timestamp === null) return '—';
    return absoluteTimeFormatter.format(new Date(timestamp)).replace(' ', ' ');
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

function SubscriptionOverview({
    categories,
    onSelect,
    subscriptions,
}: {
    readonly categories: readonly ManagedCategory[];
    readonly onSelect: (feedId: number) => void;
    readonly subscriptions: readonly ManagedSubscription[];
}) {
    const statuses = subscriptions.map(getSubscriptionStatus);
    const healthyCount = statuses.filter(
        (status) => status === 'healthy',
    ).length;
    const errorCount = statuses.filter(
        (status) => status === 'failing' || status === 'gone',
    ).length;
    const neverCount = statuses.filter((status) => status === 'never').length;
    const attentionSubscriptions = subscriptions.filter(
        (subscription) => getSubscriptionStatus(subscription) !== 'healthy',
    );

    return (
        <>
            <Paper className={classes.auditSurface} p={0}>
                <header className={classes.overviewHeader}>
                    <Title order={2}>Feed health</Title>
                </header>
                <div className={classes.metricGrid}>
                    <div>
                        <Text c="dimmed" size="xs">
                            Total feeds
                        </Text>
                        <Text className={classes.metricValue}>
                            {subscriptions.length.toLocaleString()}
                        </Text>
                    </div>
                    <div>
                        <Text c="dimmed" size="xs">
                            Healthy
                        </Text>
                        <Text className={classes.metricValue}>
                            {healthyCount.toLocaleString()}
                        </Text>
                    </div>
                    <div>
                        <Text c="dimmed" size="xs">
                            With errors
                        </Text>
                        <Text
                            className={classes.metricValue}
                            c={errorCount > 0 ? 'red' : undefined}
                        >
                            {errorCount.toLocaleString()}
                        </Text>
                    </div>
                    <div>
                        <Text c="dimmed" size="xs">
                            Never refreshed
                        </Text>
                        <Text className={classes.metricValue}>
                            {neverCount.toLocaleString()}
                        </Text>
                    </div>
                </div>
            </Paper>

            <Paper className={classes.auditSurface} p={0}>
                <header className={classes.overviewHeader}>
                    <Stack gap={1}>
                        <Title order={2}>Needs attention</Title>
                        <Text c="dimmed" size="xs">
                            Feeds that failed, disappeared, or never refreshed.
                        </Text>
                    </Stack>
                    <Button
                        component={Link}
                        size="xs"
                        to="/settings/subscriptions"
                        variant="subtle"
                    >
                        Open feed audit
                    </Button>
                </header>
                {attentionSubscriptions.length === 0 ? (
                    <Text className={classes.emptyRegion} c="dimmed" size="sm">
                        All feeds are refreshing normally.
                    </Text>
                ) : (
                    <Table.ScrollContainer minWidth={640}>
                        <Table
                            className={classes.table}
                            highlightOnHover
                            verticalSpacing="sm"
                            withRowBorders
                        >
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Name</Table.Th>
                                    <Table.Th>Category</Table.Th>
                                    <Table.Th>Status</Table.Th>
                                    <Table.Th>Last attempt</Table.Th>
                                    <Table.Th>Actions</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {attentionSubscriptions.map((subscription) => {
                                    const name =
                                        subscription.customFeedName ??
                                        subscription.feedName;
                                    return (
                                        <Table.Tr key={subscription.feedId}>
                                            <Table.Td>
                                                <Group gap="sm" wrap="nowrap">
                                                    <FeedFavicon
                                                        isDark={
                                                            subscription.faviconIsDark
                                                        }
                                                        size={28}
                                                        src={
                                                            subscription.faviconUrl
                                                        }
                                                    />
                                                    <Text fw={600} size="sm">
                                                        {name}
                                                    </Text>
                                                </Group>
                                            </Table.Td>
                                            <Table.Td>
                                                <Text size="sm">
                                                    {subscription.categoryName}
                                                </Text>
                                            </Table.Td>
                                            <Table.Td>
                                                <StatusBadge
                                                    subscription={subscription}
                                                />
                                            </Table.Td>
                                            <Table.Td>
                                                <Tooltip
                                                    label={formatAbsolute(
                                                        subscription.lastAttemptAt,
                                                    )}
                                                    withArrow
                                                >
                                                    <Text size="sm">
                                                        {formatRelative(
                                                            subscription.lastAttemptAt,
                                                        )}
                                                    </Text>
                                                </Tooltip>
                                            </Table.Td>
                                            <Table.Td>
                                                <Button
                                                    aria-label={`View details for ${name}`}
                                                    onClick={() =>
                                                        onSelect(
                                                            subscription.feedId,
                                                        )
                                                    }
                                                    size="xs"
                                                    variant="default"
                                                >
                                                    Details
                                                </Button>
                                            </Table.Td>
                                        </Table.Tr>
                                    );
                                })}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                )}
            </Paper>

            <Paper className={classes.auditSurface} p={0}>
                <header className={classes.overviewHeader}>
                    <Title order={2}>Categories</Title>
                </header>
                {categories.length === 0 ? (
                    <Text className={classes.emptyRegion} c="dimmed" size="sm">
                        No categories yet.
                    </Text>
                ) : (
                    <Table className={classes.table} verticalSpacing="sm">
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Category</Table.Th>
                                <Table.Th ta="right">Subscriptions</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {categories.map((category) => (
                                <Table.Tr key={category.id}>
                                    <Table.Td>{category.name}</Table.Td>
                                    <Table.Td ta="right">
                                        {category.subscriptionCount.toLocaleString()}
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                )}
            </Paper>
        </>
    );
}

/**
 * Offers the feed URL that refresh found after the old one stopped working,
 * and lets the user switch to any other URL. A switch keeps read and starred
 * state, so it replaces "unsubscribe and add again".
 */
export function MoveFeedSection({
    subscription,
    onMoved,
}: {
    readonly subscription: ManagedSubscription;
    readonly onMoved: (feedId: number) => void;
}) {
    const queryClient = useQueryClient();
    const move = useMutation(moveSubscriptionMutationOptions(queryClient));
    const dismiss = useMutation(dismissMovedFeedMutationOptions(queryClient));
    const [editing, setEditing] = useState(false);
    const [feedUrl, setFeedUrl] = useState('');
    const [candidates, setCandidates] = useState<
        readonly FeedDiscoveryCandidate[] | null
    >(null);

    const switchTo = (url: string) =>
        move.mutate(
            { feedId: subscription.feedId, feedUrl: url },
            {
                onSuccess: (result) => {
                    if (result.kind === 'selection_required') {
                        setEditing(true);
                        setCandidates(result.candidates);
                        return;
                    }
                    notifications.show({
                        title: 'Feed switched',
                        message: result.keptOldSubscription
                            ? 'Some starred articles are only in the old feed, so the old subscription was kept.'
                            : 'Read and starred articles were carried over.',
                        color: 'green',
                        withBorder: true,
                    });
                    onMoved(result.subscription.feedId);
                },
            },
        );
    const submitUrl = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmed = feedUrl.trim();
        if (trimmed !== '') switchTo(trimmed);
    };
    const closeEditor = () => {
        setEditing(false);
        setCandidates(null);
        setFeedUrl('');
        move.reset();
    };

    return (
        <>
            {subscription.movedToUrl !== null && (
                <Alert
                    color="blue"
                    icon={<IconArrowsExchange size={18} />}
                    title="This feed has moved"
                    variant="light"
                >
                    <Stack gap="sm">
                        <Text size="sm">
                            The feed URL stopped working, and the site now lists
                            this feed:{' '}
                            <Anchor
                                href={subscription.movedToUrl}
                                rel="noreferrer"
                                size="sm"
                                target="_blank"
                            >
                                {subscription.movedToUrl}
                            </Anchor>
                        </Text>
                        {!editing && move.error !== null && (
                            <Text c="red" size="sm">
                                {move.error.message}
                            </Text>
                        )}
                        <Group gap="xs">
                            <Button
                                loading={move.isPending && !editing}
                                onClick={() => {
                                    if (subscription.movedToUrl !== null) {
                                        switchTo(subscription.movedToUrl);
                                    }
                                }}
                                size="xs"
                            >
                                Switch to new feed
                            </Button>
                            <Button
                                loading={dismiss.isPending}
                                onClick={() => {
                                    if (subscription.movedToUrl !== null) {
                                        dismiss.mutate({
                                            feedId: subscription.feedId,
                                            movedToUrl: subscription.movedToUrl,
                                        });
                                    }
                                }}
                                size="xs"
                                variant="subtle"
                            >
                                Dismiss
                            </Button>
                        </Group>
                    </Stack>
                </Alert>
            )}

            {!editing ? (
                <Group>
                    <Button
                        leftSection={<IconArrowsExchange size={14} />}
                        onClick={() => setEditing(true)}
                        size="xs"
                        variant="subtle"
                    >
                        Change feed URL
                    </Button>
                </Group>
            ) : candidates !== null ? (
                <FeedCandidateSelector
                    candidates={candidates}
                    error={move.error}
                    isPending={move.isPending}
                    onBack={() => {
                        setCandidates(null);
                        move.reset();
                    }}
                    onSubmit={switchTo}
                />
            ) : (
                <form onSubmit={submitUrl}>
                    <Stack gap="xs">
                        <TextInput
                            data-autofocus
                            description="Read and starred articles carry over to the new feed."
                            error={move.error?.message}
                            label="New feed or website URL"
                            onChange={(event) =>
                                setFeedUrl(event.currentTarget.value)
                            }
                            placeholder="https://example.com/feed.xml"
                            value={feedUrl}
                        />
                        <Group gap="xs" justify="flex-end">
                            <Button
                                onClick={closeEditor}
                                size="xs"
                                variant="default"
                            >
                                Cancel
                            </Button>
                            <Button
                                disabled={feedUrl.trim() === ''}
                                loading={move.isPending}
                                size="xs"
                                type="submit"
                            >
                                Switch feed
                            </Button>
                        </Group>
                    </Stack>
                </form>
            )}
        </>
    );
}

function SubscriptionDrawer({
    subscription,
    onClose,
    onMoved,
}: {
    readonly subscription: ManagedSubscription | null;
    readonly onClose: () => void;
    readonly onMoved: (feedId: number) => void;
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
                                refresh.mutate(
                                    { feedId: subscription.feedId },
                                    {
                                        onSuccess: () =>
                                            notifyDone(
                                                feedRefreshQueuedMessage(
                                                    subscription.customFeedName ??
                                                        subscription.feedName,
                                                ),
                                            ),
                                        onError: (error) =>
                                            notifyActionError(
                                                'Could not refresh the feed',
                                                error,
                                            ),
                                    },
                                )
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

                    <MoveFeedSection
                        // A different subscription starts with a closed form.
                        key={subscription.feedId}
                        onMoved={onMoved}
                        subscription={subscription}
                    />

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

// A memoized row: typing in the search box or opening the details drawer
// re-renders only the rows whose own props changed.
const SubscriptionAuditRow = memo(function SubscriptionAuditRow({
    subscription,
    expanded,
    onSelect,
}: {
    readonly subscription: ManagedSubscription;
    readonly expanded: boolean;
    readonly onSelect: (feedId: number) => void;
}) {
    const name = subscription.customFeedName ?? subscription.feedName;
    const lastFailure = subscription.lastFailedRefreshAt;
    const subscriptionStatus = getSubscriptionStatus(subscription);
    const issue =
        subscription.movedToUrl !== null
            ? 'Feed moved. Open details to switch to the new URL.'
            : subscriptionStatus === 'failing' || subscriptionStatus === 'gone'
              ? (subscription.lastErrorMessage ??
                subscription.lastErrorClass ??
                (subscriptionStatus === 'gone'
                    ? 'Feed is no longer available.'
                    : `${subscription.consecutiveFailures.toLocaleString()} consecutive refresh failures`))
              : null;
    return (
        <Table.Tr>
            <Table.Td
                style={{
                    width: '32%',
                    minWidth: 280,
                }}
            >
                <Group gap="sm" wrap="nowrap">
                    <FeedFavicon
                        isDark={subscription.faviconIsDark}
                        size={32}
                        src={subscription.faviconUrl}
                    />
                    <Stack gap={0}>
                        <Group gap={6}>
                            <Text fw={600}>{name}</Text>
                            {subscription.customFeedName !== null && (
                                <Text c="dimmed" component="span" size="xs">
                                    Renamed
                                </Text>
                            )}
                        </Group>
                        <Group gap={8}>
                            {subscription.siteUrl !== null && (
                                <Anchor
                                    href={subscription.siteUrl}
                                    rel="noreferrer"
                                    size="xs"
                                    target="_blank"
                                >
                                    Website
                                </Anchor>
                            )}
                            <Anchor
                                href={subscription.feedUrl}
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
                <Text size="sm">{subscription.categoryName}</Text>
            </Table.Td>
            <Table.Td ta="right">
                {subscription.entryCount.toLocaleString()}
            </Table.Td>
            <Table.Td>
                <Stack gap={3}>
                    <StatusBadge subscription={subscription} />
                    {issue !== null && (
                        <Text
                            className={classes.issue}
                            c="red"
                            lineClamp={2}
                            size="xs"
                            title={issue}
                        >
                            {issue}
                        </Text>
                    )}
                </Stack>
            </Table.Td>
            <Table.Td>
                <Tooltip
                    label={formatAbsolute(subscription.lastSuccessfulRefreshAt)}
                    withArrow
                >
                    <Text size="sm">
                        {formatRelative(subscription.lastSuccessfulRefreshAt)}
                    </Text>
                </Tooltip>
            </Table.Td>
            <Table.Td>
                <Tooltip label={formatAbsolute(lastFailure)} withArrow>
                    <Text size="sm">{formatRelative(lastFailure)}</Text>
                </Tooltip>
            </Table.Td>
            <Table.Td>
                <Button
                    aria-expanded={expanded}
                    aria-label={`View details for ${name}`}
                    onClick={() => onSelect(subscription.feedId)}
                    size="xs"
                    variant="default"
                >
                    Details
                </Button>
            </Table.Td>
        </Table.Tr>
    );
});

function SubscriptionWorkspace({
    view,
}: {
    readonly view: 'overview' | 'audit';
}) {
    const management = useQuery(subscriptionManagementQueryOptions);
    const data = management.data;
    const [search, setSearch] = useState('');
    // The table filters against a deferred copy so typing stays responsive.
    const deferredSearch = useDeferredValue(search);
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
        const normalized = deferredSearch.trim().toLocaleLowerCase();
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
    }, [
        category,
        deferredSearch,
        sortDirection,
        sortField,
        status,
        subscriptions,
    ]);

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

    const sidebar = (
        <>
            <ApplicationSidebarHeader title="Subscriptions" />
            <ApplicationSidebarNavigation>
                <NavLink
                    active={view === 'overview'}
                    component={Link}
                    label="Overview"
                    leftSection={<IconListDetails size={16} stroke={1.5} />}
                    to="/settings/subscriptions/overview"
                />
                <NavLink
                    active={view === 'audit'}
                    component={Link}
                    label="Feed audit"
                    leftSection={<IconTable size={16} stroke={1.5} />}
                    to="/settings/subscriptions"
                />
            </ApplicationSidebarNavigation>
        </>
    );

    return (
        <ApplicationPage activePage="subscriptions" sidebar={sidebar}>
            <SubscriptionDrawer
                onClose={() => setSelectedFeedId(null)}
                onMoved={setSelectedFeedId}
                subscription={selected}
            />
            <ApplicationContent
                title={
                    view === 'overview' ? 'Subscription overview' : 'Feed audit'
                }
            >
                {view === 'overview' && (
                    <>
                        {management.isError && data !== undefined && (
                            <Alert
                                color="red"
                                title="Subscription data may be outdated"
                            >
                                {management.error.message}
                            </Alert>
                        )}
                        {management.isPending && data === undefined && (
                            <Paper className={classes.auditSurface} p={0}>
                                <Group
                                    className={classes.stateRegion}
                                    role="status"
                                >
                                    <Loader size="sm" />
                                    <Text size="sm">
                                        Loading subscriptions…
                                    </Text>
                                </Group>
                            </Paper>
                        )}
                        {management.isError && data === undefined && (
                            <Alert
                                color="red"
                                title="Subscriptions are unavailable"
                            >
                                {management.error.message}
                            </Alert>
                        )}
                        {data !== undefined && (
                            <SubscriptionOverview
                                categories={categories}
                                onSelect={setSelectedFeedId}
                                subscriptions={subscriptions}
                            />
                        )}
                    </>
                )}

                {view === 'audit' && (
                    <Paper className={classes.auditSurface} p={0}>
                        <section aria-label="Filters">
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
                                                <IconArrowNarrowDown
                                                    size={18}
                                                />
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
                            <Group
                                className={classes.stateRegion}
                                role="status"
                            >
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
                                    <Group gap="sm">
                                        <Text c="dimmed" size="xs">
                                            {`${filtered.length.toLocaleString()} of ${subscriptions.length.toLocaleString()} feeds`}
                                        </Text>
                                        {management.isFetching && (
                                            <Group gap="xs" role="status">
                                                <Loader size="xs" />
                                                <Text c="dimmed" size="xs">
                                                    Updating…
                                                </Text>
                                            </Group>
                                        )}
                                    </Group>
                                    <Button
                                        color="gray"
                                        onClick={resetFilters}
                                        size="compact-xs"
                                        variant="subtle"
                                    >
                                        Reset filters
                                    </Button>
                                </div>
                                <Table.ScrollContainer minWidth={980}>
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
                                                    <Group
                                                        align="center"
                                                        gap={4}
                                                    >
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
                                                    <Group
                                                        align="center"
                                                        gap={4}
                                                    >
                                                        Last success
                                                        {renderSortIndicator(
                                                            'lastSuccess',
                                                        )}
                                                    </Group>
                                                </Table.Th>
                                                <Table.Th>
                                                    <Group
                                                        align="center"
                                                        gap={4}
                                                    >
                                                        Last failure
                                                        {renderSortIndicator(
                                                            'lastFailure',
                                                        )}
                                                    </Group>
                                                </Table.Th>
                                                <Table.Th>Actions</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {filtered.length === 0 && (
                                                <Table.Tr>
                                                    <Table.Td colSpan={7}>
                                                        <Text
                                                            c="dimmed"
                                                            size="sm"
                                                            ta="center"
                                                        >
                                                            No subscriptions
                                                            match the current
                                                            filters.
                                                        </Text>
                                                    </Table.Td>
                                                </Table.Tr>
                                            )}
                                            {filtered.map((subscription) => (
                                                <SubscriptionAuditRow
                                                    expanded={
                                                        selectedFeedId ===
                                                        subscription.feedId
                                                    }
                                                    key={subscription.feedId}
                                                    onSelect={setSelectedFeedId}
                                                    subscription={subscription}
                                                />
                                            ))}
                                        </Table.Tbody>
                                    </Table>
                                </Table.ScrollContainer>
                            </>
                        )}
                    </Paper>
                )}
            </ApplicationContent>
        </ApplicationPage>
    );
}

export function SubscriptionsPage() {
    return <SubscriptionWorkspace view="audit" />;
}

export function SubscriptionOverviewPage() {
    return <SubscriptionWorkspace view="overview" />;
}

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
    UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconAdjustmentsHorizontal,
    IconArrowNarrowDown,
    IconArrowNarrowUp,
    IconArrowsExchange,
    IconChevronRight,
    IconListDetails,
    IconRefresh,
    IconSearch,
    IconTable,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    type FormEvent,
    memo,
    type ReactNode,
    useDeferredValue,
    useId,
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
type SortField = 'status' | 'name' | 'entries' | 'lastSuccess' | 'lastFailure';

export const subscriptionStatusFilterOptions = [
    { label: 'Healthy', value: 'healthy' },
    { label: 'Failing', value: 'failing' },
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
    return nextField === 'name' || nextField === 'status' ? 'asc' : 'desc';
}

// Ascending status order puts the feeds that need a fix first.
const statusSortRank: Record<SubscriptionStatus, number> = {
    failing: 0,
    gone: 1,
    never: 2,
    healthy: 3,
};

const defaultSortField: SortField = 'status';
const defaultSortDirection: SortDirection = 'asc';

export function compareSubscriptions(
    left: ManagedSubscription,
    right: ManagedSubscription,
    field: SortField,
    direction: SortDirection,
): number {
    const sign = direction === 'asc' ? 1 : -1;
    const byField =
        field === 'status'
            ? statusSortRank[getSubscriptionStatus(left)] -
              statusSortRank[getSubscriptionStatus(right)]
            : field === 'entries'
              ? left.entryCount - right.entryCount
              : field === 'lastSuccess'
                ? (left.lastSuccessfulRefreshAt ?? 0) -
                  (right.lastSuccessfulRefreshAt ?? 0)
                : field === 'lastFailure'
                  ? (left.lastFailedRefreshAt ?? 0) -
                    (right.lastFailedRefreshAt ?? 0)
                  : 0;
    if (byField !== 0) return sign * byField;
    // Names break ties, and sort the name field itself.
    const byName = (left.customFeedName ?? left.feedName).localeCompare(
        right.customFeedName ?? right.feedName,
    );
    return field === 'name' ? sign * byName : byName;
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

const statusPresentation = {
    healthy: { label: 'Healthy', color: 'green' },
    failing: { label: 'Failing', color: 'red' },
    never: { label: 'Never refreshed', color: 'gray' },
    gone: { label: 'Gone', color: 'gray' },
} as const satisfies Record<
    SubscriptionStatus,
    { readonly label: string; readonly color: string }
>;

function StatusBadge({ subscription }: { subscription: ManagedSubscription }) {
    const presentation =
        statusPresentation[getSubscriptionStatus(subscription)];
    return (
        <Badge color={presentation.color} radius="sm" variant="light">
            {presentation.label}
        </Badge>
    );
}

/** A dot and a word: quieter than a badge on every row of a long table. */
function StatusLabel({ status }: { readonly status: SubscriptionStatus }) {
    return (
        <span className={classes.statusLabel} data-status={status}>
            <span className={classes.statusText}>
                {statusPresentation[status].label}
            </span>
        </span>
    );
}

/** What is wrong with a feed, in one line, or null when nothing is. */
export function subscriptionIssue(
    subscription: ManagedSubscription,
): string | null {
    if (subscription.movedToUrl !== null) return 'Moved to a new feed URL';
    const status = getSubscriptionStatus(subscription);
    if (status !== 'failing' && status !== 'gone') return null;
    return (
        subscription.lastErrorMessage ??
        subscription.lastErrorClass ??
        (status === 'gone'
            ? 'Feed is no longer available.'
            : `${subscription.consecutiveFailures.toLocaleString()} consecutive refresh failures`)
    );
}

export function feedInitial(name: string): string {
    return /[\p{L}\p{N}]/u.exec(name)?.[0].toLocaleUpperCase() ?? '#';
}

/**
 * Every favicon sits in the same 20px frame, and a feed without one (or
 * whose image fails) shows its initial, so names line up in a column.
 */
function FeedIcon({
    isDark,
    name,
    src,
}: {
    readonly isDark: boolean | null;
    readonly name: string;
    readonly src: string | null;
}) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const showImage = src !== null && src !== failedSrc;
    return (
        <span
            aria-hidden="true"
            className={classes.feedIcon}
            data-dark={(showImage && isDark === true) || undefined}
        >
            {showImage ? (
                <img
                    alt=""
                    height={16}
                    loading="lazy"
                    onError={() => setFailedSrc(src)}
                    src={src}
                    width={16}
                />
            ) : (
                feedInitial(name)
            )}
        </span>
    );
}

function SubscriptionOverview({
    categories,
    onSelect,
    selectedFeedId,
    subscriptions,
}: {
    readonly categories: readonly ManagedCategory[];
    readonly onSelect: (feedId: number) => void;
    readonly selectedFeedId: number | null;
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
    const attentionSubscriptions = subscriptions
        .filter(
            (subscription) => getSubscriptionStatus(subscription) !== 'healthy',
        )
        .toSorted((left, right) =>
            compareSubscriptions(left, right, 'status', 'asc'),
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
                            Failing or gone
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
                    <SubscriptionTable
                        onSelect={onSelect}
                        selectedFeedId={selectedFeedId}
                        subscriptions={attentionSubscriptions}
                    />
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
 * and lets the user switch to any other URL. A switch keeps read and favorite
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
                            ? 'Some favorites are only in the old feed, so the old subscription was kept.'
                            : 'Read state and favorites were carried over.',
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
                            description="Read state and favorites carry over to the new feed."
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

function displayName(subscription: ManagedSubscription): string {
    return subscription.customFeedName ?? subscription.feedName;
}

function RefreshTime({ timestamp }: { readonly timestamp: number | null }) {
    if (timestamp === null) return 'Never';
    return (
        <>
            {formatRelative(timestamp)}{' '}
            <Text c="dimmed" component="span" size="sm">
                ({formatAbsolute(timestamp)})
            </Text>
        </>
    );
}

/** The details the table leaves out: links, both refresh times, the
 * original name of a renamed feed. */
function SubscriptionFacts({
    subscription,
}: {
    readonly subscription: ManagedSubscription;
}) {
    return (
        <dl className={classes.facts}>
            <dt>Category</dt>
            <dd>{subscription.categoryName}</dd>
            <dt>Entries</dt>
            <dd>{subscription.entryCount.toLocaleString()}</dd>
            {subscription.customFeedName !== null && (
                <>
                    <dt>Original name</dt>
                    <dd>{subscription.feedName}</dd>
                </>
            )}
            <dt>Last success</dt>
            <dd>
                <RefreshTime timestamp={subscription.lastSuccessfulRefreshAt} />
            </dd>
            <dt>Last failure</dt>
            <dd>
                <RefreshTime timestamp={subscription.lastFailedRefreshAt} />
            </dd>
            {subscription.siteUrl !== null && (
                <>
                    <dt>Website</dt>
                    <dd>
                        <Anchor
                            href={subscription.siteUrl}
                            rel="noreferrer"
                            size="sm"
                            target="_blank"
                        >
                            {subscription.siteUrl}
                        </Anchor>
                    </dd>
                </>
            )}
            <dt>Feed</dt>
            <dd>
                <Anchor
                    href={subscription.feedUrl}
                    rel="noreferrer"
                    size="sm"
                    target="_blank"
                >
                    {subscription.feedUrl}
                </Anchor>
            </dd>
        </dl>
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
                subscription === null ? (
                    'Subscription'
                ) : (
                    <span className={classes.drawerTitle}>
                        <FeedIcon
                            isDark={subscription.faviconIsDark}
                            name={displayName(subscription)}
                            src={subscription.faviconUrl}
                        />
                        <span>{displayName(subscription)}</span>
                    </span>
                )
            }
        >
            {subscription !== null && (
                <Stack gap="md">
                    <Group align="center" justify="space-between">
                        <StatusBadge subscription={subscription} />
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

                    <SubscriptionFacts subscription={subscription} />

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
    const name = displayName(subscription);
    const status = getSubscriptionStatus(subscription);
    const issue = subscriptionIssue(subscription);
    const lastSuccess = subscription.lastSuccessfulRefreshAt;
    const entries = `${subscription.entryCount.toLocaleString()} entries`;
    return (
        // The whole row opens the drawer. The name is the row's button, so
        // keyboard and screen reader users reach it as one control, and its
        // click bubbles up to this handler.
        <Table.Tr
            className={classes.row}
            data-selected={expanded || undefined}
            onClick={(event) => {
                // A mouse drag that selects text is not a click on the row.
                if (
                    event.detail > 0 &&
                    window.getSelection()?.isCollapsed === false
                ) {
                    return;
                }
                onSelect(subscription.feedId);
            }}
        >
            <Table.Td className={classes.feedCell}>
                <div className={classes.feed}>
                    <FeedIcon
                        isDark={subscription.faviconIsDark}
                        name={name}
                        src={subscription.faviconUrl}
                    />
                    <div className={classes.feedText}>
                        <button
                            aria-expanded={expanded}
                            aria-haspopup="dialog"
                            aria-label={`View details for ${name}`}
                            className={classes.rowButton}
                            title={
                                subscription.customFeedName === null
                                    ? undefined
                                    : `Renamed from ${subscription.feedName}`
                            }
                            type="button"
                        >
                            {name}
                        </button>
                        {/* The second line of the phone layout. */}
                        <div className={classes.phoneMeta}>
                            {issue !== null ? (
                                <span className={classes.phoneIssue}>
                                    {issue}
                                </span>
                            ) : (
                                [
                                    subscription.categoryName,
                                    entries,
                                    lastSuccess === null
                                        ? null
                                        : formatRelative(lastSuccess),
                                ]
                                    .filter((part) => part !== null)
                                    .join(' · ')
                            )}
                        </div>
                    </div>
                </div>
            </Table.Td>
            <Table.Td className={classes.categoryCell}>
                {subscription.categoryName}
            </Table.Td>
            <Table.Td className={classes.entriesCell}>
                {subscription.entryCount.toLocaleString()}
            </Table.Td>
            <Table.Td className={classes.statusCell}>
                <div className={classes.status}>
                    <StatusLabel status={status} />
                    {issue !== null && (
                        <span className={classes.issue} title={issue}>
                            {issue}
                        </span>
                    )}
                </div>
            </Table.Td>
            <Table.Td className={classes.timeCell}>
                <div className={classes.time}>
                    <time
                        dateTime={
                            lastSuccess === null
                                ? undefined
                                : new Date(lastSuccess).toISOString()
                        }
                        title={`Last success: ${formatAbsolute(lastSuccess)}\nLast failure: ${formatAbsolute(subscription.lastFailedRefreshAt)}`}
                    >
                        {formatRelative(lastSuccess)}
                    </time>
                    <IconChevronRight
                        aria-hidden="true"
                        className={classes.chevron}
                        size={16}
                        stroke={1.5}
                    />
                </div>
            </Table.Td>
        </Table.Tr>
    );
});

interface TableSort {
    readonly field: SortField;
    readonly direction: SortDirection;
    readonly onSort: (field: SortField) => void;
}

function SortableHeader({
    className,
    field,
    label,
    sort,
}: {
    readonly className?: string;
    readonly field: SortField;
    readonly label: string;
    readonly sort: TableSort | undefined;
}) {
    if (sort === undefined) {
        return <Table.Th className={className}>{label}</Table.Th>;
    }
    const active = sort.field === field;
    return (
        <Table.Th
            aria-sort={
                active
                    ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                    : undefined
            }
            className={className}
        >
            <UnstyledButton
                className={classes.sortButton}
                onClick={() => sort.onSort(field)}
            >
                {label}
                {active &&
                    (sort.direction === 'asc' ? (
                        <IconArrowNarrowUp
                            aria-label="Sorted ascending"
                            size={14}
                        />
                    ) : (
                        <IconArrowNarrowDown
                            aria-label="Sorted descending"
                            size={14}
                        />
                    ))}
            </UnstyledButton>
        </Table.Th>
    );
}

function SubscriptionTable({
    emptyState,
    onSelect,
    selectedFeedId,
    sort,
    subscriptions,
}: {
    readonly emptyState?: ReactNode;
    readonly onSelect: (feedId: number) => void;
    readonly selectedFeedId: number | null;
    readonly sort?: TableSort;
    readonly subscriptions: readonly ManagedSubscription[];
}) {
    return (
        <Table
            className={`${classes.table} ${classes.auditTable}`}
            highlightOnHover
        >
            <Table.Thead>
                <Table.Tr>
                    <SortableHeader field="name" label="Feed" sort={sort} />
                    <Table.Th className={classes.categoryCell}>
                        Category
                    </Table.Th>
                    <SortableHeader
                        className={classes.entriesCell}
                        field="entries"
                        label="Entries"
                        sort={sort}
                    />
                    <SortableHeader
                        className={classes.statusCell}
                        field="status"
                        label="Status"
                        sort={sort}
                    />
                    <SortableHeader
                        className={classes.timeCell}
                        field="lastSuccess"
                        label="Last success"
                        sort={sort}
                    />
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {subscriptions.length === 0 && (
                    <Table.Tr className={classes.emptyRow}>
                        <Table.Td colSpan={5}>
                            {emptyState ?? (
                                <Text c="dimmed" size="sm" ta="center">
                                    No subscriptions match the current filters.
                                </Text>
                            )}
                        </Table.Td>
                    </Table.Tr>
                )}
                {subscriptions.map((subscription) => (
                    <SubscriptionAuditRow
                        expanded={selectedFeedId === subscription.feedId}
                        key={subscription.feedId}
                        onSelect={onSelect}
                        subscription={subscription}
                    />
                ))}
            </Table.Tbody>
        </Table>
    );
}

const sortOptions = [
    { label: 'Status', value: 'status' },
    { label: 'Name', value: 'name' },
    { label: 'Entries', value: 'entries' },
    { label: 'Last success', value: 'lastSuccess' },
    { label: 'Last failure', value: 'lastFailure' },
] as const satisfies readonly {
    readonly label: string;
    readonly value: SortField;
}[];

/**
 * Search, filters and sort in one row above the table. Below 40rem the
 * filters fold behind a button so the feeds start on the first screen.
 */
function AuditToolbar({
    categories,
    category,
    filteredCount,
    isFetching,
    onCategoryChange,
    onReset,
    onSearchChange,
    onSortDirectionToggle,
    onSortFieldChange,
    onStatusChange,
    search,
    sortDirection,
    sortField,
    status,
    totalCount,
}: {
    readonly categories: readonly ManagedCategory[];
    readonly category: string;
    readonly filteredCount: number;
    readonly isFetching: boolean;
    readonly onCategoryChange: (category: string) => void;
    readonly onReset: () => void;
    readonly onSearchChange: (search: string) => void;
    readonly onSortDirectionToggle: () => void;
    readonly onSortFieldChange: (field: SortField) => void;
    readonly onStatusChange: (status: SubscriptionStatus | 'all') => void;
    readonly search: string;
    readonly sortDirection: SortDirection;
    readonly sortField: SortField;
    readonly status: SubscriptionStatus | 'all';
    readonly totalCount: number;
}) {
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filtersId = useId();
    // Search stays visible on a phone, so it does not count here.
    const hiddenFilterCount =
        Number(category !== 'all') +
        Number(status !== 'all') +
        Number(
            sortField !== defaultSortField ||
                sortDirection !== defaultSortDirection,
        );
    const filtersActive = search !== '' || hiddenFilterCount > 0;
    const feeds = (count: number) =>
        `${count.toLocaleString()} ${count === 1 ? 'feed' : 'feeds'}`;

    return (
        <section aria-label="Filters" className={classes.toolbar}>
            <TextInput
                aria-label="Search feeds"
                className={classes.search}
                leftSection={<IconSearch aria-hidden="true" size={16} />}
                onChange={(event) => onSearchChange(event.currentTarget.value)}
                placeholder="Search name or URL"
                value={search}
            />
            <Button
                aria-controls={filtersId}
                aria-expanded={filtersOpen}
                className={classes.filtersToggle}
                leftSection={<IconAdjustmentsHorizontal size={16} />}
                onClick={() => setFiltersOpen((open) => !open)}
                variant="default"
            >
                {hiddenFilterCount > 0
                    ? `Filters (${hiddenFilterCount})`
                    : 'Filters'}
            </Button>
            <div
                className={classes.filterControls}
                data-open={filtersOpen || undefined}
                id={filtersId}
            >
                <Select
                    allowDeselect={false}
                    aria-label="Category"
                    className={classes.categorySelect}
                    data={[
                        { label: 'All categories', value: 'all' },
                        ...categories.map((item) => ({
                            label: item.name,
                            value: String(item.id),
                        })),
                    ]}
                    onChange={(value) => onCategoryChange(value ?? 'all')}
                    value={category}
                />
                <Select
                    allowDeselect={false}
                    aria-label="Status"
                    className={classes.statusSelect}
                    data={[
                        { label: 'All statuses', value: 'all' },
                        ...subscriptionStatusFilterOptions,
                    ]}
                    onChange={(value) =>
                        onStatusChange(
                            (value ?? 'all') as SubscriptionStatus | 'all',
                        )
                    }
                    value={status}
                />
                <div className={classes.sortGroup}>
                    <Select
                        allowDeselect={false}
                        aria-label="Sort by"
                        className={classes.sortSelect}
                        data={sortOptions}
                        leftSection={
                            <span className={classes.sortPrefix}>Sort</span>
                        }
                        leftSectionPointerEvents="none"
                        leftSectionWidth={42}
                        onChange={(value) => {
                            if (value !== null) {
                                onSortFieldChange(value as SortField);
                            }
                        }}
                        value={sortField}
                    />
                    <Tooltip
                        label={
                            sortDirection === 'asc'
                                ? 'Sort ascending'
                                : 'Sort descending'
                        }
                        withArrow
                    >
                        <ActionIcon
                            aria-label="Toggle sort direction"
                            onClick={onSortDirectionToggle}
                            size="input-sm"
                            variant="default"
                        >
                            {sortDirection === 'asc' ? (
                                <IconArrowNarrowUp size={18} />
                            ) : (
                                <IconArrowNarrowDown size={18} />
                            )}
                        </ActionIcon>
                    </Tooltip>
                </div>
                {filtersActive && (
                    <Button
                        className={classes.resetButton}
                        color="gray"
                        onClick={onReset}
                        variant="subtle"
                    >
                        Reset
                    </Button>
                )}
            </div>
            <div className={classes.count}>
                <span>
                    {filteredCount === totalCount
                        ? feeds(totalCount)
                        : `${filteredCount.toLocaleString()} of ${feeds(totalCount)}`}
                </span>
                {isFetching && (
                    <span className={classes.updating} role="status">
                        <Loader size={12} />
                        Updating…
                    </span>
                )}
            </div>
        </section>
    );
}

const subscriptionViews = [
    {
        view: 'overview',
        label: 'Overview',
        icon: IconListDetails,
        to: '/settings/subscriptions/overview',
    },
    {
        view: 'audit',
        label: 'Feed audit',
        icon: IconTable,
        to: '/settings/subscriptions',
    },
] as const;

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
    const [sortField, setSortField] = useState<SortField>(defaultSortField);
    const [sortDirection, setSortDirection] =
        useState<SortDirection>(defaultSortDirection);
    const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);

    const subscriptions = data?.subscriptions ?? [];
    const categories = data?.categories ?? [];
    const selected =
        subscriptions.find((item) => item.feedId === selectedFeedId) ?? null;

    const filtered = useMemo(() => {
        const normalized = deferredSearch.trim().toLocaleLowerCase();
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
            .toSorted((left, right) =>
                compareSubscriptions(left, right, sortField, sortDirection),
            );
    }, [
        category,
        deferredSearch,
        sortDirection,
        sortField,
        status,
        subscriptions,
    ]);

    const handleSortFieldChange = (nextField: SortField) => {
        setSortField(nextField);
        setSortDirection((currentDirection) =>
            nextSubscriptionSortDirection(
                sortField,
                currentDirection,
                nextField,
            ),
        );
    };

    const handleSort = (field: SortField) => {
        if (field === sortField) {
            setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
            return;
        }
        handleSortFieldChange(field);
    };

    const isFiltered = search !== '' || category !== 'all' || status !== 'all';

    const resetFilters = () => {
        setSearch('');
        setCategory('all');
        setStatus('all');
        setSortField(defaultSortField);
        setSortDirection(defaultSortDirection);
    };

    const sidebar = (
        <>
            <ApplicationSidebarHeader title="Subscriptions" />
            <ApplicationSidebarNavigation>
                {subscriptionViews.map((item) => {
                    const Icon = item.icon;
                    const active = view === item.view;
                    return (
                        <NavLink
                            active={active}
                            aria-current={active ? 'page' : undefined}
                            component={Link}
                            key={item.view}
                            label={item.label}
                            leftSection={
                                <Icon
                                    aria-hidden="true"
                                    size={16}
                                    stroke={1.5}
                                />
                            }
                            to={item.to}
                        />
                    );
                })}
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
                                selectedFeedId={selectedFeedId}
                                subscriptions={subscriptions}
                            />
                        )}
                    </>
                )}

                {view === 'audit' && (
                    <Paper className={classes.auditSurface} p={0}>
                        <AuditToolbar
                            categories={categories}
                            category={category}
                            filteredCount={filtered.length}
                            isFetching={
                                data !== undefined && management.isFetching
                            }
                            onCategoryChange={setCategory}
                            onReset={resetFilters}
                            onSearchChange={setSearch}
                            onSortDirectionToggle={() =>
                                setSortDirection((current) =>
                                    current === 'asc' ? 'desc' : 'asc',
                                )
                            }
                            onSortFieldChange={handleSortFieldChange}
                            onStatusChange={setStatus}
                            search={search}
                            sortDirection={sortDirection}
                            sortField={sortField}
                            status={status}
                            totalCount={subscriptions.length}
                        />

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
                            <SubscriptionTable
                                onSelect={setSelectedFeedId}
                                selectedFeedId={selectedFeedId}
                                sort={{
                                    field: sortField,
                                    direction: sortDirection,
                                    onSort: handleSort,
                                }}
                                emptyState={
                                    <Stack align="center" gap="xs">
                                        <Text c="dimmed" size="sm">
                                            No subscriptions match the current
                                            filters.
                                        </Text>
                                        {/* On a phone the toolbar's Reset is
                                            folded away with the filters. */}
                                        {isFiltered && (
                                            <Button
                                                onClick={resetFilters}
                                                size="xs"
                                                variant="default"
                                            >
                                                Reset filters
                                            </Button>
                                        )}
                                    </Stack>
                                }
                                subscriptions={filtered}
                            />
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

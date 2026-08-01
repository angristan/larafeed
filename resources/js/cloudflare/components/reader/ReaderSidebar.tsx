import {
    Alert,
    Badge,
    Button,
    Divider,
    Group,
    NavLink,
    ScrollArea,
    Skeleton,
    Stack,
    Text,
    TextInput,
} from '@mantine/core';
import {
    IconBook2,
    IconCategory,
    IconFileImport,
    IconKey,
    IconRefresh,
    IconSearch,
    IconSettings,
    IconStar,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import type {
    ReaderCategoryList,
    ReaderCounts,
    ReaderSubscriptionList,
} from '../../api/reader';
import { type ReaderState, readerHref } from '../../readerState';
import { FeedFavicon } from './FeedFavicon';
import classes from './Reader.module.css';

interface ReaderSidebarProps {
    readonly state: ReaderState;
    readonly categories: ReaderCategoryList['categories'] | undefined;
    readonly subscriptions: ReaderSubscriptionList['subscriptions'] | undefined;
    readonly counts: ReaderCounts | undefined;
    readonly isPending: boolean;
    readonly error: Error | null;
    readonly onRetry: () => void;
    readonly onNavigate?: () => void;
}

const filters = [
    { value: 'all', label: 'All entries', icon: IconBook2 },
    { value: 'unread', label: 'Unread', icon: IconBook2 },
    { value: 'read', label: 'Read', icon: IconBook2 },
    { value: 'favorites', label: 'Favorites', icon: IconStar },
] as const;

function filterCount(
    filter: (typeof filters)[number]['value'],
    counts: ReaderCounts | undefined,
): number | undefined {
    if (counts === undefined) {
        return undefined;
    }

    switch (filter) {
        case 'all':
            return counts.total;
        case 'unread':
            return counts.unread;
        case 'read':
            return counts.read;
        case 'favorites':
            return counts.starred;
    }
}

export function ReaderSidebar({
    state,
    categories,
    subscriptions,
    counts,
    isPending,
    error,
    onRetry,
    onNavigate,
}: ReaderSidebarProps) {
    const [search, setSearch] = useState('');
    const searchInput = useRef<HTMLInputElement>(null);
    const normalizedSearch = search.trim().toLocaleLowerCase();

    useEffect(() => {
        const focusSearch = (event: KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === 'k'
            ) {
                event.preventDefault();
                searchInput.current?.focus();
            }
        };

        window.addEventListener('keydown', focusSearch);
        return () => window.removeEventListener('keydown', focusSearch);
    }, []);

    const subscriptionsByCategory = useMemo(() => {
        const grouped = new Map<
            number,
            ReaderSubscriptionList['subscriptions']
        >();
        for (const subscription of subscriptions ?? []) {
            if (
                normalizedSearch.length > 0 &&
                !`${subscription.customFeedName ?? ''} ${subscription.feedName}`
                    .toLocaleLowerCase()
                    .includes(normalizedSearch)
            ) {
                continue;
            }

            const current = grouped.get(subscription.categoryId) ?? [];
            grouped.set(subscription.categoryId, [...current, subscription]);
        }
        return grouped;
    }, [normalizedSearch, subscriptions]);

    const sortedCategories = useMemo(
        () =>
            [...(categories ?? [])].sort((left, right) =>
                left.name.localeCompare(right.name),
            ),
        [categories],
    );

    return (
        <>
            <Stack gap="sm" p="md">
                <TextInput
                    ref={searchInput}
                    aria-label="Search feeds"
                    leftSection={<IconSearch aria-hidden="true" size={15} />}
                    placeholder="Search feeds"
                    rightSection={
                        <Text aria-hidden="true" c="dimmed" size="xs">
                            ⌘K
                        </Text>
                    }
                    rightSectionWidth={40}
                    size="sm"
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setSearch('');
                            event.currentTarget.blur();
                        }
                    }}
                />

                <Stack gap={2} aria-label="Entry filters">
                    {filters.map((filter) => {
                        const Icon = filter.icon;
                        const count = filterCount(filter.value, counts);
                        return (
                            <NavLink
                                key={filter.value}
                                active={state.filter === filter.value}
                                component={Link}
                                label={filter.label}
                                leftSection={
                                    <Icon aria-hidden="true" size={17} />
                                }
                                onClick={onNavigate}
                                rightSection={
                                    count === undefined ? null : (
                                        <Badge
                                            aria-label={`${count} entries`}
                                            color="gray"
                                            size="sm"
                                            variant="light"
                                        >
                                            {count}
                                        </Badge>
                                    )
                                }
                                to={readerHref(state, {
                                    filter: filter.value,
                                })}
                            />
                        );
                    })}
                </Stack>
            </Stack>

            <Divider />

            <Group justify="space-between" px="md" py="sm">
                <Text c="dimmed" fw={600} size="xs" tt="uppercase">
                    Feeds
                </Text>
                <Text c="dimmed" size="xs">
                    {subscriptions?.length ?? 0}
                </Text>
            </Group>

            <ScrollArea className={classes.sidebarScroll} offsetScrollbars="y">
                <Stack gap={2} px="sm" pb="md">
                    {isPending &&
                        [
                            'first',
                            'second',
                            'third',
                            'fourth',
                            'fifth',
                            'sixth',
                        ].map((key) => (
                            <Skeleton key={key} height={34} radius="sm" />
                        ))}

                    {error !== null && categories === undefined && (
                        <Alert color="red" title="Feeds unavailable">
                            <Stack gap="xs">
                                <Text size="sm">{error.message}</Text>
                                <Button
                                    leftSection={
                                        <IconRefresh
                                            aria-hidden="true"
                                            size={15}
                                        />
                                    }
                                    onClick={onRetry}
                                    size="xs"
                                    variant="light"
                                >
                                    Retry
                                </Button>
                            </Stack>
                        </Alert>
                    )}

                    {!isPending &&
                        error === null &&
                        subscriptions?.length === 0 && (
                            <Text c="dimmed" px="xs" py="md" size="sm">
                                No feed subscriptions yet.
                            </Text>
                        )}

                    {sortedCategories.map((category) => {
                        const categorySubscriptions =
                            subscriptionsByCategory.get(category.id) ?? [];
                        if (
                            normalizedSearch.length > 0 &&
                            categorySubscriptions.length === 0
                        ) {
                            return null;
                        }

                        const categoryUnread = categorySubscriptions.reduce(
                            (total, subscription) =>
                                total + subscription.unreadCount,
                            0,
                        );
                        const categoryActive =
                            state.categoryId === category.id &&
                            state.feedId === null;

                        return (
                            <div key={category.id}>
                                <NavLink
                                    active={categoryActive}
                                    label={category.name}
                                    leftSection={
                                        <IconCategory
                                            aria-hidden="true"
                                            size={16}
                                        />
                                    }
                                    component={Link}
                                    onClick={onNavigate}
                                    rightSection={
                                        categoryUnread > 0 ? (
                                            <Badge
                                                color="gray"
                                                size="sm"
                                                variant="light"
                                            >
                                                {categoryUnread}
                                            </Badge>
                                        ) : null
                                    }
                                    to={readerHref(state, {
                                        categoryId: categoryActive
                                            ? null
                                            : category.id,
                                    })}
                                />
                                <Stack gap={2} pl="lg">
                                    {categorySubscriptions.map(
                                        (subscription) => {
                                            const feedActive =
                                                state.feedId ===
                                                subscription.feedId;
                                            const feedName =
                                                subscription.customFeedName ??
                                                subscription.feedName;

                                            return (
                                                <NavLink
                                                    key={subscription.feedId}
                                                    active={feedActive}
                                                    component={Link}
                                                    label={feedName}
                                                    leftSection={
                                                        <FeedFavicon
                                                            src={
                                                                subscription.faviconUrl
                                                            }
                                                            isDark={
                                                                subscription.faviconIsDark
                                                            }
                                                        />
                                                    }
                                                    onClick={onNavigate}
                                                    rightSection={
                                                        subscription.unreadCount >
                                                        0 ? (
                                                            <Badge
                                                                color="blue"
                                                                size="sm"
                                                                variant="light"
                                                            >
                                                                {
                                                                    subscription.unreadCount
                                                                }
                                                            </Badge>
                                                        ) : null
                                                    }
                                                    to={readerHref(state, {
                                                        feedId: feedActive
                                                            ? null
                                                            : subscription.feedId,
                                                    })}
                                                />
                                            );
                                        },
                                    )}
                                </Stack>
                            </div>
                        );
                    })}

                    {!isPending &&
                        normalizedSearch.length > 0 &&
                        [...subscriptionsByCategory.values()].every(
                            (items) => items.length === 0,
                        ) && (
                            <Text c="dimmed" px="xs" py="md" size="sm">
                                No feeds match “{search.trim()}”.
                            </Text>
                        )}
                </Stack>
            </ScrollArea>

            <Divider />
            <Stack gap={2} p="sm">
                <NavLink
                    component={Link}
                    label="Manage subscriptions"
                    leftSection={<IconSettings aria-hidden="true" size={17} />}
                    onClick={onNavigate}
                    to="/settings/subscriptions"
                />
                <NavLink
                    component={Link}
                    label="Import & export"
                    leftSection={
                        <IconFileImport aria-hidden="true" size={17} />
                    }
                    onClick={onNavigate}
                    to="/settings/opml"
                />
                <NavLink
                    component={Link}
                    label="Reader app tokens"
                    leftSection={<IconKey aria-hidden="true" size={17} />}
                    onClick={onNavigate}
                    to="/settings/app-tokens"
                />
            </Stack>
        </>
    );
}

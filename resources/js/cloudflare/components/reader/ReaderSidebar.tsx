import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Code,
    Divider,
    Group,
    NavLink,
    ScrollArea,
    Skeleton,
    Stack,
    Text,
    TextInput,
    Tooltip,
} from '@mantine/core';
import {
    IconBook,
    IconCheckbox,
    IconPlus,
    IconRefresh,
    IconRss,
    IconSearch,
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
import classes from './ReaderSidebar.module.css';

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
    { value: 'unread', label: 'Unread', icon: IconBook },
    { value: 'read', label: 'Read', icon: IconCheckbox },
    { value: 'favorites', label: 'Favorites', icon: IconStar },
] as const;

function filterCount(
    filter: (typeof filters)[number]['value'],
    counts: ReaderCounts | undefined,
): number | undefined {
    if (counts === undefined) return undefined;
    switch (filter) {
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
            const name = `${subscription.customFeedName ?? ''} ${subscription.feedName}`;
            if (
                normalizedSearch.length > 0 &&
                !name.toLocaleLowerCase().includes(normalizedSearch)
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
            <Stack gap={0} px="md" pt="md">
                <TextInput
                    ref={searchInput}
                    aria-label="Search feeds"
                    classNames={{ input: classes.searchInput }}
                    leftSection={<IconSearch aria-hidden="true" size={12} />}
                    mb="sm"
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setSearch('');
                            event.currentTarget.blur();
                        }
                    }}
                    placeholder="Search"
                    rightSection={
                        <Code className={classes.searchCode}>⌘ K</Code>
                    }
                    rightSectionWidth={46}
                    size="xs"
                    value={search}
                />

                <Stack aria-label="Entry filters" gap={2} pb="md">
                    {filters.map((filter) => {
                        const Icon = filter.icon;
                        const active = state.filter === filter.value;
                        const count = filterCount(filter.value, counts);
                        return (
                            <NavLink
                                key={filter.value}
                                active={active}
                                className={classes.mainLink}
                                component={Link}
                                label={filter.label}
                                leftSection={
                                    <Icon aria-hidden="true" size={20} />
                                }
                                onClick={onNavigate}
                                rightSection={
                                    count !== undefined && count > 0 ? (
                                        <Badge
                                            color={
                                                filter.value === 'unread'
                                                    ? 'blue'
                                                    : 'gray'
                                            }
                                            size="sm"
                                            variant={
                                                filter.value === 'unread'
                                                    ? 'filled'
                                                    : 'default'
                                            }
                                        >
                                            {count}
                                        </Badge>
                                    ) : null
                                }
                                to={readerHref(state, {
                                    filter: active ? 'all' : filter.value,
                                })}
                            />
                        );
                    })}
                </Stack>
            </Stack>

            <Divider mb="sm" />

            <Group
                className={classes.collectionsHeader}
                justify="space-between"
            >
                <Text c="dimmed" fw={500} size="xs">
                    Feeds
                </Text>
                <Tooltip
                    label="Create feed or category"
                    position="right"
                    withArrow
                >
                    <ActionIcon
                        aria-label="Create feed or category"
                        component={Link}
                        size={18}
                        to="/settings/subscriptions"
                        variant="default"
                    >
                        <IconPlus size={12} stroke={1.5} />
                    </ActionIcon>
                </Tooltip>
            </Group>

            <ScrollArea className={classes.sidebarScroll} offsetScrollbars="y">
                <Stack className={classes.collections} gap={2}>
                    {isPending &&
                        ['first', 'second', 'third', 'fourth', 'fifth'].map(
                            (key) => (
                                <Skeleton key={key} height={32} radius="sm" />
                            ),
                        )}

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
                            <Text c="dimmed" px="xs" py="md" size="xs">
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

                        const categoryCount = categorySubscriptions.reduce(
                            (total, subscription) =>
                                total + subscription.unreadCount,
                            0,
                        );
                        const categoryActive =
                            state.categoryId === category.id &&
                            state.feedId === null;

                        return (
                            <NavLink
                                key={category.id}
                                active={categoryActive}
                                childrenOffset={20}
                                className={classes.categoryLink}
                                defaultOpened
                                label={
                                    <Group
                                        gap="xs"
                                        justify="space-between"
                                        wrap="nowrap"
                                    >
                                        <span>{category.name}</span>
                                        {categoryCount > 0 && (
                                            <Badge size="sm" variant="default">
                                                {categoryCount}
                                            </Badge>
                                        )}
                                    </Group>
                                }
                                leftSection={
                                    <IconRss aria-hidden="true" size={15} />
                                }
                                component={Link}
                                onClick={onNavigate}
                                to={readerHref(state, {
                                    categoryId: categoryActive
                                        ? null
                                        : category.id,
                                })}
                            >
                                {categorySubscriptions.map((subscription) => {
                                    const active =
                                        state.feedId === subscription.feedId;
                                    const name =
                                        subscription.customFeedName ??
                                        subscription.feedName;
                                    return (
                                        <NavLink
                                            key={subscription.feedId}
                                            active={active}
                                            className={classes.feedLink}
                                            component={Link}
                                            label={name}
                                            leftSection={
                                                <FeedFavicon
                                                    isDark={
                                                        subscription.faviconIsDark
                                                    }
                                                    size={18}
                                                    src={
                                                        subscription.faviconUrl
                                                    }
                                                />
                                            }
                                            onClick={onNavigate}
                                            rightSection={
                                                subscription.unreadCount > 0 ? (
                                                    <Badge
                                                        size="sm"
                                                        variant="default"
                                                    >
                                                        {
                                                            subscription.unreadCount
                                                        }
                                                    </Badge>
                                                ) : null
                                            }
                                            to={readerHref(state, {
                                                feedId: active
                                                    ? null
                                                    : subscription.feedId,
                                            })}
                                        />
                                    );
                                })}
                            </NavLink>
                        );
                    })}

                    {!isPending &&
                        normalizedSearch.length > 0 &&
                        [...subscriptionsByCategory.values()].every(
                            (items) => items.length === 0,
                        ) && (
                            <Text c="dimmed" px="xs" py="md" size="xs">
                                No feeds match “{search.trim()}”.
                            </Text>
                        )}
                </Stack>
            </ScrollArea>
        </>
    );
}

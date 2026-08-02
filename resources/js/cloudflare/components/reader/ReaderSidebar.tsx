import {
    ActionIcon,
    Alert,
    AppShell,
    Badge,
    Button,
    Code,
    Divider,
    Fieldset,
    Group,
    Indicator,
    Menu,
    Modal,
    NativeSelect,
    NavLink,
    rem,
    ScrollArea,
    SegmentedControl,
    Stack,
    Text,
    TextInput,
    Tooltip,
} from '@mantine/core';
import { useDisclosure, useHover } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconBook,
    IconCategory,
    IconCheck,
    IconCheckbox,
    IconChevronRight,
    IconDots,
    IconExternalLink,
    IconInfoCircle,
    IconPencil,
    IconPhoto,
    IconPlus,
    IconRefresh,
    IconRss,
    IconSearch,
    IconStar,
    IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Effect } from 'effect';
import {
    type FormEvent,
    type ReactNode,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { Link } from 'react-router';

import { readCsrfToken } from '../../api/auth';
import {
    markFeedReadThrough,
    type ReaderCategoryList,
    type ReaderCounts,
    type ReaderSubscriptionList,
} from '../../api/reader';
import { useReadThroughMutation } from '../../queries/readerMutations';
import {
    createCategoryMutationOptions,
    createSubscriptionMutationOptions,
    deleteCategoryMutationOptions,
    refreshFaviconMutationOptions,
    refreshSubscriptionMutationOptions,
    subscriptionManagementQueryOptions,
    unsubscribeMutationOptions,
    updateCategoryMutationOptions,
    updateSubscriptionMutationOptions,
} from '../../queries/subscriptions';
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

function FilterLink({
    label,
    icon,
    count,
    badgeVariant,
    state,
    onNavigate,
}: {
    readonly label: 'Unread' | 'Read' | 'Favorites';
    readonly icon: ReactNode;
    readonly count: number | undefined;
    readonly badgeVariant: 'filled' | 'default';
    readonly state: ReaderState;
    readonly onNavigate?: () => void;
}) {
    const filter = label.toLowerCase() as 'unread' | 'read' | 'favorites';
    const active = state.filter === filter;

    return (
        <Link
            className={`${classes.mainLink} ${active ? classes.activeFeed : ''}`}
            onClick={onNavigate}
            to={readerHref(state, {
                filter: active ? 'all' : filter,
                page: 1,
            })}
        >
            <div className={classes.mainLinkInner}>
                {icon}
                <span>{label}</span>
            </div>
            {count !== undefined && count > 0 && (
                <Badge
                    className={classes.mainLinkBadge}
                    size="sm"
                    variant={badgeVariant}
                >
                    {count}
                </Badge>
            )}
        </Link>
    );
}

function AddFeedModal({
    opened,
    close,
    categories,
}: {
    readonly opened: boolean;
    readonly close: () => void;
    readonly categories: ReaderCategoryList['categories'];
}) {
    const queryClient = useQueryClient();
    const addFeed = useMutation(createSubscriptionMutationOptions(queryClient));
    const addCategory = useMutation(createCategoryMutationOptions(queryClient));
    const [view, setView] = useState('new_feed');
    const [feedUrl, setFeedUrl] = useState('');
    const [categoryId, setCategoryId] = useState(
        categories[0] === undefined ? '' : String(categories[0].id),
    );
    const [categoryName, setCategoryName] = useState('');

    useEffect(() => {
        if (categoryId === '' && categories[0] !== undefined) {
            setCategoryId(String(categories[0].id));
        }
    }, [categories, categoryId]);

    const closeAndReset = () => {
        addFeed.reset();
        addCategory.reset();
        close();
    };

    const submitFeed = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const parsedCategoryId = Number(categoryId);
        if (feedUrl.trim() === '' || !Number.isSafeInteger(parsedCategoryId)) {
            return;
        }
        const normalizedUrl = /^(http|https):\/\//.test(feedUrl.trim())
            ? feedUrl.trim()
            : `https://${feedUrl.trim()}`;
        addFeed.mutate(
            { feedUrl: normalizedUrl, categoryId: parsedCategoryId },
            {
                onSuccess: () => {
                    notifications.show({
                        title: 'Feed added',
                        message: 'The feed has been added',
                        color: 'green',
                        withBorder: true,
                    });
                    closeAndReset();
                },
            },
        );
    };

    const submitCategory = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const name = categoryName.trim();
        if (name === '') return;
        addCategory.mutate(
            { name },
            {
                onSuccess: () => {
                    notifications.show({
                        title: 'Category added',
                        message: 'The category has been added',
                        color: 'green',
                        withBorder: true,
                    });
                    setCategoryName('');
                    closeAndReset();
                },
            },
        );
    };

    return (
        <Modal.Root opened={opened} onClose={closeAndReset}>
            <Modal.Overlay />
            <Modal.Content>
                <Modal.Header>
                    <Modal.Title>
                        <SegmentedControl
                            data={[
                                { value: 'new_feed', label: 'New feed' },
                                {
                                    value: 'new_category',
                                    label: 'New category',
                                },
                            ]}
                            onChange={setView}
                            radius="sm"
                            size="sm"
                            value={view}
                        />
                    </Modal.Title>
                    <Modal.CloseButton />
                </Modal.Header>
                <Modal.Body>
                    <Fieldset variant="filled">
                        {view === 'new_feed' ? (
                            <form onSubmit={submitFeed}>
                                <TextInput
                                    data-autofocus
                                    description={
                                        <Text c="dimmed" size="xs">
                                            You can use the URL of the website
                                            or the URL of the RSS feed, we will
                                            try to find the feed for you!
                                        </Text>
                                    }
                                    error={addFeed.error?.message}
                                    label={
                                        <Group gap={5}>
                                            <IconRss
                                                style={{
                                                    width: rem(10),
                                                    height: rem(10),
                                                }}
                                            />
                                            <span>Feed URL</span>
                                        </Group>
                                    }
                                    onChange={(event) =>
                                        setFeedUrl(event.currentTarget.value)
                                    }
                                    placeholder="https://blog.cloudflare.com/rss/"
                                    value={feedUrl}
                                />
                                <Text c="dimmed" mt="sm" size="xs">
                                    <IconInfoCircle
                                        style={{
                                            width: rem(10),
                                            height: rem(10),
                                        }}
                                    />{' '}
                                    Tip: use the bookmarklet in subscription
                                    settings to add the current website.
                                </Text>
                                <NativeSelect
                                    data={categories.map((category) => ({
                                        value: String(category.id),
                                        label: category.name,
                                    }))}
                                    description={
                                        <Text c="dimmed" size="xs">
                                            The category where the feed will be
                                            added
                                        </Text>
                                    }
                                    label={
                                        <Group gap={5}>
                                            <IconCategory
                                                style={{
                                                    width: rem(10),
                                                    height: rem(10),
                                                }}
                                            />
                                            <span>Category</span>
                                        </Group>
                                    }
                                    mt={10}
                                    onChange={(event) =>
                                        setCategoryId(event.currentTarget.value)
                                    }
                                    value={categoryId}
                                />
                                <Button
                                    disabled={
                                        addFeed.isPending ||
                                        feedUrl.trim() === '' ||
                                        categoryId === ''
                                    }
                                    fullWidth
                                    loading={addFeed.isPending}
                                    mt="md"
                                    type="submit"
                                >
                                    Submit
                                </Button>
                            </form>
                        ) : (
                            <form onSubmit={submitCategory}>
                                <TextInput
                                    data-autofocus
                                    description={
                                        <Text c="dimmed" size="xs">
                                            You will then be able to assign
                                            feeds to this category
                                        </Text>
                                    }
                                    error={addCategory.error?.message}
                                    label={
                                        <Group gap={5}>
                                            <IconCategory
                                                style={{
                                                    width: rem(10),
                                                    height: rem(10),
                                                }}
                                            />
                                            <span>Category name</span>
                                        </Group>
                                    }
                                    onChange={(event) =>
                                        setCategoryName(
                                            event.currentTarget.value,
                                        )
                                    }
                                    placeholder="Tech"
                                    value={categoryName}
                                />
                                <Button
                                    disabled={
                                        addCategory.isPending ||
                                        categoryName.trim() === ''
                                    }
                                    fullWidth
                                    loading={addCategory.isPending}
                                    mt="md"
                                    type="submit"
                                >
                                    Submit
                                </Button>
                            </form>
                        )}
                    </Fieldset>
                </Modal.Body>
            </Modal.Content>
        </Modal.Root>
    );
}

function FeedActions({
    subscription,
}: {
    readonly subscription: ReaderSubscriptionList['subscriptions'][number];
}) {
    const queryClient = useQueryClient();
    const management = useQuery(subscriptionManagementQueryOptions);
    const refresh = useMutation(
        refreshSubscriptionMutationOptions(queryClient),
    );
    const refreshFavicon = useMutation(
        refreshFaviconMutationOptions(queryClient),
    );
    const unsubscribe = useMutation(unsubscribeMutationOptions(queryClient));
    const update = useMutation(updateSubscriptionMutationOptions(queryClient));
    const markRead = useReadThroughMutation(subscription.feedId);
    const { hovered, ref } = useHover();
    const [opened, setOpened] = useState(false);
    const [editOpened, editModal] = useDisclosure(false);
    const [customName, setCustomName] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const managed = management.data?.subscriptions.find(
        (item) => item.feedId === subscription.feedId,
    );
    const openEdit = () => {
        if (managed === undefined) return;
        setCustomName(managed.customFeedName ?? managed.feedName);
        setCategoryId(String(managed.categoryId));
        editModal.open();
    };
    const submitEdit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (managed === undefined) return;
        const nextCategoryId = Number(categoryId);
        if (!Number.isSafeInteger(nextCategoryId)) return;
        const normalizedName = customName.trim();
        update.mutate(
            {
                feedId: managed.feedId,
                categoryId: nextCategoryId,
                customFeedName:
                    normalizedName === managed.feedName ? null : normalizedName,
                filterRules: managed.filterRules,
            },
            { onSuccess: editModal.close },
        );
    };

    return (
        <>
            <Modal
                onClose={editModal.close}
                opened={editOpened}
                title="Edit feed"
            >
                <form onSubmit={submitEdit}>
                    <Stack gap="md">
                        <TextInput
                            label="Feed name"
                            maxLength={255}
                            onChange={(event) =>
                                setCustomName(event.currentTarget.value)
                            }
                            required
                            value={customName}
                        />
                        <NativeSelect
                            data={
                                management.data?.categories.map((category) => ({
                                    value: String(category.id),
                                    label: category.name,
                                })) ?? []
                            }
                            label="Category"
                            onChange={(event) =>
                                setCategoryId(event.currentTarget.value)
                            }
                            value={categoryId}
                        />
                        {update.error !== null && (
                            <Alert color="red">{update.error.message}</Alert>
                        )}
                        <Button loading={update.isPending} type="submit">
                            Save
                        </Button>
                    </Stack>
                </form>
            </Modal>
            <Menu opened={opened} onChange={setOpened} shadow="md">
                <Group gap={0} ref={ref} wrap="nowrap">
                    <Menu.Target>
                        {hovered || opened ? (
                            <ActionIcon
                                className={classes.feedMenuIcon}
                                color="gray"
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setOpened(!opened);
                                }}
                                size="xs"
                            >
                                <IconDots size={15} stroke={1.5} />
                            </ActionIcon>
                        ) : (
                            <Badge
                                className={classes.mainLinkBadge}
                                size="sm"
                                variant="default"
                            >
                                {subscription.totalCount}
                            </Badge>
                        )}
                    </Menu.Target>
                </Group>
                <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
                    <Menu.Label>Manage feed</Menu.Label>
                    <Menu.Item
                        component="a"
                        disabled={managed?.siteUrl == null}
                        href={managed?.siteUrl ?? undefined}
                        leftSection={<IconExternalLink size={14} />}
                        rel="noreferrer"
                        target="_blank"
                    >
                        Open website
                    </Menu.Item>
                    <Menu.Item
                        component="a"
                        disabled={managed === undefined}
                        href={managed?.feedUrl}
                        leftSection={<IconRss size={14} />}
                        rel="noreferrer"
                        target="_blank"
                    >
                        Open feed
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                        disabled={markRead.isPending}
                        leftSection={<IconCheck size={14} />}
                        onClick={() => markRead.mutate()}
                    >
                        Mark as read
                    </Menu.Item>
                    <Menu.Item
                        disabled={refresh.isPending}
                        leftSection={<IconRefresh size={14} />}
                        onClick={() =>
                            refresh.mutate({ feedId: subscription.feedId })
                        }
                    >
                        Request refresh
                    </Menu.Item>
                    <Menu.Item
                        disabled={refreshFavicon.isPending}
                        leftSection={<IconPhoto size={14} />}
                        onClick={() =>
                            refreshFavicon.mutate({
                                feedId: subscription.feedId,
                            })
                        }
                    >
                        Refresh favicon
                    </Menu.Item>
                    <Menu.Item
                        disabled={managed === undefined}
                        leftSection={<IconPencil size={14} />}
                        onClick={openEdit}
                    >
                        Edit feed
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                        color="red"
                        disabled={unsubscribe.isPending}
                        leftSection={<IconTrash size={14} />}
                        onClick={() => {
                            if (
                                window.confirm(
                                    `Unsubscribe from ${
                                        subscription.customFeedName ??
                                        subscription.feedName
                                    }?`,
                                )
                            ) {
                                unsubscribe.mutate({
                                    feedId: subscription.feedId,
                                });
                            }
                        }}
                    >
                        Unsubscribe
                    </Menu.Item>
                </Menu.Dropdown>
            </Menu>
        </>
    );
}

function CategoryHeader({
    categoryId,
    name,
    entriesCount,
    feedCount,
    feedIds,
}: {
    readonly categoryId: number;
    readonly name: string;
    readonly entriesCount: number;
    readonly feedCount: number;
    readonly feedIds: readonly number[];
}) {
    const queryClient = useQueryClient();
    const markRead = useMutation({
        mutationKey: [
            'protected',
            'reader',
            'category-read-through',
            categoryId,
        ],
        mutationFn: async () => {
            const csrfToken = readCsrfToken();
            if (csrfToken === undefined) {
                throw new Error('Your session security token is missing.');
            }
            await Promise.all(
                feedIds.map((feedId) =>
                    Effect.runPromise(
                        markFeedReadThrough({ feedId, csrfToken }),
                    ),
                ),
            );
        },
        onSuccess: async () =>
            queryClient.invalidateQueries({ queryKey: ['protected'] }),
    });
    const update = useMutation(updateCategoryMutationOptions(queryClient));
    const remove = useMutation(deleteCategoryMutationOptions(queryClient));
    const { hovered, ref } = useHover();
    const [opened, setOpened] = useState(false);

    return (
        <Menu opened={opened} onChange={setOpened} shadow="md">
            <Group justify="space-between" ref={ref} wrap="nowrap">
                <span>{name}</span>
                <Menu.Target>
                    {hovered || opened ? (
                        <ActionIcon
                            className={classes.feedMenuIcon}
                            color="gray"
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setOpened(!opened);
                            }}
                            size="xs"
                        >
                            <IconDots size={15} stroke={1.5} />
                        </ActionIcon>
                    ) : (
                        <Badge
                            className={classes.mainLinkBadge}
                            size="sm"
                            variant="default"
                        >
                            {entriesCount}
                        </Badge>
                    )}
                </Menu.Target>
            </Group>
            <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
                <Menu.Label>Manage category</Menu.Label>
                <Menu.Item
                    disabled={markRead.isPending || feedIds.length === 0}
                    leftSection={<IconCheck size={14} />}
                    onClick={() => markRead.mutate()}
                >
                    Mark feeds as read
                </Menu.Item>
                <Menu.Item
                    disabled={update.isPending}
                    leftSection={<IconPencil size={14} />}
                    onClick={() => {
                        const nextName = window
                            .prompt('Category name', name)
                            ?.trim();
                        if (nextName !== undefined && nextName !== '') {
                            update.mutate({ categoryId, name: nextName });
                        }
                    }}
                >
                    Edit category name
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                    color="red"
                    disabled={feedCount > 0 || remove.isPending}
                    leftSection={<IconTrash size={14} />}
                    onClick={() => remove.mutate({ categoryId })}
                >
                    {feedCount > 0
                        ? 'Delete (needs to be empty)'
                        : 'Delete category'}
                </Menu.Item>
            </Menu.Dropdown>
        </Menu>
    );
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
    const [addOpened, addModal] = useDisclosure(false);
    const normalizedSearch = search.trim().toLocaleLowerCase();

    const subscriptionsByCategory = useMemo(() => {
        const grouped = new Map<
            number,
            ReaderSubscriptionList['subscriptions']
        >();
        for (const subscription of subscriptions ?? []) {
            const name = subscription.customFeedName ?? subscription.feedName;
            if (
                normalizedSearch !== '' &&
                !name.toLocaleLowerCase().includes(normalizedSearch)
            ) {
                continue;
            }
            grouped.set(subscription.categoryId, [
                ...(grouped.get(subscription.categoryId) ?? []),
                subscription,
            ]);
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

    const noResults =
        normalizedSearch !== '' &&
        [...subscriptionsByCategory.values()].every(
            (items) => items.length === 0,
        );

    return (
        <>
            <AddFeedModal
                categories={sortedCategories}
                close={addModal.close}
                opened={addOpened}
            />
            <AppShell.Section pl="md" pr="md" pt="md">
                <TextInput
                    aria-label="Search feeds"
                    classNames={{ input: classes.searchInput }}
                    leftSection={<IconSearch size={12} stroke={1.5} />}
                    mb="sm"
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') setSearch('');
                    }}
                    placeholder="Search"
                    rightSection={
                        <Code className={classes.searchCode}>Ctrl + K</Code>
                    }
                    rightSectionWidth={70}
                    size="xs"
                    styles={{ section: { pointerEvents: 'none' } }}
                    value={search}
                />
            </AppShell.Section>

            <AppShell.Section>
                <div className={classes.mainLinks}>
                    <FilterLink
                        badgeVariant="filled"
                        count={counts?.unread}
                        icon={
                            <IconBook
                                className={classes.mainLinkIcon}
                                size={20}
                                stroke={1.5}
                            />
                        }
                        label="Unread"
                        onNavigate={onNavigate}
                        state={state}
                    />
                    <FilterLink
                        badgeVariant="default"
                        count={counts?.read}
                        icon={
                            <IconCheckbox
                                className={classes.mainLinkIcon}
                                size={20}
                                stroke={1.5}
                            />
                        }
                        label="Read"
                        onNavigate={onNavigate}
                        state={state}
                    />
                    <FilterLink
                        badgeVariant="default"
                        count={undefined}
                        icon={
                            <IconStar
                                className={classes.mainLinkIcon}
                                size={20}
                                stroke={1.5}
                            />
                        }
                        label="Favorites"
                        onNavigate={onNavigate}
                        state={state}
                    />
                </div>
            </AppShell.Section>

            <Divider mb="sm" />

            <AppShell.Section>
                <Group
                    className={classes.collectionsHeader}
                    justify="space-between"
                >
                    <Text c="dimmed" fw={500} size="xs">
                        Feeds
                    </Text>
                    <Tooltip
                        label="Create feed or category"
                        opened={(subscriptions?.length ?? 0) === 0 || undefined}
                        position="right"
                        withArrow
                    >
                        <ActionIcon
                            aria-label="Create feed or category"
                            onClick={addModal.open}
                            size={18}
                            variant="default"
                        >
                            <IconPlus size={12} stroke={1.5} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </AppShell.Section>

            <AppShell.Section component={ScrollArea} grow>
                <div className={classes.collections}>
                    {isPending && subscriptions === undefined && (
                        <Text c="dimmed" size="xs">
                            Loading feeds…
                        </Text>
                    )}
                    {error !== null && categories === undefined && (
                        <Alert color="red" title="Feeds unavailable">
                            <Stack gap="xs">
                                <Text size="sm">{error.message}</Text>
                                <Button
                                    onClick={onRetry}
                                    size="xs"
                                    variant="light"
                                >
                                    Retry
                                </Button>
                            </Stack>
                        </Alert>
                    )}
                    {noResults && (
                        <Text c="dimmed" pl="xs" pr="xs" size="xs">
                            No feeds match your search.
                        </Text>
                    )}
                    {!noResults &&
                        sortedCategories.map((category) => {
                            const categorySubscriptions =
                                subscriptionsByCategory.get(category.id) ?? [];
                            if (
                                normalizedSearch !== '' &&
                                categorySubscriptions.length === 0
                            ) {
                                return null;
                            }
                            const active =
                                state.categoryId === category.id &&
                                state.feedId === null;
                            return (
                                <CategoryGroup
                                    key={category.id}
                                    active={active}
                                    categoryId={category.id}
                                    categoryName={category.name}
                                    onNavigate={onNavigate}
                                    state={state}
                                    subscriptions={categorySubscriptions}
                                />
                            );
                        })}
                </div>
            </AppShell.Section>
        </>
    );
}

function CategoryGroup({
    active,
    categoryId,
    categoryName,
    subscriptions,
    state,
    onNavigate,
}: {
    readonly active: boolean;
    readonly categoryId: number;
    readonly categoryName: string;
    readonly subscriptions: ReaderSubscriptionList['subscriptions'];
    readonly state: ReaderState;
    readonly onNavigate?: () => void;
}) {
    const autoOpened = subscriptions.length > 0;
    const [manualOpened, setManualOpened] = useState<boolean | null>(null);
    const opened = manualOpened ?? autoOpened;
    const totalCount = subscriptions.reduce(
        (total, subscription) => total + subscription.totalCount,
        0,
    );

    return (
        <NavLink
            active={active}
            defaultOpened
            label={
                <CategoryHeader
                    categoryId={categoryId}
                    entriesCount={totalCount}
                    feedCount={subscriptions.length}
                    feedIds={subscriptions.map(
                        (subscription) => subscription.feedId,
                    )}
                    name={categoryName}
                />
            }
            leftSection={<IconRss size={15} stroke={1.5} />}
            onClick={() => onNavigate?.()}
            opened={opened}
            component={Link}
            rightSection={
                <IconChevronRight
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setManualOpened((current) =>
                            current === null ? !opened : !current,
                        );
                    }}
                    size={15}
                    stroke={1.5}
                />
            }
            to={readerHref(state, {
                categoryId: active ? null : categoryId,
                feedId: null,
                page: 1,
            })}
        >
            {subscriptions.map((subscription) => {
                const feedActive = state.feedId === subscription.feedId;
                const name =
                    subscription.customFeedName ?? subscription.feedName;
                return (
                    <div
                        key={subscription.feedId}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <Tooltip
                            label={name}
                            multiline
                            openDelay={1000}
                            position="right"
                            withArrow
                        >
                            <Link
                                className={`${classes.collectionLink} ${
                                    feedActive ? classes.activeFeed : ''
                                }`}
                                onClick={onNavigate}
                                to={readerHref(state, {
                                    feedId: feedActive
                                        ? null
                                        : subscription.feedId,
                                    categoryId: null,
                                    page: 1,
                                })}
                            >
                                <Indicator color="orange" disabled withBorder>
                                    <div className={classes.feedRow}>
                                        <div className={classes.feedRowLeft}>
                                            <FeedFavicon
                                                isDark={
                                                    subscription.faviconIsDark
                                                }
                                                size={18}
                                                src={subscription.faviconUrl}
                                            />
                                            <span className={classes.feedName}>
                                                {name}
                                            </span>
                                        </div>
                                        <FeedActions
                                            subscription={subscription}
                                        />
                                    </div>
                                </Indicator>
                            </Link>
                        </Tooltip>
                    </div>
                );
            })}
        </NavLink>
    );
}

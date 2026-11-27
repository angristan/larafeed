import {
    ActionIcon,
    Alert,
    AppShell,
    Badge,
    Button,
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
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
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
import {
    type Mutation,
    type MutationKey,
    type MutationOptions,
    type QueryClient,
    useIsMutating,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
    type FormEvent,
    memo,
    type ReactNode,
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import type {
    ReaderCategoryList,
    ReaderCounts,
    ReaderSubscriptionList,
} from '../../api/reader';
import type {
    CreateSubscriptionResult,
    FeedDiscoveryCandidate,
    ManagedCategory,
    ManagedSubscription,
    SubscriptionFilterRules,
} from '../../api/subscriptions';
import { buildAddFeedBookmarklet } from '../../bookmarklet';
import {
    categoryReadThroughMutationOptions,
    readThroughMutationOptions,
} from '../../queries/readerMutations';
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
import { ApplicationSidebarHeader } from '../ApplicationPage';
import { FeedCandidateSelector } from './FeedCandidateSelector';
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

export function FeedCategoryFields({
    categories,
    categorySelection,
    categoryName,
    onCategorySelectionChange,
    onCategoryNameChange,
}: {
    readonly categories: ReaderCategoryList['categories'];
    readonly categorySelection: string;
    readonly categoryName: string;
    readonly onCategorySelectionChange: (value: string) => void;
    readonly onCategoryNameChange: (value: string) => void;
}) {
    return (
        <>
            <NativeSelect
                data={[
                    ...categories.map((category) => ({
                        value: String(category.id),
                        label: category.name,
                    })),
                    {
                        value: 'new',
                        label: 'Create new category',
                    },
                ]}
                description={
                    <Text c="dimmed" size="xs">
                        The category where the feed will be added
                    </Text>
                }
                label={
                    <Group gap={5}>
                        <IconCategory
                            style={{ width: rem(10), height: rem(10) }}
                        />
                        <span>Category</span>
                    </Group>
                }
                mt={10}
                onChange={(event) =>
                    onCategorySelectionChange(event.currentTarget.value)
                }
                value={categorySelection}
            />
            {categorySelection === 'new' && (
                <TextInput
                    data-autofocus={categories.length === 0}
                    description={
                        <Text c="dimmed" size="xs">
                            We will create this category and add the feed to it
                            automatically
                        </Text>
                    }
                    label={
                        <Group gap={5}>
                            <IconCategory
                                style={{ width: rem(10), height: rem(10) }}
                            />
                            <span>New category name</span>
                        </Group>
                    }
                    mt="sm"
                    onChange={(event) =>
                        onCategoryNameChange(event.currentTarget.value)
                    }
                    placeholder="Tech"
                    value={categoryName}
                />
            )}
        </>
    );
}

export function AddFeedModal({
    opened,
    close,
    categories,
    categoriesPending,
    initialFeedUrl,
}: {
    readonly opened: boolean;
    readonly close: () => void;
    readonly categories: ReaderCategoryList['categories'];
    readonly categoriesPending: boolean;
    readonly initialFeedUrl?: string;
}) {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const bookmarklet = useRef<HTMLAnchorElement>(null);
    const addFeed = useMutation(createSubscriptionMutationOptions(queryClient));
    const addCategory = useMutation(createCategoryMutationOptions(queryClient));
    const [view, setView] = useState('new_feed');
    const [feedUrl, setFeedUrl] = useState(initialFeedUrl ?? '');
    const [categorySelection, setCategorySelection] = useState(
        categoriesPending
            ? ''
            : categories[0] === undefined
              ? 'new'
              : String(categories[0].id),
    );
    const [categoryName, setCategoryName] = useState('');
    const [feedCandidates, setFeedCandidates] = useState<
        readonly FeedDiscoveryCandidate[] | null
    >(null);

    useEffect(() => {
        if (categorySelection === '' && !categoriesPending) {
            setCategorySelection(
                categories[0] === undefined ? 'new' : String(categories[0].id),
            );
        }
    }, [categories, categoriesPending, categorySelection]);

    useEffect(() => {
        if (opened && initialFeedUrl !== undefined) {
            setFeedUrl(initialFeedUrl);
        }
    }, [initialFeedUrl, opened]);

    useEffect(() => {
        if (!opened) return;
        // React sanitizes javascript: href props. Set this trusted,
        // application-generated bookmarklet directly so it remains draggable.
        bookmarklet.current?.setAttribute(
            'href',
            buildAddFeedBookmarklet(window.location.origin),
        );
    }, [opened]);

    const closeAndReset = () => {
        addFeed.reset();
        addCategory.reset();
        setFeedCandidates(null);
        close();
    };

    const handleFeedResult = (result: CreateSubscriptionResult) => {
        if (result.kind === 'selection_required') {
            setFeedCandidates(result.candidates);
            return;
        }
        notifications.show({
            title: 'Feed added',
            message: 'The feed has been added',
            color: 'green',
            withBorder: true,
        });
        closeAndReset();
        void navigate(
            `/feeds?feed=${result.subscription.feedId}&filter=all&order_by=published_at`,
        );
    };

    const submitFeedUrl = (url: string) => {
        const category =
            categorySelection === 'new'
                ? { categoryName: categoryName.trim() }
                : { categoryId: Number(categorySelection) };
        if (
            ('categoryName' in category && category.categoryName === '') ||
            ('categoryId' in category &&
                !Number.isSafeInteger(category.categoryId))
        ) {
            return;
        }
        addFeed.mutate(
            { feedUrl: url, ...category },
            { onSuccess: handleFeedResult },
        );
    };

    const submitFeed = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (feedUrl.trim() === '') return;
        const normalizedUrl = /^(http|https):\/\//.test(feedUrl.trim())
            ? feedUrl.trim()
            : `https://${feedUrl.trim()}`;
        submitFeedUrl(normalizedUrl);
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
                        {view === 'new_feed' && feedCandidates !== null ? (
                            'Choose a feed'
                        ) : (
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
                        )}
                    </Modal.Title>
                    <Modal.CloseButton />
                </Modal.Header>
                <Modal.Body>
                    <Fieldset
                        className={
                            feedCandidates === null
                                ? undefined
                                : classes.candidateFieldset
                        }
                        variant="filled"
                    >
                        {view === 'new_feed' && feedCandidates !== null ? (
                            <FeedCandidateSelector
                                candidates={feedCandidates}
                                error={addFeed.error}
                                isPending={addFeed.isPending}
                                onBack={() => {
                                    setFeedCandidates(null);
                                    addFeed.reset();
                                }}
                                onSubmit={submitFeedUrl}
                            />
                        ) : view === 'new_feed' ? (
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
                                    Tip: drag this{' '}
                                    {/* biome-ignore lint/a11y/useValidAnchor: The trusted bookmarklet href is assigned after React's URL sanitizer runs. */}
                                    {/* biome-ignore lint/a11y/noAmbiguousAnchorText: The surrounding sentence describes the bookmarklet action. */}
                                    <a ref={bookmarklet}>link</a> to your
                                    bookmark bar. When you are on a website,
                                    click it to open Larafeed with the URL
                                    pre-filled.
                                </Text>
                                <FeedCategoryFields
                                    categories={categories}
                                    categoryName={categoryName}
                                    categorySelection={categorySelection}
                                    onCategoryNameChange={setCategoryName}
                                    onCategorySelectionChange={
                                        setCategorySelection
                                    }
                                />
                                <Button
                                    disabled={
                                        addFeed.isPending ||
                                        feedUrl.trim() === '' ||
                                        categorySelection === '' ||
                                        (categorySelection === 'new' &&
                                            categoryName.trim() === '')
                                    }
                                    fullWidth
                                    loading={addFeed.isPending}
                                    mt="md"
                                    type="submit"
                                >
                                    Add feed
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
                                    Create category
                                </Button>
                            </form>
                        )}
                    </Fieldset>
                </Modal.Body>
            </Modal.Content>
        </Modal.Root>
    );
}

export function FilterRuleSection({
    label,
    placeholder,
    buttonText,
    filters,
    onAdd,
    onRemove,
    onUpdate,
}: {
    readonly label: string;
    readonly placeholder: string;
    readonly buttonText: string;
    readonly filters: readonly string[];
    readonly onAdd: () => void;
    readonly onRemove: (index: number) => void;
    readonly onUpdate: (index: number, value: string) => void;
}) {
    return (
        <>
            <Text fw={500} mt="sm" size="xs">
                {label}
            </Text>
            {filters.map((filter, index) => (
                <Group
                    // biome-ignore lint/suspicious/noArrayIndexKey: Filter patterns do not have stable IDs
                    key={index}
                    align="center"
                    gap="xs"
                    mt="xs"
                >
                    <TextInput
                        aria-label={`${label} pattern ${index + 1}`}
                        onChange={(event) =>
                            onUpdate(index, event.currentTarget.value)
                        }
                        placeholder={placeholder}
                        size="xs"
                        style={{ flex: 1 }}
                        value={filter}
                    />
                    <ActionIcon
                        aria-label={`Remove ${label.toLowerCase()} pattern ${index + 1}`}
                        color="red"
                        onClick={() => onRemove(index)}
                        size="sm"
                        type="button"
                        variant="subtle"
                    >
                        <IconTrash size={14} />
                    </ActionIcon>
                </Group>
            ))}
            <Button
                disabled={filters.length >= 20}
                leftSection={<IconPlus size={14} />}
                mt="xs"
                onClick={onAdd}
                size="xs"
                type="button"
                variant="subtle"
            >
                {buttonText}
            </Button>
        </>
    );
}

const notifyActionError = (title: string, error: Error) => {
    notifications.show({
        title,
        message: error.message,
        color: 'red',
        withBorder: true,
    });
};

export function feedMarkedReadNotification(feedName: string) {
    return {
        title: 'Feed marked as read',
        message: `${feedName} was marked as read`,
        color: 'green' as const,
        withBorder: true,
    };
}

// Runs a mutation outside a component's lifetime. The menus that start these
// actions close, and unmount their items, as soon as an item is clicked, and
// useMutation drops per-call callbacks once its component unmounts.
function runMutation<TData, TVariables>(
    queryClient: QueryClient,
    options: MutationOptions<TData, Error, TVariables>,
    variables: TVariables,
): Promise<TData> {
    return queryClient
        .getMutationCache()
        .build(queryClient, options)
        .execute(variables);
}

function hasFeedId(
    mutation: Mutation<unknown, Error, unknown>,
    feedId: number,
) {
    const variables = mutation.state.variables;
    return (
        typeof variables === 'object' &&
        variables !== null &&
        'feedId' in variables &&
        variables.feedId === feedId
    );
}

function useFeedMutationPending(
    mutationKey: MutationKey,
    feedId: number,
): boolean {
    return (
        useIsMutating({
            mutationKey,
            exact: true,
            predicate: (mutation) => hasFeedId(mutation, feedId),
        }) > 0
    );
}

function FeedEditForm({
    managed,
    categories,
    modalId,
}: {
    readonly managed: ManagedSubscription;
    readonly categories: readonly ManagedCategory[];
    readonly modalId: string;
}) {
    const queryClient = useQueryClient();
    const update = useMutation(updateSubscriptionMutationOptions(queryClient));
    const [customName, setCustomName] = useState(managed.customFeedName ?? '');
    const [categoryId, setCategoryId] = useState(String(managed.categoryId));
    const [filterRules, setFilterRules] = useState<SubscriptionFilterRules>(
        () => ({
            excludeTitle: [...managed.filterRules.excludeTitle],
            excludeContent: [...managed.filterRules.excludeContent],
            excludeAuthor: [...managed.filterRules.excludeAuthor],
        }),
    );
    const updateFilter = (
        field: keyof SubscriptionFilterRules,
        index: number,
        value: string,
    ) => {
        setFilterRules((current) => ({
            ...current,
            [field]: current[field].map((filter, currentIndex) =>
                currentIndex === index ? value : filter,
            ),
        }));
    };
    const addFilter = (field: keyof SubscriptionFilterRules) => {
        setFilterRules((current) => ({
            ...current,
            [field]: [...current[field], ''],
        }));
    };
    const removeFilter = (
        field: keyof SubscriptionFilterRules,
        index: number,
    ) => {
        setFilterRules((current) => ({
            ...current,
            [field]: current[field].filter(
                (_filter, currentIndex) => currentIndex !== index,
            ),
        }));
    };
    const submitEdit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const nextCategoryId = Number(categoryId);
        if (!Number.isSafeInteger(nextCategoryId)) return;
        const clean = (patterns: readonly string[]) =>
            patterns.map((pattern) => pattern.trim()).filter(Boolean);
        update.mutate(
            {
                feedId: managed.feedId,
                categoryId: nextCategoryId,
                customFeedName: customName.trim() || null,
                filterRules: {
                    excludeTitle: clean(filterRules.excludeTitle),
                    excludeContent: clean(filterRules.excludeContent),
                    excludeAuthor: clean(filterRules.excludeAuthor),
                },
            },
            {
                onSuccess: () => {
                    notifications.show({
                        title: 'Feed updated',
                        message: 'The feed has been updated',
                        color: 'green',
                        withBorder: true,
                    });
                    modals.close(modalId);
                },
            },
        );
    };

    return (
        <Fieldset variant="filled">
            <form onSubmit={submitEdit}>
                <TextInput
                    data-autofocus
                    description="Leave empty to keep the original name"
                    label="Feed name"
                    maxLength={255}
                    onChange={(event) =>
                        setCustomName(event.currentTarget.value)
                    }
                    placeholder={managed.feedName}
                    value={customName}
                />
                <NativeSelect
                    data={categories.map((category) => ({
                        value: String(category.id),
                        label: category.name,
                    }))}
                    description="The category where the feed will be moved"
                    label="Category"
                    mt="md"
                    onChange={(event) =>
                        setCategoryId(event.currentTarget.value)
                    }
                    value={categoryId}
                />
                <Text fw={500} mt="lg" size="sm">
                    Filter rules
                </Text>
                <Text c="dimmed" mb="xs" size="xs">
                    Hide entries matching these patterns (supports regex)
                </Text>
                <FilterRuleSection
                    buttonText="Add title filter"
                    filters={filterRules.excludeTitle}
                    label="Exclude by title"
                    onAdd={() => addFilter('excludeTitle')}
                    onRemove={(index) => removeFilter('excludeTitle', index)}
                    onUpdate={(index, value) =>
                        updateFilter('excludeTitle', index, value)
                    }
                    placeholder="e.g. alpha|beta"
                />
                <FilterRuleSection
                    buttonText="Add content filter"
                    filters={filterRules.excludeContent}
                    label="Exclude by content"
                    onAdd={() => addFilter('excludeContent')}
                    onRemove={(index) => removeFilter('excludeContent', index)}
                    onUpdate={(index, value) =>
                        updateFilter('excludeContent', index, value)
                    }
                    placeholder="e.g. sponsored"
                />
                <FilterRuleSection
                    buttonText="Add author filter"
                    filters={filterRules.excludeAuthor}
                    label="Exclude by author"
                    onAdd={() => addFilter('excludeAuthor')}
                    onRemove={(index) => removeFilter('excludeAuthor', index)}
                    onUpdate={(index, value) =>
                        updateFilter('excludeAuthor', index, value)
                    }
                    placeholder="e.g. bot"
                />
                {update.error !== null && (
                    <Alert color="red" mt="md">
                        {update.error.message}
                    </Alert>
                )}
                <Button
                    fullWidth
                    loading={update.isPending}
                    mt="md"
                    type="submit"
                >
                    Save changes
                </Button>
            </form>
        </Fieldset>
    );
}

// Mounted only while the feed menu is open, so a closed menu in each sidebar
// row costs no mutation observers.
function FeedActionsMenuItems({
    subscription,
    managed,
    categories,
    onUnsubscribed,
}: {
    readonly subscription: ReaderSubscriptionList['subscriptions'][number];
    readonly managed: ManagedSubscription | undefined;
    readonly categories: readonly ManagedCategory[];
    readonly onUnsubscribed?: () => void;
}) {
    const queryClient = useQueryClient();
    const { feedId } = subscription;
    const feedName = subscription.customFeedName ?? subscription.feedName;
    const refreshOptions = refreshSubscriptionMutationOptions(queryClient);
    const refreshFaviconOptions = refreshFaviconMutationOptions(queryClient);
    const unsubscribeOptions = unsubscribeMutationOptions(queryClient);
    const markReadOptions = readThroughMutationOptions(queryClient, feedId);
    const refreshPending = useFeedMutationPending(
        refreshOptions.mutationKey,
        feedId,
    );
    const refreshFaviconPending = useFeedMutationPending(
        refreshFaviconOptions.mutationKey,
        feedId,
    );
    const unsubscribePending = useFeedMutationPending(
        unsubscribeOptions.mutationKey,
        feedId,
    );
    const markReadPending =
        useIsMutating({
            mutationKey: markReadOptions.mutationKey,
            exact: true,
        }) > 0;

    const openEdit = () => {
        if (managed === undefined) return;
        const modalId = `feed-edit-${managed.feedId}`;
        modals.open({
            modalId,
            title: 'Update feed',
            children: (
                <FeedEditForm
                    categories={categories}
                    managed={managed}
                    modalId={modalId}
                />
            ),
        });
    };

    return (
        <>
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
                disabled={markReadPending}
                leftSection={<IconCheck size={14} />}
                onClick={() =>
                    runMutation(queryClient, markReadOptions, undefined).then(
                        () =>
                            notifications.show(
                                feedMarkedReadNotification(feedName),
                            ),
                        (error: Error) =>
                            notifyActionError(
                                'Failed to mark feed as read',
                                error,
                            ),
                    )
                }
            >
                Mark as read
            </Menu.Item>
            <Menu.Item
                disabled={refreshPending}
                leftSection={<IconRefresh size={14} />}
                onClick={() =>
                    runMutation(queryClient, refreshOptions, { feedId }).then(
                        () =>
                            notifications.show({
                                title: 'Feed refresh requested',
                                message: 'The feed refresh has been queued',
                                color: 'green',
                                withBorder: true,
                            }),
                        (error: Error) =>
                            notifyActionError('Failed to refresh feed', error),
                    )
                }
            >
                Request refresh
            </Menu.Item>
            <Menu.Item
                disabled={refreshFaviconPending}
                leftSection={<IconPhoto size={14} />}
                onClick={() =>
                    runMutation(queryClient, refreshFaviconOptions, {
                        feedId,
                    }).then(
                        () =>
                            notifications.show({
                                title: 'Favicon refresh queued',
                                message:
                                    'The feed favicon will refresh in the background',
                                color: 'blue',
                                withBorder: true,
                            }),
                        (error: Error) =>
                            notifyActionError(
                                'Failed to refresh favicon',
                                error,
                            ),
                    )
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
                disabled={unsubscribePending}
                leftSection={<IconTrash size={14} />}
                onClick={() =>
                    modals.openConfirmModal({
                        title: 'Unsubscribe from feed?',
                        children: (
                            <Text size="sm">
                                Remove <strong>{feedName}</strong> from
                                Larafeed? Existing entries from the feed will no
                                longer appear in your reader.
                            </Text>
                        ),
                        labels: {
                            confirm: 'Unsubscribe',
                            cancel: 'Cancel',
                        },
                        confirmProps: { color: 'red' },
                        onConfirm: () =>
                            runMutation(queryClient, unsubscribeOptions, {
                                feedId,
                            }).then(
                                () => {
                                    notifications.show({
                                        title: 'Unsubscribed',
                                        message:
                                            'The feed subscription was removed',
                                        color: 'green',
                                        withBorder: true,
                                    });
                                    onUnsubscribed?.();
                                },
                                (error: Error) =>
                                    notifyActionError(
                                        'Failed to unsubscribe',
                                        error,
                                    ),
                            ),
                    })
                }
            >
                Unsubscribe
            </Menu.Item>
        </>
    );
}

export function FeedActions({
    subscription,
    managed,
    categories,
    onUnsubscribed,
    showCount = false,
    entrySection,
    trigger = 'inline',
}: {
    readonly subscription: ReaderSubscriptionList['subscriptions'][number];
    readonly managed: ManagedSubscription | undefined;
    readonly categories: readonly ManagedCategory[];
    readonly onUnsubscribed?: () => void;
    readonly showCount?: boolean;
    readonly entrySection?: ReactNode;
    // 'inline' fits the compact sidebar rows; 'toolbar' matches the
    // full-size icon buttons in the entry detail toolbar.
    readonly trigger?: 'inline' | 'toolbar';
}) {
    return (
        <div className={classes.managementControl}>
            {showCount && (
                <Badge
                    aria-hidden="true"
                    className={`${classes.mainLinkBadge} ${classes.managementCount}`}
                    size="sm"
                    variant="default"
                >
                    {subscription.totalCount}
                </Badge>
            )}
            <Menu
                classNames={{
                    dropdown: classes.managementMenuDropdown,
                    item: classes.managementMenuItem,
                    label: classes.managementMenuLabel,
                }}
                offset={8}
                position={trigger === 'toolbar' ? 'bottom-end' : 'right-start'}
                shadow="md"
                width={192}
            >
                <Menu.Target>
                    <ActionIcon
                        aria-label={
                            trigger === 'toolbar'
                                ? 'More entry and feed actions'
                                : `Manage ${subscription.customFeedName ?? subscription.feedName}`
                        }
                        className={
                            trigger === 'toolbar'
                                ? undefined
                                : `${classes.feedMenuIcon} ${showCount ? classes.managementMenuTarget : ''}`
                        }
                        color="gray"
                        size={trigger === 'toolbar' ? 36 : 'xs'}
                        type="button"
                        variant={trigger === 'toolbar' ? 'subtle' : undefined}
                    >
                        <IconDots
                            aria-hidden="true"
                            size={trigger === 'toolbar' ? 15 : 13}
                            stroke={trigger === 'toolbar' ? 2 : 1.7}
                        />
                    </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                    {entrySection}
                    <FeedActionsMenuItems
                        categories={categories}
                        managed={managed}
                        onUnsubscribed={onUnsubscribed}
                        subscription={subscription}
                    />
                </Menu.Dropdown>
            </Menu>
        </div>
    );
}

function CategoryRenameForm({
    categoryId,
    name,
    modalId,
}: {
    readonly categoryId: number;
    readonly name: string;
    readonly modalId: string;
}) {
    const queryClient = useQueryClient();
    const update = useMutation(updateCategoryMutationOptions(queryClient));
    const [nextName, setNextName] = useState(name);

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                const normalized = nextName.trim();
                if (normalized === '') return;
                update.mutate(
                    { categoryId, name: normalized },
                    {
                        onSuccess: () => {
                            modals.close(modalId);
                            notifications.show({
                                title: 'Category updated',
                                message: `The category is now named ${normalized}`,
                                color: 'green',
                                withBorder: true,
                            });
                        },
                    },
                );
            }}
        >
            <TextInput
                autoFocus
                error={update.error?.message}
                label="Category name"
                maxLength={255}
                onChange={(event) => setNextName(event.currentTarget.value)}
                required
                value={nextName}
            />
            <Group justify="flex-end" mt="md">
                <Button onClick={() => modals.close(modalId)} variant="default">
                    Cancel
                </Button>
                <Button
                    disabled={nextName.trim() === ''}
                    loading={update.isPending}
                    type="submit"
                >
                    Save
                </Button>
            </Group>
        </form>
    );
}

function hasCategoryId(
    mutation: Mutation<unknown, Error, unknown>,
    categoryId: number,
) {
    const variables = mutation.state.variables;
    return (
        typeof variables === 'object' &&
        variables !== null &&
        'categoryId' in variables &&
        variables.categoryId === categoryId
    );
}

// Mounted only while the category menu is open.
function CategoryActionsMenuItems({
    categoryId,
    name,
    feedCount,
    feedIds,
}: {
    readonly categoryId: number;
    readonly name: string;
    readonly feedCount: number;
    readonly feedIds: readonly number[];
}) {
    const queryClient = useQueryClient();
    const markReadOptions = categoryReadThroughMutationOptions(
        queryClient,
        categoryId,
    );
    const updateKey = updateCategoryMutationOptions(queryClient).mutationKey;
    const removeOptions = deleteCategoryMutationOptions(queryClient);
    const markReadPending =
        useIsMutating({
            mutationKey: markReadOptions.mutationKey,
            exact: true,
        }) > 0;
    const updatePending =
        useIsMutating({
            mutationKey: updateKey,
            exact: true,
            predicate: (mutation) => hasCategoryId(mutation, categoryId),
        }) > 0;
    const removePending =
        useIsMutating({
            mutationKey: removeOptions.mutationKey,
            exact: true,
            predicate: (mutation) => hasCategoryId(mutation, categoryId),
        }) > 0;

    return (
        <>
            <Menu.Label>Manage category</Menu.Label>
            <Menu.Item
                disabled={markReadPending || feedIds.length === 0}
                leftSection={<IconCheck size={14} />}
                onClick={() =>
                    runMutation(queryClient, markReadOptions, undefined).then(
                        () =>
                            notifications.show({
                                title: 'Category marked as read',
                                message: `${name} feeds were marked as read`,
                                color: 'green',
                                withBorder: true,
                            }),
                        (actionError: Error) =>
                            notifyActionError(
                                'Failed to mark category as read',
                                actionError,
                            ),
                    )
                }
            >
                Mark feeds as read
            </Menu.Item>
            <Menu.Item
                disabled={updatePending}
                leftSection={<IconPencil size={14} />}
                onClick={() => {
                    const modalId = `category-rename-${categoryId}`;
                    modals.open({
                        modalId,
                        centered: true,
                        title: 'Edit category name',
                        children: (
                            <CategoryRenameForm
                                categoryId={categoryId}
                                modalId={modalId}
                                name={name}
                            />
                        ),
                    });
                }}
            >
                Edit category name
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
                color="red"
                disabled={feedCount > 0 || removePending}
                leftSection={<IconTrash size={14} />}
                onClick={() =>
                    runMutation(queryClient, removeOptions, {
                        categoryId,
                    }).then(
                        () =>
                            notifications.show({
                                title: 'Category deleted',
                                message: `The category ${name} has been deleted`,
                                color: 'green',
                                withBorder: true,
                            }),
                        (actionError: Error) =>
                            notifyActionError(
                                `Failed to delete category ${name}`,
                                actionError,
                            ),
                    )
                }
            >
                {feedCount > 0
                    ? 'Delete (needs to be empty)'
                    : 'Delete category'}
            </Menu.Item>
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
    return (
        <div className={classes.managementControl}>
            <Badge
                aria-hidden="true"
                className={`${classes.mainLinkBadge} ${classes.managementCount}`}
                size="sm"
                variant="default"
            >
                {entriesCount}
            </Badge>
            <Menu
                classNames={{
                    dropdown: classes.managementMenuDropdown,
                    item: classes.managementMenuItem,
                    label: classes.managementMenuLabel,
                }}
                offset={8}
                position="right-start"
                shadow="md"
                width={192}
            >
                <Menu.Target>
                    <ActionIcon
                        aria-label={`Manage ${name} category`}
                        className={`${classes.feedMenuIcon} ${classes.managementMenuTarget}`}
                        color="gray"
                        size="xs"
                        type="button"
                    >
                        <IconDots aria-hidden="true" size={13} stroke={1.7} />
                    </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                    <CategoryActionsMenuItems
                        categoryId={categoryId}
                        feedCount={feedCount}
                        feedIds={feedIds}
                        name={name}
                    />
                </Menu.Dropdown>
            </Menu>
        </div>
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
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [addOpened, { open: openAddModal, close: closeAddModal }] =
        useDisclosure(false);
    const [searchParams] = useSearchParams();
    const bookmarkletFeedUrl = searchParams.get('addFeedUrl');
    const [handledBookmarkletUrl, setHandledBookmarkletUrl] = useState<
        string | null
    >(null);
    // Typing stays responsive: the library list filters against a deferred
    // copy of the search, which React renders at a lower priority.
    const deferredSearch = useDeferredValue(search);
    const normalizedSearch = deferredSearch.trim().toLocaleLowerCase();
    const management = useQuery(subscriptionManagementQueryOptions);
    const displayedError = error ?? management.error;
    const managedCategories = management.data?.categories ?? noCategories;
    const managedByFeedId = useMemo(
        () =>
            new Map(
                (management.data?.subscriptions ?? []).map((subscription) => [
                    subscription.feedId,
                    subscription,
                ]),
            ),
        [management.data?.subscriptions],
    );

    useEffect(() => {
        if (
            bookmarkletFeedUrl !== null &&
            bookmarkletFeedUrl !== handledBookmarkletUrl
        ) {
            openAddModal();
            setHandledBookmarkletUrl(bookmarkletFeedUrl);
        }
    }, [bookmarkletFeedUrl, handledBookmarkletUrl, openAddModal]);

    const subscriptionsByCategory = useMemo(() => {
        const grouped = new Map<
            number,
            ReaderSubscriptionList['subscriptions'][number][]
        >();
        for (const subscription of subscriptions ?? []) {
            const name = subscription.customFeedName ?? subscription.feedName;
            if (
                normalizedSearch !== '' &&
                !name.toLocaleLowerCase().includes(normalizedSearch)
            ) {
                continue;
            }
            const group = grouped.get(subscription.categoryId);
            if (group === undefined) {
                grouped.set(subscription.categoryId, [subscription]);
            } else {
                group.push(subscription);
            }
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

    // One flat row list keeps the library cheap to render: a selection or a
    // scroll only touches the rows on screen instead of every feed.
    const [categoryOpen, setCategoryOpenState] = useState<
        ReadonlyMap<number, boolean>
    >(new Map());
    const setCategoryOpen = useCallback((categoryId: number, open: boolean) => {
        setCategoryOpenState((current) => {
            const next = new Map(current);
            next.set(categoryId, open);
            return next;
        });
    }, []);

    const rows = useMemo(() => {
        const model: SidebarRow[] = [];
        for (const category of sortedCategories) {
            const categorySubscriptions =
                subscriptionsByCategory.get(category.id) ?? [];
            if (normalizedSearch !== '' && categorySubscriptions.length === 0) {
                continue;
            }
            const opened =
                categoryOpen.get(category.id) ??
                categorySubscriptions.length > 0;
            model.push({
                categoryId: category.id,
                categoryName: category.name,
                entriesCount: categorySubscriptions.reduce(
                    (total, subscription) => total + subscription.totalCount,
                    0,
                ),
                feedCount: categorySubscriptions.length,
                feedIds: categorySubscriptions.map(
                    (subscription) => subscription.feedId,
                ),
                kind: 'category',
                opened,
            });
            if (!opened) continue;
            for (const subscription of categorySubscriptions) {
                model.push({ kind: 'feed', subscription });
            }
        }
        return model;
    }, [
        categoryOpen,
        normalizedSearch,
        sortedCategories,
        subscriptionsByCategory,
    ]);

    const viewportRef = useRef<HTMLDivElement>(null);
    const estimateRowSize = useCallback(
        (index: number) => (rows[index]?.kind === 'category' ? 32 : 28),
        [rows],
    );
    const getRowKey = useCallback(
        (index: number) => {
            const row = rows[index];
            return row === undefined ? index : rowKey(row);
        },
        [rows],
    );
    const virtualizer = useVirtualizer({
        count: rows.length,
        estimateSize: estimateRowSize,
        getItemKey: getRowKey,
        getScrollElement: () => viewportRef.current,
        overscan: 8,
        // Gives the first render a window of rows instead of the whole
        // library; the real viewport rect replaces it once it mounts.
        initialRect: { width: 364, height: 800 },
    });
    const measureRow = useCallback(
        (element: HTMLDivElement | null) => {
            if (element !== null) virtualizer.measureElement(element);
        },
        [virtualizer],
    );

    const leaveFeedHref = readerHref(state, {
        categoryId: null,
        entryId: null,
        feedId: null,
    });
    const leaveFeed = useCallback(() => {
        void navigate(leaveFeedHref);
    }, [leaveFeedHref, navigate]);

    return (
        <>
            <AddFeedModal
                categories={sortedCategories}
                categoriesPending={isPending && categories === undefined}
                close={closeAddModal}
                initialFeedUrl={bookmarkletFeedUrl ?? undefined}
                opened={addOpened}
            />
            <ApplicationSidebarHeader
                action={
                    <Tooltip label="Create feed or category" position="right">
                        <ActionIcon
                            aria-label="Create feed or category"
                            className={classes.addFeedAction}
                            onClick={openAddModal}
                            size="md"
                            variant="subtle"
                        >
                            <IconPlus size={16} stroke={1.7} />
                        </ActionIcon>
                    </Tooltip>
                }
                description={`${(subscriptions?.length ?? 0).toLocaleString()} feeds`}
                title="Library"
            >
                <TextInput
                    aria-label="Search feeds"
                    classNames={{ input: classes.searchInput }}
                    leftSection={<IconSearch size={14} stroke={1.6} />}
                    mt="md"
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') setSearch('');
                    }}
                    placeholder="Filter library"
                    size="sm"
                    value={search}
                />
            </ApplicationSidebarHeader>

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

            <AppShell.Section>
                <Text className={classes.sectionLabel} c="dimmed" size="xs">
                    Feeds
                </Text>
            </AppShell.Section>

            <AppShell.Section
                className={classes.feedListScroll}
                component={ScrollArea}
                grow
                viewportRef={viewportRef}
            >
                <div className={classes.collections}>
                    {isPending && subscriptions === undefined && (
                        <Text c="dimmed" size="xs">
                            Loading feeds…
                        </Text>
                    )}
                    {displayedError !== null && (
                        <Alert color="red" title="Feeds unavailable">
                            <Stack gap="xs">
                                <Text size="sm">{displayedError.message}</Text>
                                <Button
                                    onClick={() => {
                                        onRetry();
                                        void management.refetch();
                                    }}
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
                    {!noResults && (
                        <div
                            style={{
                                height: virtualizer.getTotalSize(),
                                position: 'relative',
                            }}
                        >
                            {virtualizer.getVirtualItems().map((item) => {
                                const row = rows[item.index];
                                if (row === undefined) return null;
                                return (
                                    <div
                                        className={
                                            row.kind === 'feed'
                                                ? classes.virtualFeedRow
                                                : undefined
                                        }
                                        data-index={item.index}
                                        key={item.key}
                                        ref={measureRow}
                                        style={{
                                            left: 0,
                                            position: 'absolute',
                                            right: 0,
                                            top: 0,
                                            transform: `translateY(${item.start}px)`,
                                        }}
                                    >
                                        {row.kind === 'category' ? (
                                            <CategoryRow
                                                active={
                                                    state.categoryId ===
                                                        row.categoryId &&
                                                    state.feedId === null
                                                }
                                                categoryId={row.categoryId}
                                                categoryName={row.categoryName}
                                                entriesCount={row.entriesCount}
                                                feedCount={row.feedCount}
                                                feedIds={row.feedIds}
                                                href={readerHref(state, {
                                                    categoryId:
                                                        state.categoryId ===
                                                            row.categoryId &&
                                                        state.feedId === null
                                                            ? null
                                                            : row.categoryId,
                                                    feedId: null,
                                                })}
                                                onNavigate={onNavigate}
                                                onToggle={setCategoryOpen}
                                                opened={row.opened}
                                            />
                                        ) : (
                                            <FeedRow
                                                active={
                                                    state.feedId ===
                                                    row.subscription.feedId
                                                }
                                                categories={managedCategories}
                                                href={readerHref(state, {
                                                    feedId: row.subscription
                                                        .feedId,
                                                    categoryId: null,
                                                    filter: 'all',
                                                })}
                                                managed={managedByFeedId.get(
                                                    row.subscription.feedId,
                                                )}
                                                onLeaveFeed={leaveFeed}
                                                onNavigate={onNavigate}
                                                subscription={row.subscription}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </AppShell.Section>
        </>
    );
}

type SidebarRow =
    | {
          readonly kind: 'category';
          readonly categoryId: number;
          readonly categoryName: string;
          readonly opened: boolean;
          readonly entriesCount: number;
          readonly feedCount: number;
          readonly feedIds: readonly number[];
      }
    | {
          readonly kind: 'feed';
          readonly subscription: ReaderSubscriptionList['subscriptions'][number];
      };

const noCategories: readonly ManagedCategory[] = [];

function rowKey(row: SidebarRow): string {
    return row.kind === 'category'
        ? `category-${row.categoryId}`
        : `feed-${row.subscription.feedId}`;
}

interface CategoryRowProps {
    readonly active: boolean;
    readonly categoryId: number;
    readonly categoryName: string;
    readonly entriesCount: number;
    readonly feedCount: number;
    readonly feedIds: readonly number[];
    readonly href: string;
    readonly opened: boolean;
    readonly onToggle: (categoryId: number, opened: boolean) => void;
    readonly onNavigate?: () => void;
}

// The row model is rebuilt whenever the library changes, which gives every
// category a new feedIds array with the same contents.
function sameCategoryRowProps(
    previous: CategoryRowProps,
    next: CategoryRowProps,
): boolean {
    for (const key of Object.keys(next) as (keyof CategoryRowProps)[]) {
        if (key === 'feedIds') continue;
        if (!Object.is(previous[key], next[key])) return false;
    }
    return (
        previous.feedIds.length === next.feedIds.length &&
        previous.feedIds.every(
            (feedId, index) => feedId === next.feedIds[index],
        )
    );
}

const CategoryRow = memo(function CategoryRow({
    active,
    categoryId,
    categoryName,
    entriesCount,
    feedCount,
    feedIds,
    href,
    opened,
    onToggle,
    onNavigate,
}: CategoryRowProps) {
    const feedsId = `reader-category-${categoryId}-feeds`;

    return (
        <div
            className={`${classes.categoryRow} ${
                active ? classes.activeFeed : ''
            }`}
        >
            <NavLink
                active={active}
                className={classes.categoryNavigation}
                component={Link}
                label={categoryName}
                onClick={onNavigate}
                to={href}
            />
            <CategoryHeader
                categoryId={categoryId}
                entriesCount={entriesCount}
                feedCount={feedCount}
                feedIds={feedIds}
                name={categoryName}
            />
            <ActionIcon
                aria-controls={feedsId}
                aria-expanded={opened}
                aria-label={`${opened ? 'Collapse' : 'Expand'} ${categoryName} feeds`}
                className={`${classes.categoryDisclosure} ${
                    opened ? classes.categoryDisclosureOpened : ''
                }`}
                color="gray"
                onClick={() => onToggle(categoryId, !opened)}
                size="xs"
                type="button"
                variant="subtle"
            >
                <IconChevronRight aria-hidden="true" size={15} stroke={1.5} />
            </ActionIcon>
        </div>
    );
}, sameCategoryRowProps);

// Rendered only while the tooltip is open, so rows do not format refresh
// dates on every render.
function FeedTooltipLabel({
    name,
    managed,
}: {
    readonly name: string;
    readonly managed: ManagedSubscription | undefined;
}) {
    return (
        <Stack gap={2}>
            <Text fw={500} size="sm">
                {name}
            </Text>
            <Text c="dimmed" size="xs">
                {feedRefreshStatus(managed)}
            </Text>
        </Stack>
    );
}

// Every prop is a primitive or a reference that only changes with this
// feed's own data, so selecting another feed re-renders two rows at most.
const FeedRow = memo(function FeedRow({
    active,
    categories,
    href,
    managed,
    onLeaveFeed,
    onNavigate,
    subscription,
}: {
    readonly active: boolean;
    readonly categories: readonly ManagedCategory[];
    readonly href: string;
    readonly managed: ManagedSubscription | undefined;
    readonly onLeaveFeed: () => void;
    readonly onNavigate?: () => void;
    readonly subscription: ReaderSubscriptionList['subscriptions'][number];
}) {
    const name = subscription.customFeedName ?? subscription.feedName;

    return (
        <Tooltip
            label={<FeedTooltipLabel managed={managed} name={name} />}
            multiline
            openDelay={1000}
            position="right"
            withArrow
        >
            <div
                className={`${classes.collectionLink} ${
                    active ? classes.activeFeed : ''
                }`}
            >
                <div className={classes.feedRow}>
                    <Link
                        className={classes.feedNavigationLink}
                        onClick={onNavigate}
                        to={href}
                    >
                        <div className={classes.feedRowLeft}>
                            {/* Badge the favicon, not the whole row: on a
                                row-wide wrapper the dot lands in the middle of
                                long names. */}
                            <Indicator
                                className={classes.feedFailureIndicator}
                                color="orange"
                                disabled={
                                    managed === undefined ||
                                    managed.consecutiveFailures === 0
                                }
                                inline
                                size={8}
                                withBorder
                            >
                                <FeedFavicon
                                    isDark={subscription.faviconIsDark}
                                    size={18}
                                    src={subscription.faviconUrl}
                                />
                            </Indicator>
                            <span className={classes.feedName}>{name}</span>
                        </div>
                    </Link>
                    <FeedActions
                        categories={categories}
                        managed={managed}
                        onUnsubscribed={active ? onLeaveFeed : undefined}
                        showCount
                        subscription={subscription}
                    />
                </div>
            </div>
        </Tooltip>
    );
});

const refreshTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
});

function feedRefreshStatus(
    subscription: ManagedSubscription | undefined,
): string {
    if (subscription?.lastAttemptAt === null || subscription === undefined) {
        return 'Never refreshed';
    }
    const timestamp = refreshTimeFormatter.format(
        new Date(subscription.lastAttemptAt),
    );
    if (subscription.movedToUrl !== null) {
        return 'Feed moved. Switch to the new URL in Subscriptions.';
    }
    return subscription.consecutiveFailures > 0
        ? `Last refresh failed ${timestamp}`
        : `Last refreshed ${timestamp}`;
}

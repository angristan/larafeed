import {
    ActionIcon,
    Alert,
    AppShell,
    Badge,
    Button,
    Collapse,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    type FormEvent,
    type ReactNode,
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
    ManagedCategory,
    ManagedSubscription,
    SubscriptionFilterRules,
} from '../../api/subscriptions';
import { buildAddFeedBookmarklet } from '../../bookmarklet';
import {
    CategoryReadThroughError,
    categoryReadThroughMutationOptions,
    useReadThroughMutation,
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
        close();
    };

    const submitFeed = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (feedUrl.trim() === '') return;
        const normalizedUrl = /^(http|https):\/\//.test(feedUrl.trim())
            ? feedUrl.trim()
            : `https://${feedUrl.trim()}`;
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
            { feedUrl: normalizedUrl, ...category },
            {
                onSuccess: (result) => {
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
    const queryClient = useQueryClient();
    const refresh = useMutation(
        refreshSubscriptionMutationOptions(queryClient),
    );
    const refreshFavicon = useMutation(
        refreshFaviconMutationOptions(queryClient),
    );
    const unsubscribe = useMutation(unsubscribeMutationOptions(queryClient));
    const update = useMutation(updateSubscriptionMutationOptions(queryClient));
    const markRead = useReadThroughMutation(subscription.feedId);
    const [editOpened, editModal] = useDisclosure(false);
    const [customName, setCustomName] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [filterRules, setFilterRules] = useState<SubscriptionFilterRules>({
        excludeTitle: [],
        excludeContent: [],
        excludeAuthor: [],
    });
    const openEdit = () => {
        if (managed === undefined) return;
        setCustomName(managed.customFeedName ?? '');
        setCategoryId(String(managed.categoryId));
        setFilterRules({
            excludeTitle: [...managed.filterRules.excludeTitle],
            excludeContent: [...managed.filterRules.excludeContent],
            excludeAuthor: [...managed.filterRules.excludeAuthor],
        });
        editModal.open();
    };
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
        if (managed === undefined) return;
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
                    editModal.close();
                },
            },
        );
    };

    return (
        <>
            <Modal
                onClose={editModal.close}
                opened={editOpened}
                title="Update feed"
            >
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
                            placeholder={managed?.feedName}
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
                            Hide entries matching these patterns (supports
                            regex)
                        </Text>
                        <FilterRuleSection
                            buttonText="Add title filter"
                            filters={filterRules.excludeTitle}
                            label="Exclude by title"
                            onAdd={() => addFilter('excludeTitle')}
                            onRemove={(index) =>
                                removeFilter('excludeTitle', index)
                            }
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
                            onRemove={(index) =>
                                removeFilter('excludeContent', index)
                            }
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
                            onRemove={(index) =>
                                removeFilter('excludeAuthor', index)
                            }
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
            </Modal>
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
                    position={
                        trigger === 'toolbar' ? 'bottom-start' : 'right-start'
                    }
                    shadow="md"
                    width={192}
                >
                    <Menu.Target>
                        <ActionIcon
                            aria-label={`Manage ${subscription.customFeedName ?? subscription.feedName}`}
                            className={
                                trigger === 'toolbar'
                                    ? undefined
                                    : `${classes.feedMenuIcon} ${showCount ? classes.managementMenuTarget : ''}`
                            }
                            color="gray"
                            size={trigger === 'toolbar' ? undefined : 'xs'}
                            type="button"
                            variant={
                                trigger === 'toolbar' ? 'subtle' : undefined
                            }
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
                            onClick={() =>
                                markRead.mutate(undefined, {
                                    onSuccess: () =>
                                        notifications.show(
                                            feedMarkedReadNotification(
                                                subscription.customFeedName ??
                                                    subscription.feedName,
                                            ),
                                        ),
                                    onError: (error) =>
                                        notifyActionError(
                                            'Failed to mark feed as read',
                                            error,
                                        ),
                                })
                            }
                        >
                            Mark as read
                        </Menu.Item>
                        <Menu.Item
                            disabled={refresh.isPending}
                            leftSection={<IconRefresh size={14} />}
                            onClick={() =>
                                refresh.mutate(
                                    { feedId: subscription.feedId },
                                    {
                                        onSuccess: () =>
                                            notifications.show({
                                                title: 'Feed refresh requested',
                                                message:
                                                    'The feed refresh has been queued',
                                                color: 'green',
                                                withBorder: true,
                                            }),
                                        onError: (error) =>
                                            notifyActionError(
                                                'Failed to refresh feed',
                                                error,
                                            ),
                                    },
                                )
                            }
                        >
                            Request refresh
                        </Menu.Item>
                        <Menu.Item
                            disabled={refreshFavicon.isPending}
                            leftSection={<IconPhoto size={14} />}
                            onClick={() =>
                                refreshFavicon.mutate(
                                    { feedId: subscription.feedId },
                                    {
                                        onSuccess: () =>
                                            notifications.show({
                                                title: 'Favicon refresh queued',
                                                message:
                                                    'The feed favicon will refresh in the background',
                                                color: 'blue',
                                                withBorder: true,
                                            }),
                                        onError: (error) =>
                                            notifyActionError(
                                                'Failed to refresh favicon',
                                                error,
                                            ),
                                    },
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
                            disabled={unsubscribe.isPending}
                            leftSection={<IconTrash size={14} />}
                            onClick={() =>
                                modals.openConfirmModal({
                                    title: 'Unsubscribe from feed?',
                                    children: (
                                        <Text size="sm">
                                            Remove{' '}
                                            <strong>
                                                {subscription.customFeedName ??
                                                    subscription.feedName}
                                            </strong>{' '}
                                            from Larafeed? Existing entries from
                                            the feed will no longer appear in
                                            your reader.
                                        </Text>
                                    ),
                                    labels: {
                                        confirm: 'Unsubscribe',
                                        cancel: 'Cancel',
                                    },
                                    confirmProps: { color: 'red' },
                                    onConfirm: () =>
                                        unsubscribe.mutate(
                                            { feedId: subscription.feedId },
                                            {
                                                onSuccess: () => {
                                                    notifications.show({
                                                        title: 'Unsubscribed',
                                                        message:
                                                            'The feed subscription was removed',
                                                        color: 'green',
                                                        withBorder: true,
                                                    });
                                                    onUnsubscribed?.();
                                                },
                                                onError: (error) =>
                                                    notifyActionError(
                                                        'Failed to unsubscribe',
                                                        error,
                                                    ),
                                            },
                                        ),
                                })
                            }
                        >
                            Unsubscribe
                        </Menu.Item>
                    </Menu.Dropdown>
                </Menu>
            </div>
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
    const markRead = useMutation(
        categoryReadThroughMutationOptions(queryClient, categoryId, feedIds),
    );
    const update = useMutation(updateCategoryMutationOptions(queryClient));
    const remove = useMutation(deleteCategoryMutationOptions(queryClient));
    const [renameOpened, rename] = useDisclosure(false);
    const [nextName, setNextName] = useState(name);

    return (
        <>
            <Modal
                centered
                onClose={rename.close}
                opened={renameOpened}
                title="Edit category name"
            >
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        const normalized = nextName.trim();
                        if (normalized === '') return;
                        update.mutate(
                            { categoryId, name: normalized },
                            {
                                onSuccess: () => {
                                    rename.close();
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
                        onChange={(event) =>
                            setNextName(event.currentTarget.value)
                        }
                        required
                        value={nextName}
                    />
                    <Group justify="flex-end" mt="md">
                        <Button onClick={rename.close} variant="default">
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
            </Modal>
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
                            <IconDots
                                aria-hidden="true"
                                size={13}
                                stroke={1.7}
                            />
                        </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                        <Menu.Label>Manage category</Menu.Label>
                        <Menu.Item
                            disabled={
                                markRead.isPending || feedIds.length === 0
                            }
                            leftSection={<IconCheck size={14} />}
                            onClick={() =>
                                markRead.mutate(undefined, {
                                    onSuccess: () =>
                                        notifications.show({
                                            title: 'Category marked as read',
                                            message: `${name} feeds were marked as read`,
                                            color: 'green',
                                            withBorder: true,
                                        }),
                                    onError: (actionError) =>
                                        notifyActionError(
                                            actionError instanceof
                                                CategoryReadThroughError &&
                                                actionError.succeeded > 0
                                                ? 'Category partially marked as read'
                                                : 'Failed to mark category as read',
                                            actionError,
                                        ),
                                })
                            }
                        >
                            Mark feeds as read
                        </Menu.Item>
                        <Menu.Item
                            disabled={update.isPending}
                            leftSection={<IconPencil size={14} />}
                            onClick={() => {
                                setNextName(name);
                                update.reset();
                                rename.open();
                            }}
                        >
                            Edit category name
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                            color="red"
                            disabled={feedCount > 0 || remove.isPending}
                            leftSection={<IconTrash size={14} />}
                            onClick={() =>
                                remove.mutate(
                                    { categoryId },
                                    {
                                        onSuccess: () =>
                                            notifications.show({
                                                title: 'Category deleted',
                                                message: `The category ${name} has been deleted`,
                                                color: 'green',
                                                withBorder: true,
                                            }),
                                        onError: (actionError) =>
                                            notifyActionError(
                                                `Failed to delete category ${name}`,
                                                actionError,
                                            ),
                                    },
                                )
                            }
                        >
                            {feedCount > 0
                                ? 'Delete (needs to be empty)'
                                : 'Delete category'}
                        </Menu.Item>
                    </Menu.Dropdown>
                </Menu>
            </div>
        </>
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
    const [addOpened, { open: openAddModal, close: closeAddModal }] =
        useDisclosure(false);
    const [searchParams] = useSearchParams();
    const bookmarkletFeedUrl = searchParams.get('addFeedUrl');
    const [handledBookmarkletUrl, setHandledBookmarkletUrl] = useState<
        string | null
    >(null);
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const management = useQuery(subscriptionManagementQueryOptions);
    const displayedError = error ?? management.error;

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
                                    management={management.data}
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

function feedRefreshStatus(
    subscription: ManagedSubscription | undefined,
): string {
    if (subscription?.lastAttemptAt === null || subscription === undefined) {
        return 'Never refreshed';
    }
    const timestamp = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(subscription.lastAttemptAt));
    return subscription.consecutiveFailures > 0
        ? `Last refresh failed ${timestamp}`
        : `Last refreshed ${timestamp}`;
}

function CategoryGroup({
    active,
    categoryId,
    categoryName,
    subscriptions,
    state,
    management,
    onNavigate,
}: {
    readonly active: boolean;
    readonly categoryId: number;
    readonly categoryName: string;
    readonly subscriptions: ReaderSubscriptionList['subscriptions'];
    readonly state: ReaderState;
    readonly management:
        | {
              readonly categories: readonly ManagedCategory[];
              readonly subscriptions: readonly ManagedSubscription[];
          }
        | undefined;
    readonly onNavigate?: () => void;
}) {
    const navigate = useNavigate();
    const autoOpened = subscriptions.length > 0;
    const [manualOpened, setManualOpened] = useState<boolean | null>(null);
    const opened = manualOpened ?? autoOpened;
    const totalCount = subscriptions.reduce(
        (total, subscription) => total + subscription.totalCount,
        0,
    );

    const feedsId = `reader-category-${categoryId}-feeds`;

    return (
        <div>
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
                    to={readerHref(state, {
                        categoryId: active ? null : categoryId,
                        feedId: null,
                    })}
                />
                <CategoryHeader
                    categoryId={categoryId}
                    entriesCount={totalCount}
                    feedCount={subscriptions.length}
                    feedIds={subscriptions.map(
                        (subscription) => subscription.feedId,
                    )}
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
                    onClick={() =>
                        setManualOpened((current) =>
                            current === null ? !opened : !current,
                        )
                    }
                    size="xs"
                    type="button"
                    variant="subtle"
                >
                    <IconChevronRight
                        aria-hidden="true"
                        size={15}
                        stroke={1.5}
                    />
                </ActionIcon>
            </div>
            <Collapse expanded={opened} id={feedsId}>
                <div className={classes.categoryFeeds}>
                    {subscriptions.map((subscription) => {
                        const feedActive = state.feedId === subscription.feedId;
                        const name =
                            subscription.customFeedName ??
                            subscription.feedName;
                        const managed = management?.subscriptions.find(
                            (item) => item.feedId === subscription.feedId,
                        );
                        return (
                            <Tooltip
                                key={subscription.feedId}
                                label={
                                    <Stack gap={2}>
                                        <Text fw={500} size="sm">
                                            {name}
                                        </Text>
                                        <Text c="dimmed" size="xs">
                                            {feedRefreshStatus(managed)}
                                        </Text>
                                    </Stack>
                                }
                                multiline
                                openDelay={1000}
                                position="right"
                                withArrow
                            >
                                <div
                                    className={`${classes.collectionLink} ${
                                        feedActive ? classes.activeFeed : ''
                                    }`}
                                >
                                    <div className={classes.feedRow}>
                                        <Link
                                            className={
                                                classes.feedNavigationLink
                                            }
                                            onClick={onNavigate}
                                            to={readerHref(state, {
                                                feedId: subscription.feedId,
                                                categoryId: null,
                                                filter: 'all',
                                            })}
                                        >
                                            <Indicator
                                                color="orange"
                                                disabled={
                                                    managed === undefined ||
                                                    managed.consecutiveFailures ===
                                                        0
                                                }
                                                withBorder
                                            >
                                                <div
                                                    className={
                                                        classes.feedRowLeft
                                                    }
                                                >
                                                    <FeedFavicon
                                                        isDark={
                                                            subscription.faviconIsDark
                                                        }
                                                        size={18}
                                                        src={
                                                            subscription.faviconUrl
                                                        }
                                                    />
                                                    <span
                                                        className={
                                                            classes.feedName
                                                        }
                                                    >
                                                        {name}
                                                    </span>
                                                </div>
                                            </Indicator>
                                        </Link>
                                        <FeedActions
                                            categories={
                                                management?.categories ?? []
                                            }
                                            managed={managed}
                                            onUnsubscribed={() => {
                                                if (feedActive) {
                                                    void navigate(
                                                        readerHref(state, {
                                                            categoryId: null,
                                                            entryId: null,
                                                            feedId: null,
                                                        }),
                                                    );
                                                }
                                            }}
                                            showCount
                                            subscription={subscription}
                                        />
                                    </div>
                                </div>
                            </Tooltip>
                        );
                    })}
                </div>
            </Collapse>
        </div>
    );
}

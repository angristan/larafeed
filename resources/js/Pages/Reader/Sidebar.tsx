import { Link, router, useForm } from '@inertiajs/react';
import {
    ActionIcon,
    AppShell,
    Badge,
    Button,
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
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconBook,
    IconCategory,
    IconCheckbox,
    IconChevronRight,
    IconDots,
    IconExclamationCircle,
    IconInfoCircle,
    IconPlus,
    IconRss,
    IconSearch,
    IconStar,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import {
    type FormEventHandler,
    type ReactNode,
    useEffect,
    useState,
} from 'react';
import { FaviconImage } from '@/Components/FaviconImage/FaviconImage';
import { FeedMenu } from '@/Components/FeedMenu';
import classes from './Sidebar.module.css';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export default function Sidebar({
    feeds,
    unreadEntriesCount,
    readEntriesCount,
    categories,
}: {
    feeds: Feed[];
    unreadEntriesCount: number;
    readEntriesCount: number;
    categories: Category[];
}) {
    interface FeedsByCategory {
        [key: number]: Feed[];
    }

    const [searchTerm, setSearchTerm] = useState('');

    const normalizedSearchTerm = searchTerm.trim().toLowerCase();

    const filteredFeeds = normalizedSearchTerm
        ? feeds.filter((feed) =>
              feed.name.toLowerCase().includes(normalizedSearchTerm),
          )
        : feeds;

    const sortedCategories = [...categories].sort((a, b) =>
        a.name.localeCompare(b.name),
    );

    const feedsPerCategory = sortedCategories.reduce<FeedsByCategory>(
        (acc, category) => {
            acc[category.id] = [];
            return acc;
        },
        {},
    );

    filteredFeeds.forEach((feed) => {
        if (feedsPerCategory[feed.category_id]) {
            feedsPerCategory[feed.category_id].push(feed);
        }
    });

    const visibleCategories =
        normalizedSearchTerm.length > 0
            ? sortedCategories.filter(
                  (category) => feedsPerCategory[category.id].length > 0,
              )
            : sortedCategories;

    const feedLinks = visibleCategories.map((category) => (
        <FeedLinksGroup
            key={category.id}
            category={category}
            feedsPerCategory={feedsPerCategory}
            categories={sortedCategories}
        />
    ));

    const noResults =
        normalizedSearchTerm.length > 0 && filteredFeeds.length === 0;

    const [opened, { open, close }] = useDisclosure(false);

    // Open pre-filled new feed modal if URL contains addFeedUrl
    const [hasBeenOpened, setHasBeenOpened] = useState(false);
    const addFeedParams = new URLSearchParams(window.location.search);
    const hasInitialFeedURL = addFeedParams.has('addFeedUrl');
    const initialFeedURL = addFeedParams.get('addFeedUrl') || undefined;

    useEffect(() => {
        if (hasInitialFeedURL && !hasBeenOpened) {
            open();
            setHasBeenOpened(true);
        }
    }, [hasBeenOpened, hasInitialFeedURL, open]);

    return (
        <>
            <AddFeedModal
                opened={opened}
                close={close}
                categories={sortedCategories}
                initialFeedURL={initialFeedURL}
            />
            <AppShell.Navbar
                id="app-sidebar-navigation"
                aria-label="Feeds and filters"
            >
                <AppShell.Section pr="md" pl="md" pt="md">
                    <TextInput
                        aria-label="Filter subscriptions"
                        placeholder="Filter subscriptions"
                        size="xs"
                        leftSection={<IconSearch size={12} stroke={1.5} />}
                        rightSectionWidth={30}
                        rightSectionPointerEvents={searchTerm ? 'all' : 'none'}
                        rightSection={
                            searchTerm ? (
                                <ActionIcon
                                    aria-label="Clear subscription filter"
                                    onClick={() => setSearchTerm('')}
                                    size="xs"
                                    variant="subtle"
                                >
                                    <IconX size={12} stroke={1.5} />
                                </ActionIcon>
                            ) : null
                        }
                        value={searchTerm}
                        onChange={(event) =>
                            setSearchTerm(event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                setSearchTerm('');
                            }
                        }}
                        mb="sm"
                    />
                </AppShell.Section>

                <AppShell.Section>
                    <div className={classes.mainLinks}>
                        <FilterLinks
                            unreadEntriesCount={unreadEntriesCount}
                            readEntriesCount={readEntriesCount}
                        />
                    </div>
                </AppShell.Section>

                <Divider mb="sm" />

                <AppShell.Section>
                    <Group
                        className={classes.collectionsHeader}
                        justify="space-between"
                    >
                        <Text size="xs" fw={500} c="dimmed">
                            Feeds
                        </Text>
                        <Tooltip
                            label="Create feed or category"
                            withArrow
                            position="right"
                        >
                            <ActionIcon
                                aria-label="Create feed or category"
                                onClick={open}
                                variant="default"
                                size="sm"
                            >
                                <IconPlus size={12} stroke={1.5} />
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                </AppShell.Section>
                <AppShell.Section grow component={ScrollArea}>
                    <div className={classes.collections}>
                        {noResults ? (
                            <Text size="xs" c="dimmed" pl="xs" pr="xs">
                                No subscriptions match your filter.
                            </Text>
                        ) : (
                            feedLinks
                        )}
                    </div>
                </AppShell.Section>
            </AppShell.Navbar>
        </>
    );
}

const FilterLinks = function FilterLinks({
    unreadEntriesCount,
    readEntriesCount,
}: {
    unreadEntriesCount: number;
    readEntriesCount: number;
}) {
    const links = [
        {
            label: 'Unread',
            icon: (
                <IconBook
                    size={20}
                    className={classes.mainLinkIcon}
                    stroke={1.5}
                />
            ),
            readEntriesCount,
            unreadEntriesCount,
        },
        {
            label: 'Read',
            icon: (
                <IconCheckbox
                    size={20}
                    className={classes.mainLinkIcon}
                    stroke={1.5}
                />
            ),
            readEntriesCount,
            unreadEntriesCount,
        },
        {
            label: 'Favorites',
            icon: (
                <IconStar
                    size={20}
                    className={classes.mainLinkIcon}
                    stroke={1.5}
                />
            ),
            readEntriesCount,
            unreadEntriesCount,
        },
    ];

    return (
        <div className={classes.mainLinks}>
            {links.map((link) => (
                <FilterLink
                    key={link.label}
                    label={link.label}
                    icon={link.icon}
                    readEntriesCount={link.readEntriesCount}
                    unreadEntriesCount={link.unreadEntriesCount}
                />
            ))}
        </div>
    );
};

const FilterLink = function FilterLink({
    label,
    icon,
    readEntriesCount,
    unreadEntriesCount,
}: {
    label: string;
    icon: ReactNode;
    readEntriesCount: number;
    unreadEntriesCount: number;
}) {
    const params = new URLSearchParams(window.location.search);
    params.delete('page');
    params.delete('entry');
    params.delete('read');
    params.delete('summarize');

    const currentFilter = params.get('filter');
    const filterValue = label.toLowerCase();
    const isActive = currentFilter === filterValue;

    if (isActive) {
        // Clicking again -> remove the filter
        params.delete('filter');
    } else {
        params.set('filter', filterValue);
    }

    return (
        <Link
            key={label}
            className={`${classes.mainLink} ${
                isActive ? classes.activeFeed : ''
            }`}
            href={route('feeds.index')}
            only={['entries', 'currententry', 'summary']}
            preserveScroll
            preserveState
            data={{
                ...Object.fromEntries(params),
            }}
            prefetch
            aria-current={isActive ? 'page' : undefined}
        >
            <div className={classes.mainLinkInner}>
                {icon}
                <span>{label}</span>
            </div>
            {label === 'Unread' && unreadEntriesCount > 0 && (
                <Badge
                    size="sm"
                    variant="filled"
                    className={classes.mainLinkBadge}
                >
                    {unreadEntriesCount}
                </Badge>
            )}
            {label === 'Read' && readEntriesCount > 0 && (
                <Badge
                    size="sm"
                    variant="default"
                    className={classes.mainLinkBadge}
                >
                    {readEntriesCount}
                </Badge>
            )}
        </Link>
    );
};

interface FeedLinksGroupProps {
    category: Category;
    feedsPerCategory: Record<number, Feed[]>;
    categories: Category[];
}

export const FeedLinksGroup = ({
    category,
    feedsPerCategory,
    categories,
}: FeedLinksGroupProps) => {
    const autoOpened = feedsPerCategory[category.id].length > 0;
    const [manualOpened, setManualOpened] = useState<boolean | null>(null);
    const opened = manualOpened ?? autoOpened;
    const categoryEntriesCount = feedsPerCategory[category.id].reduce(
        (acc, feed) => acc + feed.entries_count,
        0,
    );
    const categoryFeedsID = `category-${category.id}-feeds`;

    const params = new URLSearchParams(window.location.search);
    params.delete('feed');
    params.delete('page');
    params.delete('entry');
    params.delete('read');
    params.delete('summarize');

    const currentCategory = params.get('category');
    const isActive = currentCategory === category.id.toString();

    if (isActive) {
        // Clicking again -> unselect the category
        params.delete('category');
    } else {
        params.set('category', category.id.toString());
    }

    return (
        <div>
            <Group gap={4} wrap="nowrap" className={classes.categoryRow}>
                <NavLink
                    component={Link}
                    className={classes.categoryLink}
                    href={route('feeds.index')}
                    only={['entries', 'currententry', 'summary']}
                    prefetch
                    preserveScroll
                    preserveState
                    data={{
                        ...Object.fromEntries(params),
                    }}
                    active={isActive}
                    aria-current={isActive ? 'page' : undefined}
                    label={category.name}
                    leftSection={<IconRss size={15} stroke={1.5} />}
                    rightSection={
                        <Badge
                            size="sm"
                            variant="default"
                            className={classes.mainLinkBadge}
                        >
                            {categoryEntriesCount}
                        </Badge>
                    }
                />

                <CategoryHeader
                    category={category}
                    feedCount={feedsPerCategory[category.id].length}
                />

                <ActionIcon
                    aria-controls={categoryFeedsID}
                    aria-expanded={opened}
                    aria-label={`${opened ? 'Collapse' : 'Expand'} ${category.name}`}
                    color="gray"
                    onClick={() =>
                        setManualOpened((current) => {
                            if (current === null) {
                                return !opened;
                            }

                            return !current;
                        })
                    }
                    size="sm"
                    variant="subtle"
                >
                    <IconChevronRight
                        className={`${classes.categoryChevron} ${
                            opened ? classes.categoryChevronOpened : ''
                        }`}
                        size={15}
                        stroke={1.5}
                    />
                </ActionIcon>
            </Group>

            <div
                className={classes.categoryFeeds}
                hidden={!opened}
                id={categoryFeedsID}
            >
                {feedsPerCategory[category.id].map((feed: Feed) => (
                    <FeedLink
                        key={feed.id}
                        feed={feed}
                        categories={categories}
                    />
                ))}
            </div>
        </div>
    );
};

export function CategoryHeader({
    category,
    feedCount,
}: {
    category: Category;
    feedCount: number;
}) {
    const [opened, setOpened] = useState(false);

    return (
        <Menu shadow="md" opened={opened} onChange={setOpened}>
            <Menu.Target>
                <ActionIcon
                    aria-expanded={opened}
                    aria-haspopup="menu"
                    aria-label={`${opened ? 'Close' : 'Open'} actions for category ${category.name}`}
                    color="gray"
                    onClick={(event) => event.stopPropagation()}
                    size="sm"
                    variant="subtle"
                >
                    <IconDots size={15} stroke={1.5} />
                </ActionIcon>
            </Menu.Target>

            <Menu.Dropdown>
                <Menu.Label>Manage category</Menu.Label>

                <Menu.Item
                    color="red"
                    disabled={feedCount > 0}
                    leftSection={
                        <IconTrash
                            style={{
                                width: rem(14),
                                height: rem(14),
                            }}
                        />
                    }
                    onClick={(e) => {
                        e.stopPropagation();
                        router.delete(route('category.delete', category.id), {
                            preserveScroll: true,
                            preserveState: true,
                            onSuccess: () => {
                                notifications.show({
                                    title: 'Category deleted',
                                    message: `The category ${category.name} has been deleted`,
                                    color: 'green',
                                    withBorder: true,
                                });
                            },
                            onError: (error) => {
                                notifications.show({
                                    title: `Failed to delete category ${category.name}`,
                                    message: error.message,
                                    color: 'red',
                                    withBorder: true,
                                });
                            },
                        });
                    }}
                >
                    {feedCount > 0
                        ? 'Delete (needs to be empty)'
                        : 'Delete category'}
                </Menu.Item>
            </Menu.Dropdown>
        </Menu>
    );
}

const AddFeedModal = function AddFeedModal({
    opened,
    close,
    categories,
    initialFeedURL,
}: {
    opened: boolean;
    close: () => void;
    categories: Category[];
    initialFeedURL?: string;
}) {
    const [value, setValue] = useState('new_feed');

    return (
        <Modal.Root
            opened={opened}
            onClose={() => {
                close();
            }}
        >
            <Modal.Overlay />
            <Modal.Content>
                <Modal.Header>
                    <Modal.Title>
                        <SegmentedControl
                            value={value}
                            onChange={setValue}
                            radius="sm"
                            size="sm"
                            data={[
                                { value: 'new_feed', label: 'New feed' },
                                {
                                    value: 'new_category',
                                    label: 'New category',
                                },
                            ]}
                        />
                    </Modal.Title>
                    <Modal.CloseButton />
                </Modal.Header>
                <Modal.Body>
                    <Fieldset variant="filled">
                        {value === 'new_feed' && (
                            <AddFeedForm
                                categories={categories}
                                close={close}
                                initialFeedURL={initialFeedURL}
                            />
                        )}

                        {value === 'new_category' && (
                            <AddCategoryForm close={close} />
                        )}
                    </Fieldset>
                </Modal.Body>
            </Modal.Content>
        </Modal.Root>
    );
};

const AddFeedForm = function AddFeedForm({
    categories,
    close,
    initialFeedURL,
}: {
    categories: Category[];
    close: () => void;
    initialFeedURL?: string;
}) {
    const initialCategorySelection =
        categories.length > 0 ? categories[0].id.toString() : 'new';

    const { data, setData, post, errors, processing, transform } = useForm({
        feed_url: initialFeedURL || '',
        category_selection: initialCategorySelection,
        category_name: '',
    });

    // Transform the feed URL to have a protocol if it doesn't have one
    transform((data) => {
        const feedUrl = /^(http|https):\/\//.test(data.feed_url)
            ? data.feed_url
            : `https://${data.feed_url}`;

        setData('feed_url', feedUrl);

        if (data.category_selection === 'new') {
            return {
                feed_url: feedUrl,
                category_name: data.category_name.trim(),
            };
        }

        return {
            feed_url: feedUrl,
            category_id: parseInt(data.category_selection, 10),
        };
    });

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        post(route('feed.store'), {
            onSuccess: () => {
                notifications.show({
                    title: 'Feed added',
                    message: 'The feed has been added',
                    color: 'green',
                    withBorder: true,
                });

                close();
            },
            onError: (errors) => {
                notifications.show({
                    title: 'Failed to add feed',
                    message: errors.feed_url,
                    color: 'red',
                    withBorder: true,
                });
            },
        });
    };

    return (
        <form onSubmit={submit}>
            <TextInput
                type="text"
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
                description={
                    <Text size="xs" c="dimmed">
                        You can use the URL of the website or the URL of the RSS
                        feed, we will try to find the feed for you!
                    </Text>
                }
                placeholder="https://blog.cloudflare.com/rss/"
                withErrorStyles={false}
                rightSectionPointerEvents="none"
                rightSection={
                    errors.feed_url && (
                        <IconExclamationCircle
                            style={{
                                width: rem(20),
                                height: rem(20),
                            }}
                            color="var(--mantine-color-error)"
                        />
                    )
                }
                data-autofocus
                value={data.feed_url}
                onChange={(e) => setData('feed_url', e.target.value)}
                error={errors.feed_url}
            />

            <Text size="xs" mt="sm" c="dimmed">
                <IconInfoCircle
                    style={{
                        width: rem(10),
                        height: rem(10),
                    }}
                />{' '}
                Tip: drag this{' '}
                <a
                    href={`javascript:location.href='${route('feeds.index')}/?addFeedUrl='+encodeURIComponent(window.location.href)`}
                >
                    link
                </a>{' '}
                to your bookmark bar. When you are on a website, click on the
                bookmark and you'll be redirected here with the URL pre-filled!
            </Text>

            <NativeSelect
                mt={10}
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
                description={
                    <Text size="xs" c="dimmed">
                        The category where the feed will be added
                    </Text>
                }
                data={[
                    ...categories.map((category) => ({
                        value: category.id.toString(),
                        label: category.name,
                    })),
                    {
                        value: 'new',
                        label: 'Create new category',
                    },
                ]}
                value={data.category_selection}
                onChange={(e) => setData('category_selection', e.target.value)}
                error={errors.category_selection}
            />

            {data.category_selection === 'new' && (
                <TextInput
                    mt="sm"
                    type="text"
                    label={
                        <Group gap={5}>
                            <IconCategory
                                style={{
                                    width: rem(10),
                                    height: rem(10),
                                }}
                            />
                            <span>New category name</span>
                        </Group>
                    }
                    description={
                        <Text size="xs" c="dimmed">
                            We will create this category and add the feed to it
                            automatically
                        </Text>
                    }
                    placeholder="Tech"
                    withErrorStyles={false}
                    rightSectionPointerEvents="none"
                    rightSection={
                        errors.category_name && (
                            <IconExclamationCircle
                                style={{
                                    width: rem(20),
                                    height: rem(20),
                                }}
                                color="var(--mantine-color-error)"
                            />
                        )
                    }
                    value={data.category_name}
                    onChange={(e) => setData('category_name', e.target.value)}
                    error={errors.category_name}
                    data-autofocus={categories.length === 0}
                />
            )}

            <Button
                mt="md"
                fullWidth
                type="submit"
                disabled={
                    processing ||
                    (data.category_selection === 'new' &&
                        data.category_name.trim().length === 0)
                }
                loading={processing}
            >
                Submit
            </Button>
        </form>
    );
};

const AddCategoryForm = function AddCategoryForm({
    close,
}: {
    close: () => void;
}) {
    const { data, setData, post, errors, processing } = useForm({
        categoryName: '',
    });

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        post(route('category.store'), {
            onSuccess: () => {
                notifications.show({
                    title: 'Category added',
                    message: 'The category has been added',
                    color: 'green',
                    withBorder: true,
                });

                close();
            },
            onError: (errors) => {
                notifications.show({
                    title: 'Failed to add category',
                    message: errors.categoryName,
                    color: 'red',
                    withBorder: true,
                });
            },
        });
    };

    return (
        <form onSubmit={submit}>
            <TextInput
                type="text"
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
                description={
                    <Text size="xs" c="dimmed">
                        You will then be able to assign feeds to this category
                    </Text>
                }
                placeholder="Tech"
                data-autofocus
                value={data.categoryName}
                onChange={(e) => setData('categoryName', e.target.value)}
                withErrorStyles={false}
                rightSectionPointerEvents="none"
                rightSection={
                    errors.categoryName && (
                        <IconExclamationCircle
                            style={{
                                width: rem(20),
                                height: rem(20),
                            }}
                            color="var(--mantine-color-error)"
                        />
                    )
                }
                error={errors.categoryName}
            />
            <Button
                mt="md"
                fullWidth
                type="submit"
                disabled={processing}
                loading={processing}
            >
                Submit
            </Button>
        </form>
    );
};

const FeedLink = function FeedLink({
    feed,
    categories,
}: {
    feed: Feed;
    categories: Category[];
}) {
    const failedAt = feed.last_failed_refresh_at;
    const successAt = feed.last_successful_refresh_at;
    const showFailed =
        failedAt && (!successAt || dayjs(failedAt).isAfter(successAt));

    const refreshStatus = (() => {
        const referenceDate = showFailed ? failedAt : successAt;

        if (!referenceDate) {
            return 'Feed has not refreshed yet';
        }

        return `${showFailed ? 'Last refresh failed' : 'Last refresh successful'} ${dayjs
            .utc(referenceDate)
            .fromNow()}`;
    })();

    const urlParams = new URLSearchParams(window.location.search);
    urlParams.delete('filter');
    urlParams.delete('page');
    urlParams.delete('category');
    urlParams.delete('entry');
    urlParams.delete('read');
    urlParams.delete('summarize');
    urlParams.set('feed', feed.id.toString());
    const isActive =
        new URLSearchParams(window.location.search).get('feed') ===
        feed.id.toString();

    return (
        <Tooltip
            withArrow
            position="right"
            openDelay={1000}
            multiline
            styles={{
                tooltip: {
                    whiteSpace: 'normal',
                    width: 'max-content',
                    maxWidth: 'none',
                },
            }}
            label={
                <Stack gap={2}>
                    <Text
                        size="sm"
                        fw={500}
                        style={{ wordBreak: 'break-word' }}
                    >
                        {feed.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                        {refreshStatus}
                    </Text>
                </Stack>
            }
        >
            <div className={classes.feedRow}>
                <Link
                    className={`${classes.collectionLink} ${
                        isActive ? classes.activeFeed : ''
                    }`}
                    href={route('feeds.index')}
                    only={['entries', 'currententry', 'summary']}
                    preserveScroll
                    preserveState
                    data={{
                        ...Object.fromEntries(urlParams),
                    }}
                    prefetch
                    aria-current={isActive ? 'page' : undefined}
                >
                    <Indicator
                        className={classes.feedLinkIndicator}
                        color="orange"
                        withBorder
                        disabled={
                            feed.last_failed_refresh_at
                                ? dayjs(
                                      feed.last_successful_refresh_at,
                                  ).isAfter(dayjs(feed.last_failed_refresh_at))
                                : true
                        }
                    >
                        <div className={classes.feedRowLeft}>
                            <FaviconImage
                                src={feed.favicon_url}
                                isDark={feed.favicon_is_dark}
                                w={18}
                                h={18}
                            />
                            <span className={classes.feedName}>
                                {feed.name}
                            </span>
                        </div>
                    </Indicator>
                </Link>
                <div className={classes.feedActions}>
                    <FeedMenu
                        feed={feed}
                        categories={categories}
                        showOnHover={true}
                        className={classes.feedMenuIcon}
                        showBadge={true}
                        badgeContent={
                            <Badge
                                size="sm"
                                variant="default"
                                className={classes.mainLinkBadge}
                            >
                                {feed.entries_count}
                            </Badge>
                        }
                    />
                </div>
            </div>
        </Tooltip>
    );
};

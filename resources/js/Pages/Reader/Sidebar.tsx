import { Link, router, useForm } from '@inertiajs/react';
import {
    ActionIcon,
    AppShell,
    Badge,
    Button,
    Code,
    Divider,
    Fieldset,
    Group,
    Image,
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
    IconExclamationCircle,
    IconInfoCircle,
    IconPencil,
    IconPlus,
    IconRss,
    IconSearch,
    IconStar,
    IconTrash,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { type FormEventHandler, type ReactNode, useState } from 'react';
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

    const { hovered, ref } = useHover();

    // Open pre-filled new feed modal if URL contains addFeedUrl
    const [hasBeenOpened, setHasBeenOpened] = useState(false);
    if (window.location.search.includes('addFeedUrl')) {
        if (!hasBeenOpened) {
            if (!opened) {
                open();
                setHasBeenOpened(true);
            }
        }
    }

    return (
        <>
            <AddFeedModal
                opened={opened}
                close={close}
                categories={sortedCategories}
                initialFeedURL={
                    new URLSearchParams(window.location.search).get(
                        'addFeedUrl',
                    ) || undefined
                }
            />
            <AppShell.Navbar>
                <AppShell.Section pr="md" pl="md" pt="md">
                    <TextInput
                        placeholder="Search"
                        size="xs"
                        leftSection={<IconSearch size={12} stroke={1.5} />}
                        rightSectionWidth={70}
                        rightSection={
                            <Code className={classes.searchCode}>Ctrl + K</Code>
                        }
                        styles={{ section: { pointerEvents: 'none' } }}
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
                            opened={
                                (feedLinks.length === 0 && !noResults) ||
                                hovered
                            }
                        >
                            <ActionIcon
                                onClick={open}
                                variant="default"
                                size={18}
                                ref={ref}
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
                                No feeds match your search.
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

    const currentFilter = params.get('filter');
    if (currentFilter === label.toLowerCase()) {
        // Clicking again -> remove the filter
        params.delete('filter');
    } else {
        params.set('filter', label.toLowerCase());
    }

    return (
        <Link
            key={label}
            className={`${classes.mainLink} ${
                label.toLowerCase() ===
                new URLSearchParams(window.location.search).get('filter')
                    ? classes.activeFeed
                    : ''
            }`}
            href={route('feeds.index')}
            only={['entries']}
            preserveScroll
            preserveState
            data={{
                ...Object.fromEntries(params),
            }}
            prefetch
            as="div"
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

    const params = new URLSearchParams(window.location.search);
    params.delete('feed');

    const currentCategory = params.get('category');
    if (currentCategory === category.id.toString()) {
        // Clicking again -> unselect the category
        params.delete('category');
    } else {
        params.set('category', category.id.toString());
    }

    return (
        <Link
            href={route('feeds.index')}
            only={['entries']}
            prefetch
            preserveScroll
            preserveState
            data={{
                ...Object.fromEntries(params),
            }}
            as="div"
        >
            <NavLink
                key={category.id}
                onClick={() => {
                    // This should not be needed as the NavLink is wrapped in a Link
                    // But for some reason the click does not work on the Link.
                    // We keep the Link for the prefetch on hover
                    router.visit(route('feeds.index'), {
                        only: ['entries'],
                        preserveScroll: true,
                        preserveState: true,
                        data: {
                            ...Object.fromEntries(params),
                        },
                    });
                }}
                active={
                    new URLSearchParams(window.location.search).get(
                        'category',
                    ) === category.id.toString()
                }
                label={
                    <CategoryHeader
                        category={category}
                        entriesCount={feedsPerCategory[category.id].reduce(
                            (acc, feed) => acc + feed.entries_count,
                            0,
                        )}
                        feedCount={feedsPerCategory[category.id].length}
                    />
                }
                opened={manualOpened ?? opened}
                defaultOpened
                leftSection={<IconRss size={15} stroke={1.5} />}
                rightSection={
                    <IconChevronRight
                        size={15}
                        stroke={1.5}
                        onClick={(e) => {
                            e.stopPropagation();
                            setManualOpened((current) => {
                                if (current === null) {
                                    return !opened;
                                }

                                return !current;
                            });
                        }}
                    />
                }
            >
                {feedsPerCategory[category.id].map((feed: Feed) => (
                    <FeedLink
                        key={feed.id}
                        feed={feed}
                        categories={categories}
                    />
                ))}
            </NavLink>
        </Link>
    );
};

export function CategoryHeader({
    category,
    entriesCount,
    feedCount,
}: {
    category: Category;
    entriesCount: number;
    feedCount: number;
}) {
    const { hovered, ref } = useHover();
    const [opened, setOpened] = useState(false);

    return (
        <Menu shadow="md" opened={opened} onChange={setOpened}>
            <Group justify="space-between" ref={ref}>
                <span>{category.name}</span>
                <Menu.Target>
                    {hovered || opened ? (
                        <ActionIcon
                            size="xs"
                            color="gray"
                            className={classes.feedMenuIcon}
                            onClick={(e) => {
                                e.stopPropagation();
                                setOpened(!opened);
                            }}
                        >
                            <IconDots size={15} stroke={1.5} />
                        </ActionIcon>
                    ) : (
                        <Badge
                            size="sm"
                            variant="default"
                            className={classes.mainLinkBadge}
                        >
                            {entriesCount}
                        </Badge>
                    )}
                </Menu.Target>
            </Group>

            <Menu.Dropdown>
                <Menu.Label>Manage category</Menu.Label>

                <Menu.Item
                    onClick={(e) => {
                        e.stopPropagation();
                    }}
                    leftSection={
                        <IconCheck
                            style={{
                                width: rem(14),
                                height: rem(14),
                            }}
                        />
                    }
                >
                    Mark feeds as read
                </Menu.Item>

                <Menu.Item
                    leftSection={
                        <IconPencil
                            style={{
                                width: rem(14),
                                height: rem(14),
                            }}
                        />
                    }
                >
                    Edit category name
                </Menu.Item>

                <Menu.Divider />

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

    const form = useForm({
        feed_url: initialFeedURL || '',
        category_selection: initialCategorySelection,
        category_name: '',
    }).withPrecognition('post', route('feed.store'));

    const { data, setData, post, errors, processing, transform, validate } =
        form;

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
                onBlur={() => validate('feed_url')}
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
                    onBlur={() => validate('category_name')}
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
    const form = useForm({
        categoryName: '',
    }).withPrecognition('post', route('category.store'));

    const { data, setData, post, errors, processing, validate } = form;

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
                onBlur={() => validate('categoryName')}
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
    const { ref } = useHover();

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
    urlParams.set('feed', feed.id.toString());

    return (
        <div
            onClick={(e) => {
                // Prevent the click from propagating to the category Link
                e.stopPropagation();
            }}
        >
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
                <Link
                    ref={ref}
                    key={feed.id}
                    className={`${classes.collectionLink} ${
                        feed.id.toString() ===
                        new URLSearchParams(window.location.search).get('feed')
                            ? classes.activeFeed
                            : ''
                    }`}
                    as="div"
                    href={route('feeds.index')}
                    only={['feed', 'entries']}
                    preserveScroll
                    preserveState
                    data={{
                        ...Object.fromEntries(urlParams),
                    }}
                    prefetch
                >
                    <Indicator
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
                        <div className={classes.feedRow}>
                            <div className={classes.feedRowLeft}>
                                <Image src={feed.favicon_url} w={15} h={15} />
                                <span className={classes.feedName}>
                                    {feed.name}
                                </span>
                            </div>
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
                    </Indicator>
                </Link>
            </Tooltip>
        </div>
    );
};

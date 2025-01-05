import classes from './Sidebar.module.css';

import { router, useForm } from '@inertiajs/react';
import {
    ActionIcon,
    AppShell,
    Badge,
    Button,
    Code,
    Fieldset,
    Group,
    Image,
    Indicator,
    Menu,
    Modal,
    NativeSelect,
    NavLink,
    ScrollArea,
    SegmentedControl,
    Space,
    Text,
    TextInput,
    Tooltip,
    UnstyledButton,
    rem,
} from '@mantine/core';
import { useDisclosure, useHover } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconBook,
    IconCheck,
    IconCheckbox,
    IconDots,
    IconExclamationCircle,
    IconExternalLink,
    IconPencil,
    IconPlus,
    IconRefresh,
    IconRss,
    IconSearch,
    IconStar,
    IconTrash,
} from '@tabler/icons-react';
import axios, { AxiosError } from 'axios';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { FormEventHandler, useEffect, useState } from 'react';

dayjs.extend(relativeTime);
dayjs.extend(utc);

const links = [
    { icon: IconBook, label: 'Unread' },
    { icon: IconCheckbox, label: 'Read' },
    { icon: IconStar, label: 'Favorites' },
];

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
    const mainLinks = links.map((link) => (
        <UnstyledButton
            key={link.label}
            className={classes.mainLink}
            onClick={() => {
                const urlParams = new URLSearchParams(window.location.search);
                urlParams.delete('feed');
                urlParams.set('filter', link.label.toLowerCase());

                router.visit('feeds', {
                    only: ['entries'],
                    data: {
                        ...Object.fromEntries(urlParams),
                    },
                    preserveScroll: true,
                    preserveState: true,
                });
            }}
        >
            <div className={classes.mainLinkInner}>
                <link.icon
                    size={20}
                    className={classes.mainLinkIcon}
                    stroke={1.5}
                />
                <span>{link.label}</span>
            </div>
            {link.label === 'Unread' && unreadEntriesCount > 0 && (
                <Badge
                    size="sm"
                    variant="filled"
                    className={classes.mainLinkBadge}
                >
                    {unreadEntriesCount}
                </Badge>
            )}
            {link.label === 'Read' && readEntriesCount > 0 && (
                <Badge
                    size="sm"
                    variant="default"
                    className={classes.mainLinkBadge}
                >
                    {readEntriesCount}
                </Badge>
            )}
        </UnstyledButton>
    ));

    interface FeedsByCategory {
        [key: number]: Feed[];
    }

    const feedsPerCategory = categories
        .sort((a, b) => a.name.localeCompare(b.name))
        .reduce<FeedsByCategory>((acc, category) => {
            acc[category.id] = [];
            return acc;
        }, {});

    feeds.forEach((feed) => {
        feedsPerCategory[feed.category_id].push(feed);
    });

    const feedLinks = categories.map((category) => (
        <FeedLinksGroup
            key={category.id}
            category={category}
            feedsPerCategory={feedsPerCategory}
            categories={categories}
        />
    ));

    const [opened, { open, close }] = useDisclosure(false);

    const { hovered, ref } = useHover();

    return (
        <>
            <AddFeedModal
                opened={opened}
                close={close}
                categories={categories}
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
                        mb="sm"
                    />
                </AppShell.Section>

                <AppShell.Section>
                    <div className={classes.mainLinks}>{mainLinks}</div>
                </AppShell.Section>

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
                            opened={feedLinks.length === 0 || hovered}
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
                    <div className={classes.collections}>{feedLinks}</div>
                </AppShell.Section>
            </AppShell.Navbar>
        </>
    );
}

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
    const [opened, setOpened] = useState(
        feedsPerCategory[category.id].length > 0,
    );

    useEffect(() => {
        setOpened(feedsPerCategory[category.id].length > 0);
    }, [category.id, feedsPerCategory]);

    return (
        <NavLink
            key={category.id}
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
            opened={opened}
            defaultOpened={feedsPerCategory[category.id].length > 0}
            leftSection={<IconRss size={15} stroke={1.5} />}
            onClick={(e) => {
                e.preventDefault();
                setOpened(!opened);
            }}
        >
            {feedsPerCategory[category.id].map((feed: Feed) => (
                <FeedLink key={feed.id} feed={feed} categories={categories} />
            ))}
        </NavLink>
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
                            size="xs"
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
}: {
    opened: boolean;
    close: () => void;
    categories: Category[];
}) {
    const [value, setValue] = useState('new_feed');

    return (
        <>
            <Modal.Root opened={opened} onClose={close}>
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
                                />
                            )}

                            {value === 'new_category' && (
                                <AddCategoryForm close={close} />
                            )}
                        </Fieldset>
                    </Modal.Body>
                </Modal.Content>
            </Modal.Root>
        </>
    );
};

const AddFeedForm = function AddFeedForm({
    categories,
    close,
}: {
    categories: Category[];
    close: () => void;
}) {
    const { data, setData, post, errors, processing } = useForm({
        feed_url: '',
        category_id: 1,
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
                label="Site URL"
                description="You can use the URL of the website or the RSS feed, we will try to find the feed for you"
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

            <NativeSelect
                mt={10}
                label="Category"
                description="The category where the feed will be added"
                data={categories.map((category) => ({
                    value: category.id.toString(),
                    label: category.name,
                }))}
                value={data.category_id.toString()}
                onChange={(e) =>
                    setData('category_id', parseInt(e.target.value))
                }
                error={errors.category_id}
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
                label="Category name"
                description="You will then be able to assign feeds to this category"
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

interface RefreshResponse {
    error?: string;
    message?: string;
}

const FeedLink = function FeedLink({
    feed,
    categories,
}: {
    feed: Feed;
    categories: Category[];
}) {
    const { hovered, ref } = useHover();
    const [opened, setOpened] = useState(false);
    const [
        deleteFeedModalopened,
        { open: openDeleteFeedModal, close: closeDeleteFeedModal },
    ] = useDisclosure(false);
    const [
        updateFeedCategoryModalOpened,
        {
            open: openUpdateFeedCategoryModal,
            close: closeUpdateFeedCategoryModal,
        },
    ] = useDisclosure(false);

    const markFeedAsRead = () => {
        router.post(
            route('feed.mark-read', feed.id),
            {},
            {
                only: [
                    // not yet as there is unread badge per feed on the sidebar
                    // 'feeds',
                    'unreadEntriesCount',
                    'readEntriesCount',
                    'entries', // unread badge in list
                    'currententry', // unread badge on entry
                ],
                onSuccess: () => {
                    notifications.show({
                        title: 'Feed marked as read',
                        message: `All entries from ${feed.name} have been marked as read.`,
                        color: 'blue',
                        withBorder: true,
                    });
                },
                onError: (error) => {
                    notifications.show({
                        title: 'Failed to mark feed as read',
                        message: error.message,
                        color: 'red',
                        withBorder: true,
                    });
                },
            },
        );
    };

    const requestRefresh = () => {
        axios
            .post<RefreshResponse>(route('feed.refresh', feed.id))
            .then((response) => {
                const { data } = response;
                if (data.error) {
                    notifications.show({
                        title: 'Failed to refresh feed',
                        message: data.error,
                        color: 'red',
                        withBorder: true,
                    });
                    return;
                }

                notifications.show({
                    title: data.message,
                    message: 'Check back in a few minutes',
                    color: 'blue',
                    withBorder: true,
                });
            })
            .catch((error: AxiosError<RefreshResponse>) => {
                if (error.response) {
                    if (error.response.status === 429) {
                        notifications.show({
                            title: 'What an avid reader you are!',
                            message: error.response.data.message,
                            color: 'yellow',
                            withBorder: true,
                        });
                        return;
                    }
                    notifications.show({
                        title: 'Failed to refresh feed',
                        message: error.response.data.error,
                        color: 'red',
                        withBorder: true,
                    });
                }
            });
    };

    return (
        <>
            <DeleteFeedModal
                feed={feed}
                opened={deleteFeedModalopened}
                onClose={closeDeleteFeedModal}
            />
            <UpdateFeedModal
                feed={feed}
                categories={categories}
                opened={updateFeedCategoryModalOpened}
                onClose={closeUpdateFeedCategoryModal}
            />
            <Tooltip
                withArrow
                position="right"
                openDelay={1000}
                label={`${feed.last_failed_refresh_at ? 'Last refresh failed' : 'Last refresh successful'} ${dayjs(
                    feed.last_failed_refresh_at
                        ? feed.last_failed_refresh_at
                        : feed.last_successful_refresh_at,
                ).fromNow()}`}
            >
                <div
                    ref={ref}
                    key={feed.id}
                    className={classes.collectionLink}
                    onClick={() => {
                        const urlParams = new URLSearchParams(
                            window.location.search,
                        );
                        urlParams.delete('filter');
                        urlParams.set('feed', feed.id.toString());

                        router.visit('feeds', {
                            only: ['feed', 'entries'],
                            data: {
                                ...Object.fromEntries(urlParams),
                            },
                            preserveScroll: true,
                            preserveState: true,
                        });
                    }}
                >
                    <Indicator
                        color="orange"
                        withBorder
                        disabled={!feed.last_failed_refresh_at}
                    >
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                width: '100%',
                                justifyContent: 'space-between',
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                }}
                            >
                                <Image
                                    src={feed.favicon_url}
                                    w={20}
                                    h={20}
                                    mr={9}
                                />
                                <span>{feed.name}</span>
                            </div>
                            <Menu
                                shadow="md"
                                width={200}
                                opened={opened}
                                onChange={setOpened}
                            >
                                <Menu.Target>
                                    {hovered || opened ? (
                                        <ActionIcon
                                            size="xs"
                                            color="gray"
                                            className={classes.feedMenuIcon}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                            }}
                                        >
                                            <IconDots size={15} stroke={1.5} />
                                        </ActionIcon>
                                    ) : (
                                        <Badge
                                            size="xs"
                                            variant="default"
                                            className={classes.mainLinkBadge}
                                        >
                                            {feed.entries_count}
                                        </Badge>
                                    )}
                                </Menu.Target>

                                <Menu.Dropdown>
                                    <Menu.Label>Manage feed</Menu.Label>

                                    <Menu.Item
                                        leftSection={
                                            <IconExternalLink
                                                style={{
                                                    width: rem(14),
                                                    height: rem(14),
                                                }}
                                            />
                                        }
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            window.open(
                                                feed.site_url,
                                                '_blank',
                                            );
                                        }}
                                    >
                                        Open website
                                    </Menu.Item>

                                    <Menu.Item
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            markFeedAsRead();
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
                                        Mark as read
                                    </Menu.Item>

                                    <Menu.Item
                                        leftSection={
                                            <IconRefresh
                                                style={{
                                                    width: rem(14),
                                                    height: rem(14),
                                                }}
                                            />
                                        }
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            requestRefresh();
                                        }}
                                    >
                                        Request refresh
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
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openUpdateFeedCategoryModal();
                                        }}
                                    >
                                        Edit feed
                                    </Menu.Item>

                                    <Menu.Divider />

                                    <Menu.Item
                                        color="red"
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
                                            openDeleteFeedModal();
                                        }}
                                    >
                                        Unsubscribe
                                    </Menu.Item>
                                </Menu.Dropdown>
                            </Menu>
                        </div>
                    </Indicator>
                </div>
            </Tooltip>
        </>
    );
};

const UpdateFeedModal = ({
    feed,
    categories,
    opened,
    onClose,
}: {
    feed: Feed;
    categories: Category[];
    opened: boolean;
    onClose: () => void;
}) => {
    const { data, setData, errors, processing } = useForm({
        category_id: feed.category_id,
        name: feed.name === feed.original_name ? '' : feed.name,
    });

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        router.patch(
            route('feed.update', feed.id),
            {
                category_id: data.category_id,
                name: data.name,
            },
            {
                onSuccess: () => {
                    notifications.show({
                        title: 'Feed updated',
                        message: 'The feed has been updated',
                        color: 'green',
                        withBorder: true,
                    });

                    onClose();
                },
                onError: (errors) => {
                    notifications.show({
                        title: 'Failed to update feed',
                        message: errors.name,
                        color: 'red',
                        withBorder: true,
                    });
                },
            },
        );
    };

    return (
        <Modal title="Update feed" opened={opened} onClose={onClose}>
            <Fieldset variant="filled">
                <form onSubmit={submit}>
                    <TextInput
                        type="text"
                        label="Feed name"
                        placeholder={feed.original_name}
                        description="Leave empty to keep the original name"
                        data-autofocus
                        value={data.name}
                        onChange={(e) => setData('name', e.target.value)}
                        withErrorStyles={false}
                        rightSectionPointerEvents="none"
                        rightSection={
                            errors.name && (
                                <IconExclamationCircle
                                    style={{
                                        width: rem(20),
                                        height: rem(20),
                                    }}
                                    color="var(--mantine-color-error)"
                                />
                            )
                        }
                        error={errors.name}
                    />

                    <Space mt="md" />

                    <NativeSelect
                        label="Category"
                        description="The category where the feed will be moved"
                        data={categories.map((category) => ({
                            value: category.id.toString(),
                            label: category.name,
                        }))}
                        value={data.category_id.toString()}
                        onChange={(e) =>
                            setData('category_id', parseInt(e.target.value))
                        }
                        error={errors.category_id}
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
            </Fieldset>
        </Modal>
    );
};

const DeleteFeedModal = ({
    feed,
    opened,
    onClose,
}: {
    feed: { name: string; id: number };
    opened: boolean;
    onClose: () => void;
}) => {
    return (
        <Modal title="Unsubscribe from feed" opened={opened} onClose={onClose}>
            <Text size="sm">
                Are you sure you want to delete the feed{' '}
                <strong>{feed.name}</strong>?
            </Text>
            <Group justify="center" mt="xl">
                <Button variant="outline" size="sm" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    onClick={() => {
                        router.delete(route('feed.unsubscribe', feed.id));
                        notifications.show({
                            title: 'Unsubscribed',
                            message: `You have successfully unsubscribed from ${feed.name}.`,
                            color: 'blue',
                            withBorder: true,
                        });
                        onClose();
                    }}
                    color="red"
                    variant="outline"
                    size="sm"
                >
                    Delete
                </Button>
            </Group>
        </Modal>
    );
};

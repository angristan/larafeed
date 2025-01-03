import classes from './Sidebar.module.css';

import { router, useForm } from '@inertiajs/react';
import {
    ActionIcon,
    AppShell,
    Badge,
    Button,
    Code,
    Group,
    Image,
    Indicator,
    Menu,
    Modal,
    ScrollArea,
    Text,
    TextInput,
    Tooltip,
    UnstyledButton,
    rem,
} from '@mantine/core';
import { useDisclosure, useHover } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
    IconBook,
    IconCheck,
    IconCheckbox,
    IconDots,
    IconExternalLink,
    IconPencil,
    IconPlus,
    IconRefresh,
    IconSearch,
    IconStar,
    IconTrash,
} from '@tabler/icons-react';
import axios, { AxiosError } from 'axios';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { FormEventHandler, useState } from 'react';

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
}: {
    feeds: Feed[];
    unreadEntriesCount: number;
    readEntriesCount: number;
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

    const feedLinks = feeds.map((feed) => (
        <FeedLink key={feed.id} feed={feed} />
    ));

    const openModal = () =>
        modals.open({
            title: 'Add a new feed',
            children: <AddFeedModal />,
        });

    const { hovered, ref } = useHover();

    return (
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
                        label="Create feed"
                        withArrow
                        position="right"
                        opened={feedLinks.length === 0 || hovered}
                    >
                        <ActionIcon
                            onClick={openModal}
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
    );
}

const AddFeedModal = function AddFeedModal() {
    const { data, setData, post, errors, processing } = useForm({
        feed_url: '',
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

                modals.closeAll();
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
                label="Feed URL"
                placeholder="https://blog.cloudflare.com/rss/"
                data-autofocus
                value={data.feed_url}
                onChange={(e) => setData('feed_url', e.target.value)}
            />
            {errors.feed_url && <div>{errors.feed_url}</div>}
            <Button mt="md" fullWidth type="submit" disabled={processing}>
                Submit
            </Button>
        </form>
    );
};

interface RefreshResponse {
    error?: string;
    message?: string;
}

const FeedLink = function FeedLink({ feed }: { feed: Feed }) {
    const { hovered, ref } = useHover();
    const [opened, setOpened] = useState(false);
    const [modalopened, { open, close }] = useDisclosure(false);

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
            <DeleteFeedModal feed={feed} opened={modalopened} onClose={close} />
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
                                            <IconPencil
                                                style={{
                                                    width: rem(14),
                                                    height: rem(14),
                                                }}
                                            />
                                        }
                                    >
                                        Edit name
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
                                            open();
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

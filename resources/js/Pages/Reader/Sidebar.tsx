import classes from './Sidebar.module.css';

import UserButton from '@/Components/UserButton/UserButton';
import { User } from '@/types';
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
    IconCheckbox,
    IconDots,
    IconFileImport,
    IconLogout,
    IconPencil,
    IconPlus,
    IconRefresh,
    IconRss,
    IconSearch,
    IconSettings,
    IconStar,
    IconTrash,
} from '@tabler/icons-react';
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
    user,
    feeds,
    unreadEntriesCount,
    readEntriesCount,
}: {
    user: User;
    feeds: Feed[];
    unreadEntriesCount: number;
    readEntriesCount: number;
}) {
    const mainLinks = links.map((link) => (
        <UnstyledButton
            key={link.label}
            className={classes.mainLink}
            onClick={() => {
                router.visit('feeds', {
                    only: ['entries'],
                    data: {
                        entry: window.location.search.match(/entry=(\d+)/)?.[1],
                        filter: link.label.toLowerCase(),
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

const FeedLink = function FeedLink({ feed }: { feed: Feed }) {
    const { hovered, ref } = useHover();
    const [opened, setOpened] = useState(false);
    const [modalopened, { open, close }] = useDisclosure(false);

    return (
        <>
            <DeleteFeedModal feed={feed} opened={modalopened} onClose={close} />
            <a
                ref={ref}
                onClick={(event) => {
                    event.preventDefault();
                    router.visit('feeds', {
                        only: ['feed', 'entries'],
                        data: {
                            feed: feed.id,
                            entry: window.location.search.match(
                                /entry=(\d+)/,
                            )?.[1],
                        },
                        preserveScroll: true,
                        preserveState: true,
                    });
                }}
                key={feed.id}
                className={classes.collectionLink}
            >
                <Tooltip
                    withArrow
                    position="right"
                    label={`${feed.last_failed_refresh_at ? 'Last refresh failed' : 'Last refresh successful'} ${dayjs(
                        feed.last_failed_refresh_at
                            ? feed.last_failed_refresh_at
                            : feed.last_successful_refresh_at,
                    ).fromNow()}`}
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
                                {feed.favicon_url ? (
                                    <Image
                                        src={feed.favicon_url}
                                        w={20}
                                        h={20}
                                        mr={9}
                                    />
                                ) : (
                                    <IconRss
                                        size={20}
                                        className={classes.mainLinkIcon}
                                        stroke={1.5}
                                        style={{ marginRight: 9 }}
                                    />
                                )}
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
                                        <div
                                            onClick={() => {
                                                router.visit('feeds', {
                                                    only: ['feed', 'entries'],
                                                    data: {
                                                        feed: feed.id,
                                                        entry: window.location.search.match(
                                                            /entry=(\d+)/,
                                                        )?.[1],
                                                    },
                                                    preserveScroll: true,
                                                    preserveState: true,
                                                });
                                            }}
                                        >
                                            <IconDots
                                                size={15}
                                                stroke={1.5}
                                                className={classes.feedLinkDots}
                                            />
                                        </div>
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
                                    <Menu.Label>Feed settings</Menu.Label>
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
                                        onClick={() => {
                                            open();
                                        }}
                                    >
                                        Unsubscribe
                                    </Menu.Item>
                                </Menu.Dropdown>
                            </Menu>
                        </div>
                    </Indicator>
                </Tooltip>
            </a>
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

import classes from './Sidebar.module.css';

import { UserButton } from '@/Components/UserButton/UserButton';
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
    ScrollArea,
    Text,
    TextInput,
    Tooltip,
    UnstyledButton,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
    IconBook,
    IconCheckbox,
    IconPlus,
    IconSearch,
    IconStar,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { FormEventHandler } from 'react';

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
        <a
            onClick={(event) => {
                event.preventDefault();
                router.visit('feeds', {
                    only: ['feed', 'entries'],
                    data: {
                        feed: feed.id,
                        entry: window.location.search.match(/entry=(\d+)/)?.[1],
                    },
                    preserveScroll: true,
                    preserveState: true,
                });
            }}
            key={feed.id}
            className={classes.collectionLink}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    justifyContent: 'space-between',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Image src={feed.favicon_url} w={20} h={20} mr={9} />
                    <span>{feed.name}</span>
                </div>
                <Badge
                    size="xs"
                    variant="default"
                    className={classes.mainLinkBadge}
                >
                    {feed.entries_count}
                </Badge>
            </div>
        </a>
    ));

    const openModal = () =>
        modals.open({
            title: 'Add a new feed',
            children: <AddFeedModal />,
        });

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
                        opened={feedLinks.length === 0}
                    >
                        <ActionIcon
                            onClick={openModal}
                            variant="default"
                            size={18}
                        >
                            <IconPlus size={12} stroke={1.5} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </AppShell.Section>
            <AppShell.Section grow component={ScrollArea}>
                <div className={classes.collections}>{feedLinks}</div>
            </AppShell.Section>
            <AppShell.Section>
                <div onClick={() => router.post(route('logout'))}>
                    <UserButton user={user} />
                </div>
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

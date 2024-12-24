import classes from './Reader.module.css';

import { UserButton } from '../Components/UserButton/UserButton';
import ApplicationLogo from '@/Components/ApplicationLogo';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { User } from '@/types';
import { Split } from '@gfazioli/mantine-split-pane';
import { router, useForm, usePage } from '@inertiajs/react';
import {
    ActionIcon,
    AppShell,
    Badge,
    Burger,
    Button,
    Card,
    Code,
    Divider,
    Flex,
    Group,
    Image,
    Indicator,
    Paper,
    ScrollArea,
    Text,
    TextInput,
    Title,
    Tooltip,
    TypographyStylesProvider,
    UnstyledButton,
    rem,
} from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Spotlight, SpotlightActionData } from '@mantine/spotlight';
import {
    IconBook,
    IconCheckbox,
    IconPlus,
    IconSearch,
    IconStar,
    IconStarFilled,
} from '@tabler/icons-react';
import axios from 'axios';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import {
    FormEventHandler,
    ReactNode,
    useEffect,
    useRef,
    useState,
} from 'react';

dayjs.extend(relativeTime);
dayjs.extend(utc);

const links = [
    { icon: IconBook, label: 'Unread' },
    { icon: IconCheckbox, label: 'Read' },
    { icon: IconStar, label: 'Favorites' },
];

const EntryListPane = function EntryListPane({
    entries,
    currentEntryID,
}: {
    entries: Entry[];
    currentEntryID?: number;
}) {
    const getCurrentFeedIdFromURL = () =>
        window.location.search.match(/feed=(\d+)/)?.[1];

    const navigateToEntry = (offset: number) => {
        const index = entries.findIndex((entry) => entry.id === currentEntryID);
        const newIndex = index + offset;

        if (newIndex >= 0 && newIndex < entries.length) {
            router.visit('feeds', {
                only: [
                    'currententry',
                    'unreadEntriesCount',
                    'readEntriesCount',
                ],
                data: {
                    entry: entries[newIndex].id,
                    feed: getCurrentFeedIdFromURL(),
                },
                preserveScroll: true,
                preserveState: true,
            });
        }
    };

    useHotkeys([
        ['J', () => navigateToEntry(+1)], // Next entry
        ['K', () => navigateToEntry(-1)], // Previous entry
    ]);

    const entryList = entries.map((entry) => (
        <div
            key={entry.id}
            className={classes.entry}
            onClick={() => {
                router.visit('feeds', {
                    only: [
                        'currententry',
                        'unreadEntriesCount',
                        'readEntriesCount',
                    ],
                    data: {
                        entry: entry.id,
                        feed: getCurrentFeedIdFromURL(),
                    },
                    preserveScroll: true,
                    preserveState: true,
                });
                // Mark as read locally because we don't refetch the entries
                entry.read_at = dayjs().toISOString();
            }}
        >
            <Card
                shadow="sm"
                radius="sm"
                withBorder
                pt={10}
                pb={10}
                className={`${classes.entryCard} ${entry.id === currentEntryID ? classes.activeEntry : ''}`}
            >
                <Indicator size={12} disabled={!!entry.read_at} withBorder>
                    <div>
                        <div className={classes.entryTitle}>{entry.title}</div>
                        <Flex justify="space-between" mt={10}>
                            <Flex>
                                <Image
                                    src={entry.feed.favicon_url}
                                    w={20}
                                    h={20}
                                    mr={9}
                                />
                                <Text size="xs" c="dimmed">
                                    <span>{entry.feed.name}</span>
                                </Text>
                            </Flex>
                            <Text size="xs" c="dimmed">
                                {dayjs.utc(entry.published_at).fromNow()}
                            </Text>
                        </Flex>
                    </div>
                </Indicator>
            </Card>
        </div>
    ));

    return (
        <Split.Pane
            style={{ height: '100%' }}
            initialWidth="50%"
            minWidth={400}
            maxWidth={600}
        >
            <ScrollArea style={{ height: '100%', width: '100%' }}>
                {entryList}
            </ScrollArea>
        </Split.Pane>
    );
};

const CurrentEntryPane = function CurrentEntryPane({
    currententry,
}: {
    currententry?: Entry;
}) {
    const viewport = useRef<HTMLDivElement>(null);
    const scrollToTop = () =>
        viewport.current!.scrollTo({ top: 0, behavior: 'instant' });

    useEffect(() => {
        scrollToTop();
    }, [currententry]);

    const [favoriteLoading, setFavoriteLoading] = useState(false);
    const [showLoading, setShowLoading] = useState(false);
    const loadingTimeout = useRef<NodeJS.Timeout>();

    // Show loading indicator only after 1s
    useEffect(() => {
        if (favoriteLoading) {
            loadingTimeout.current = setTimeout(() => {
                setShowLoading(true);
            }, 1000);
        } else {
            setShowLoading(false);
        }

        return () => {
            if (loadingTimeout.current) {
                clearTimeout(loadingTimeout.current);
            }
        };
    }, [favoriteLoading]);

    const updateFavorite = () => {
        setFavoriteLoading(true);
        axios
            .patch(route('entry.update', currententry?.id), {
                starred: currententry?.starred_at ? false : true,
            })
            .then((response) => {
                const { data } = response as {
                    data: {
                        error?: string;
                        message?: string;
                    };
                };
                if (data.error) {
                    notifications.show({
                        title: 'Failed to star entry',
                        message: data.error,
                        color: 'red',
                        withBorder: true,
                    });
                    return;
                }
                if (currententry?.starred_at) {
                    notifications.show({
                        title: 'Not that good...',
                        message: data.message,
                        color: 'blue',
                        withBorder: true,
                    });
                } else {
                    notifications.show({
                        title: 'Starred!',
                        message: data.message,
                        color: 'blue',
                        withBorder: true,
                    });
                }
            })
            .catch((error) => {
                notifications.show({
                    title: 'Failed to star entry',
                    message: error.message,
                    color: 'red',
                    withBorder: true,
                });
            })
            .finally(() => {
                setFavoriteLoading(false);
                router.visit('feeds', {
                    only: ['currententry', 'entries'],
                    data: {
                        entry: window.location.search.match(/entry=(\d+)/)?.[1],
                        feed: window.location.search.match(/feed=(\d+)/)?.[1],
                        filter: window.location.search.match(
                            /filter=(\w+)/,
                        )?.[1],
                    },
                    preserveScroll: true,
                    preserveState: true,
                });
            });
    };

    return (
        <Split.Pane grow style={{ height: '100%' }}>
            <Flex direction="column">
                <Card pb={20} pt={20} pl={20} pr={20}>
                    <Flex direction="row" justify="space-between">
                        <Image
                            src={currententry?.feed.favicon_url}
                            w={20}
                            h={20}
                            mr={9}
                        />

                        <Text size="sm" c="dimmed">
                            {currententry?.feed.name}
                        </Text>
                        <ActionIcon
                            variant="outline"
                            color="gray"
                            onClick={updateFavorite}
                            loading={showLoading}
                            loaderProps={{ type: 'dots' }}
                        >
                            {currententry?.starred_at ? (
                                <IconStarFilled size={15} stroke={1.5} />
                            ) : (
                                <IconStar size={15} stroke={1.5} />
                            )}
                        </ActionIcon>
                    </Flex>
                </Card>
                <Divider mb={20} />
                <ScrollArea style={{ height: '100%' }} viewportRef={viewport}>
                    {currententry ? (
                        <div>
                            <Paper shadow="xs" withBorder p={20}>
                                <TypographyStylesProvider>
                                    <Title className={classes.entryTitle}>
                                        {currententry.title}
                                    </Title>
                                    <Flex justify={'space-between'}>
                                        <Text size="sm" c="dimmed">
                                            {currententry.author}
                                        </Text>
                                        <Text size="sm" c="dimmed">
                                            {dayjs
                                                .utc(currententry.published_at)
                                                .fromNow()}
                                        </Text>
                                    </Flex>
                                    <div
                                        className={classes.entryContent}
                                        dangerouslySetInnerHTML={{
                                            __html: currententry.content || '',
                                        }}
                                    />
                                </TypographyStylesProvider>
                            </Paper>
                        </div>
                    ) : (
                        <Text>Select an entry</Text>
                    )}
                </ScrollArea>
            </Flex>
        </Split.Pane>
    );
};

const Main = function Main({
    entries,
    currententry,
}: {
    entries: Entry[];
    currententry?: Entry;
}) {
    return (
        <AppShell.Main
            style={{
                display: 'flex',
                height: '100vh',
                width: '100vw',
                overflow: 'hidden',
            }}
        >
            <Split size="sm" radius="xs" spacing="md">
                <EntryListPane
                    entries={entries}
                    currentEntryID={currententry?.id}
                />
                <CurrentEntryPane currententry={currententry} />
            </Split>
        </AppShell.Main>
    );
};

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

const NavBar = function Navbar({
    user,
    mainLinks,
    feedLinks,
}: {
    user: User;
    mainLinks: ReactNode[];
    feedLinks: ReactNode[];
}) {
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
                    <Tooltip label="Create feed" withArrow position="right">
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
};

interface Feed {
    id: number;
    name: string;
    favicon_url: string;
    site_url: string;
    entries_count: number;
    last_crawled_at: string;
}

interface Timestamps {
    created_at: string | null;
    updated_at: string | null;
}

interface Entry extends Timestamps {
    id: number;
    title: string;
    url: string;
    author: string | null;
    content: string | null;
    published_at: string;
    read_at: string | null;
    starred_at: string | null;
    feed: {
        id: number;
        favicon_url: string;
        name: string;
    };
}

const Feeds = ({
    feeds,
    entries,
    currententry,
    unreadEntriesCount,
    readEntriesCount,
}: {
    feeds: Feed[];
    entries: Entry[];
    currententry?: Entry;
    unreadEntriesCount: number;
    readEntriesCount: number;
}) => {
    const user = usePage().props.auth.user;

    const mainLinks = links.map((link) => (
        <UnstyledButton
            key={link.label}
            className={classes.mainLink}
            onClick={() => {
                router.visit('feeds', {
                    only: ['entries'],
                    data: {
                        entry: currententry?.id,
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
                        entry: currententry?.id,
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

    const [opened, { toggle }] = useDisclosure();

    const actions: SpotlightActionData[] = feeds.map((feed) => ({
        id: `feed-${feed.id}`,
        label: feed.name,
        description: feed.site_url,
        onClick: () => {
            router.visit('feeds', {
                only: ['feed', 'entries'],
                data: {
                    feed: feed.id,
                    entry: currententry?.id,
                },
                preserveScroll: true,
                preserveState: true,
            });
        },
        leftSection: <Image src={feed.favicon_url} w={20} h={20} mr={9} />,
    }));

    return (
        <AppShell
            header={{ height: 60 }}
            navbar={{
                width: 300,
                breakpoint: 'sm',
                collapsed: { mobile: !opened },
            }}
            padding="md"
        >
            <Spotlight
                shortcut="mod + K"
                actions={actions}
                nothingFound="Nothing found..."
                highlightQuery
                searchProps={{
                    leftSection: (
                        <IconSearch
                            style={{ width: rem(20), height: rem(20) }}
                            stroke={1.5}
                        />
                    ),
                    placeholder: 'Search...',
                }}
            />

            <AppShell.Header>
                <Group h="100%" px="md">
                    <Burger
                        opened={opened}
                        onClick={toggle}
                        hiddenFrom="sm"
                        size="sm"
                    />
                    <ApplicationLogo width={50} />
                    <Title order={3} style={{ margin: 0 }}>
                        Larafeed
                    </Title>
                </Group>
            </AppShell.Header>
            <NavBar user={user} mainLinks={mainLinks} feedLinks={feedLinks} />
            <Main entries={entries} currententry={currententry} />
        </AppShell>
    );
};

Feeds.layout = (page: ReactNode) => (
    <AuthenticatedLayout pageTitle="Feeds">{page}</AuthenticatedLayout>
);

export default Feeds;

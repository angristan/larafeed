import classes from './Feeds.module.css';

import { UserButton } from '../Components/UserButton/UserButton';
import ApplicationLogo from '@/Components/ApplicationLogo';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { User } from '@/types';
import { Split } from '@gfazioli/mantine-split-pane';
import { router, usePage } from '@inertiajs/react';
import {
    ActionIcon,
    AppShell,
    Badge,
    Burger,
    Card,
    Code,
    Group,
    Image,
    Paper,
    ScrollArea,
    Text,
    TextInput,
    Title,
    Tooltip,
    TypographyStylesProvider,
    UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
    IconBook,
    IconCheckbox,
    IconPlus,
    IconSearch,
    IconStar,
} from '@tabler/icons-react';
import { ReactNode, useEffect, useRef } from 'react';

const links = [
    { icon: IconBook, label: 'Unread', notifications: 3 },
    { icon: IconCheckbox, label: 'Read' },
    { icon: IconStar, label: 'Favorites' },
];

const EntryListPane = function EntryListPane({
    entries,
}: {
    entries: Entry[];
}) {
    const entryList = entries.map((entry) => (
        <div key={entry.id} className={classes.entry}>
            <Card
                shadow="sm"
                padding="lg"
                radius="md"
                withBorder
                className={classes.entryCard}
            >
                <div
                    onClick={() =>
                        router.visit('feeds', {
                            only: ['currententry'],
                            data: { entry: entry.id },
                            preserveScroll: true,
                            preserveState: true,
                        })
                    }
                >
                    <div>{entry.title}</div>
                    <div>
                        <Text size="xs" c="dimmed">
                            {entry.author}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {entry.published_at}
                        </Text>
                    </div>
                </div>
            </Card>
        </div>
    ));

    return (
        <Split.Pane
            style={{ height: '100%' }}
            initialWidth={500}
            minWidth={400}
            maxWidth={600}
        >
            <ScrollArea style={{ height: '100%' }}>{entryList}</ScrollArea>
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
        viewport.current!.scrollTo({ top: 0, behavior: 'smooth' });

    useEffect(() => {
        scrollToTop();
    }, [currententry]);

    return (
        <Split.Pane grow style={{ height: '100%' }}>
            <ScrollArea style={{ height: '100%' }} viewportRef={viewport}>
                {currententry ? (
                    <Paper shadow="xs" withBorder p={20}>
                        <TypographyStylesProvider>
                            <Title>{currententry.title}</Title>
                            <Text size="sm" c="dimmed">
                                {currententry.published_at}
                            </Text>
                            <div
                                dangerouslySetInnerHTML={{
                                    __html: currententry.content || '',
                                }}
                            />
                        </TypographyStylesProvider>
                    </Paper>
                ) : (
                    <Text>Select an entry</Text>
                )}
            </ScrollArea>
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
                <EntryListPane entries={entries} />
                <CurrentEntryPane currententry={currententry} />
            </Split>
        </AppShell.Main>
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
                        <ActionIcon variant="default" size={18}>
                            <IconPlus size={12} stroke={1.5} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </AppShell.Section>
            <AppShell.Section grow component={ScrollArea}>
                <div className={classes.collections}>{feedLinks}</div>
            </AppShell.Section>
            <AppShell.Section>
                <UserButton user={user} />
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
    sparkline: string;
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
    status: string;
    starred: boolean;
    feed_id: number;
    feed?: {
        id: number;
    };
}

const Feeds = ({
    feeds,
    entries,
    currententry,
}: {
    feeds: Feed[];
    entries: Entry[];
    currententry?: Entry;
}) => {
    const user = usePage().props.auth.user;

    const mainLinks = links.map((link) => (
        <UnstyledButton key={link.label} className={classes.mainLink}>
            <div className={classes.mainLinkInner}>
                <link.icon
                    size={20}
                    className={classes.mainLinkIcon}
                    stroke={1.5}
                />
                <span>{link.label}</span>
            </div>
            {link.notifications && (
                <Badge
                    size="sm"
                    variant="filled"
                    className={classes.mainLinkBadge}
                >
                    {link.notifications}
                </Badge>
            )}
        </UnstyledButton>
    ));

    const feedLinks = Array.from({ length: 30 }, () => feeds)
        .flat()
        .map((feed) => (
            <a
                href="#"
                onClick={(event) => event.preventDefault()}
                key={feed.name}
                className={classes.collectionLink}
            >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Image src={feed.favicon_url} w={20} h={20} mr={9} />
                    <span>{feed.name}</span>
                </div>
            </a>
        ));

    const [opened, { toggle }] = useDisclosure();

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

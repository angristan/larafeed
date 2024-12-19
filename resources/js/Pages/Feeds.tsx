import classes from './Feeds.module.css';

import { UserButton } from '../Components/UserButton/UserButton';
import ApplicationLogo from '@/Components/ApplicationLogo';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Split } from '@gfazioli/mantine-split-pane';
import { Head, Link, usePage } from '@inertiajs/react';
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
import { memo } from 'react';

const links = [
    { icon: IconBook, label: 'Unread', notifications: 3 },
    { icon: IconCheckbox, label: 'Read' },
    { icon: IconStar, label: 'Favorites' },
];

const EntryListPane = memo(function EntryListPane({
    entries,
}: {
    entries: Entry[];
}) {
    const entryList = entries.map((entry) => (
        <div key={entry.id} className={classes.entry}>
            <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Link only={['currententry']} href={`/feeds?entry=${entry.id}`}>
                    <div className={classes.entryTitle}>{entry.title}</div>
                    <div className={classes.entryMeta}>
                        <Text size="xs" c="dimmed">
                            {entry.author}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {entry.published_at}
                        </Text>
                    </div>
                </Link>
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
});

const CurrentEntryPane = memo(function CurrentEntryPane({
    currententry,
}: {
    currententry?: Entry;
}) {
    return (
        <Split.Pane grow style={{ height: '100%' }}>
            <ScrollArea style={{ height: '100%' }}>
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
});

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

export default function NavbarSearch({
    feeds,
    entries,
    currententry,
}: {
    feeds: Feed[];
    entries: Entry[];
    currententry?: Entry;
}) {
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
        <AuthenticatedLayout>
            <AppShell
                header={{ height: 60 }}
                navbar={{
                    width: 300,
                    breakpoint: 'sm',
                    collapsed: { mobile: !opened },
                }}
                padding="md"
            >
                <Head title="Dashboard" />
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

                <AppShell.Navbar>
                    <AppShell.Section pr="md" pl="md" pt="md">
                        <TextInput
                            placeholder="Search"
                            size="xs"
                            leftSection={<IconSearch size={12} stroke={1.5} />}
                            rightSectionWidth={70}
                            rightSection={
                                <Code className={classes.searchCode}>
                                    Ctrl + K
                                </Code>
                            }
                            styles={{ section: { pointerEvents: 'none' } }}
                            mb="sm"
                        />
                    </AppShell.Section>

                    <AppShell.Section className={classes.section}>
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
                            >
                                <ActionIcon variant="default" size={18}>
                                    <IconPlus size={12} stroke={1.5} />
                                </ActionIcon>
                            </Tooltip>
                        </Group>
                    </AppShell.Section>
                    <AppShell.Section
                        grow
                        component={ScrollArea}
                        className={classes.section}
                    >
                        <div className={classes.collections}>{feedLinks}</div>
                    </AppShell.Section>
                    <AppShell.Section>
                        <UserButton user={user} />
                    </AppShell.Section>
                </AppShell.Navbar>
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
            </AppShell>
        </AuthenticatedLayout>
    );
}

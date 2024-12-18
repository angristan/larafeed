import { UserButton } from '../Components/UserButton/UserButton';
import classes from './Feeds.module.css';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Split } from '@gfazioli/mantine-split-pane';
import { Head, Link, usePage } from '@inertiajs/react';
import {
    ActionIcon,
    Badge,
    Code,
    Group,
    Image,
    Paper,
    ScrollArea,
    Text,
    TextInput,
    Tooltip,
    UnstyledButton,
} from '@mantine/core';
import {
    IconBulb,
    IconCheckbox,
    IconPlus,
    IconSearch,
    IconUser,
} from '@tabler/icons-react';

const links = [
    { icon: IconBulb, label: 'Activity', notifications: 3 },
    { icon: IconCheckbox, label: 'Tasks', notifications: 4 },
    { icon: IconUser, label: 'Contacts' },
];

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

    const feedLinks = feeds.map((feed) => (
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

    const entryList = entries.map((entry) => (
        <div key={entry.id} className={classes.entry}>
            <div className={classes.entryHeader}>
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
            </div>
        </div>
    ));

    return (
        <AuthenticatedLayout>
            <Head title="Dashboard" />
            <div
                style={{
                    display: 'flex',
                    height: '100vh',
                    width: '100vw',
                    overflow: 'hidden',
                }}
            >
                <nav className={classes.navbar}>
                    <div className={classes.section}>
                        <UserButton user={user} />
                    </div>

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

                    <div className={classes.section}>
                        <div className={classes.mainLinks}>{mainLinks}</div>
                    </div>

                    <div className={classes.section}>
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
                        <div className={classes.collections}>{feedLinks}</div>
                    </div>
                </nav>
                <main
                    style={{
                        height: '100%',
                        width: '100%',
                        backgroundColor: 'lightskyblue',
                    }}
                >
                    <Split
                        style={{
                            height: '100%',
                        }}
                    >
                        <Split.Pane
                            initialWidth="50%"
                            style={{
                                height: '100%',
                            }}
                        >
                            <ScrollArea
                                style={{
                                    backgroundColor: 'lightcoral',
                                    height: '100%',
                                }}
                            >
                                {entryList}
                            </ScrollArea>
                        </Split.Pane>
                        <Split.Pane
                            grow
                            style={{
                                backgroundColor: 'lightgreen',
                                height: '100%',
                            }}
                        >
                            <ScrollArea
                                style={{
                                    backgroundColor: 'lightcoral',
                                    height: '100%',
                                }}
                            >
                                {currententry ? (
                                    <Paper shadow="xs">
                                        <Text>{currententry?.title}</Text>
                                        <Text size="sm" c="dimmed">
                                            {currententry?.published_at}
                                        </Text>
                                        <Text size="lg" mt="md">
                                            <div
                                                className="prose"
                                                dangerouslySetInnerHTML={{
                                                    __html:
                                                        currententry?.content ||
                                                        '',
                                                }}
                                            />
                                        </Text>
                                    </Paper>
                                ) : (
                                    <Text>Select an entry</Text>
                                )}
                            </ScrollArea>
                        </Split.Pane>
                    </Split>
                </main>
            </div>
        </AuthenticatedLayout>
    );
}

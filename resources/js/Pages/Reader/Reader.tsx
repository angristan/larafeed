import classes from './Reader.module.css';

import CurrentEntryPane from './CurrentEntryPane';
import EntryListPane from './EntryListPane';
import Sidebar from './Sidebar';
import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import ColorSchemeSwitcher from '@/Components/ColorSchemeSwitcher/ColorSchemeSwitcher';
import KeyboardShortcuts from '@/Components/KeyboardShortcuts/KeyboardShortcuts';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PageProps } from '@/types';
import { Split } from '@gfazioli/mantine-split-pane';
import { Link, router } from '@inertiajs/react';
import {
    ActionIcon,
    AppShell,
    Avatar,
    Burger,
    Group,
    Image,
    Menu,
    Title,
    rem,
    useMantineColorScheme,
    useMantineTheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Spotlight, SpotlightActionData } from '@mantine/spotlight';
import {
    IconBrandGithub,
    IconChartBar,
    IconFileImport,
    IconLogout,
    IconSearch,
    IconSettings,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { ReactNode } from 'react';

dayjs.extend(relativeTime);
dayjs.extend(utc);

interface ReaderProps extends PageProps {
    feeds: Feed[];
    entries: PaginatedEntries;
    currententry?: Entry;
    unreadEntriesCount: number;
    readEntriesCount: number;
    summary?: string;
    categories: Category[];
}

const Reader = ({
    auth,
    feeds,
    entries,
    currententry,
    unreadEntriesCount,
    readEntriesCount,
    summary,
    categories,
}: ReaderProps) => {
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
            header={{ height: 50 }}
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
                scrollable
                maxHeight="calc(100vh * 0.6)"
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
                <Group h="100%" px="md" justify="space-between">
                    <Group h="100%" px="md" justify="space-between">
                        <Burger
                            opened={opened}
                            onClick={toggle}
                            hiddenFrom="sm"
                            size="sm"
                        />
                        <Link
                            href={route('feeds.index')}
                            as="div"
                            style={{ cursor: 'pointer' }}
                        >
                            <Group>
                                <ApplicationLogo width={40} />
                                <Title order={3} style={{ margin: 0 }}>
                                    Larafeed
                                </Title>
                            </Group>
                        </Link>
                    </Group>
                    <Group style={{ alignItems: 'center' }}>
                        <ActionIcon
                            onClick={() =>
                                window.open(
                                    'https://github.com/angristan/larafeed',
                                    '_blank',
                                )
                            }
                            variant="default"
                            size="lg"
                            aria-label="Toggle color scheme"
                            mt={1}
                        >
                            <IconBrandGithub stroke={1.5} size={20} />
                        </ActionIcon>
                        <Link href={route('charts.index')} as="div" prefetch>
                            <ActionIcon
                                variant="default"
                                size="lg"
                                aria-label="Toggle color scheme"
                                mt={1}
                            >
                                <IconChartBar stroke={1.5} size={20} />
                            </ActionIcon>
                        </Link>
                        <KeyboardShortcuts />
                        <ColorSchemeSwitcher />

                        <Menu
                            shadow="md"
                            width={200}
                            position="top-end"
                            trigger="click-hover"
                            closeDelay={300}
                        >
                            <Menu.Target>
                                <Avatar
                                    src={null}
                                    radius="xl"
                                    className={classes.user}
                                >
                                    {auth.user.name[0]}
                                </Avatar>
                            </Menu.Target>

                            <Menu.Dropdown>
                                <Menu.Label>{auth.user.email}</Menu.Label>
                                <Menu.Item
                                    leftSection={
                                        <IconSettings
                                            style={{
                                                width: rem(14),
                                                height: rem(14),
                                            }}
                                        />
                                    }
                                >
                                    Settings
                                </Menu.Item>
                                <Menu.Item
                                    onClick={() =>
                                        router.visit(route('import.index'))
                                    }
                                    leftSection={
                                        <IconFileImport
                                            style={{
                                                width: rem(14),
                                                height: rem(14),
                                            }}
                                        />
                                    }
                                >
                                    OPML import/export
                                </Menu.Item>

                                <Menu.Divider />

                                {/* <Menu.Label>Danger zone</Menu.Label> */}
                                <Menu.Item
                                    onClick={() => router.post(route('logout'))}
                                    leftSection={
                                        <IconLogout
                                            style={{
                                                width: rem(14),
                                                height: rem(14),
                                            }}
                                        />
                                    }
                                >
                                    Logout
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    </Group>
                </Group>
            </AppShell.Header>
            <Sidebar
                feeds={feeds}
                unreadEntriesCount={unreadEntriesCount}
                readEntriesCount={readEntriesCount}
                categories={categories}
            />
            <Main
                entries={entries}
                currententry={currententry}
                summary={summary}
            />
        </AppShell>
    );
};

Reader.layout = (page: ReactNode) => (
    <AuthenticatedLayout pageTitle="Feeds">{page}</AuthenticatedLayout>
);

export default Reader;

const Main = function Main({
    entries,
    currententry,
    summary,
}: {
    entries: PaginatedEntries;
    currententry?: Entry;
    summary?: string;
}) {
    const { colorScheme } = useMantineColorScheme();
    const theme = useMantineTheme();

    return (
        <AppShell.Main className={classes.main}>
            <Split spacing="md">
                <Split.Pane initialWidth="40%" minWidth={300}>
                    <EntryListPane
                        entries={entries}
                        currentEntryID={currententry?.id}
                    />
                </Split.Pane>
                <Split.Resizer
                    size="sm"
                    radius="xs"
                    color={colorScheme === 'dark' ? theme.colors.dark[5] : ''}
                />
                <Split.Pane grow>
                    {currententry && (
                        <CurrentEntryPane
                            currententry={currententry}
                            summary={summary}
                        />
                    )}
                </Split.Pane>
            </Split>
        </AppShell.Main>
    );
};

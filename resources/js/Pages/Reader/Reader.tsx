import classes from './Reader.module.css';

import CurrentEntryPane from './CurrentEntryPane';
import EntryListPane from './EntryListPane';
import Sidebar from './Sidebar';
import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import ColorSchemeSwitcher from '@/Components/ColorSchemeSwitcher/ColorSchemeSwitcher';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PageProps } from '@/types';
import { Split } from '@gfazioli/mantine-split-pane';
import { router } from '@inertiajs/react';
import {
    AppShell,
    Avatar,
    Burger,
    Group,
    Image,
    Menu,
    Title,
    rem,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Spotlight, SpotlightActionData } from '@mantine/spotlight';
import {
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
    entries: Entry[];
    currententry?: Entry;
    unreadEntriesCount: number;
    readEntriesCount: number;
}

const Reader = ({
    auth,
    feeds,
    entries,
    currententry,
    unreadEntriesCount,
    readEntriesCount,
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
                        <ApplicationLogo width={50} />
                        <Title order={3} style={{ margin: 0 }}>
                            Larafeed
                        </Title>
                    </Group>
                    <Group style={{ alignItems: 'center' }}>
                        <ColorSchemeSwitcher />

                        <Menu shadow="md" width={200} position="top-end">
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
            />
            <Main entries={entries} currententry={currententry} />
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
}: {
    entries: Entry[];
    currententry?: Entry;
}) {
    return (
        <AppShell.Main className={classes.main}>
            <Split size="sm" radius="xs" spacing="md">
                <Split.Pane initialWidth="40%" minWidth={300}>
                    <EntryListPane
                        entries={entries}
                        currentEntryID={currententry?.id}
                    />
                </Split.Pane>
                <Split.Pane grow>
                    {currententry && (
                        <CurrentEntryPane currententry={currententry} />
                    )}
                </Split.Pane>
            </Split>
        </AppShell.Main>
    );
};

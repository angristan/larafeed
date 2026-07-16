import { Split } from '@gfazioli/mantine-split-pane';
import { router, useRemember } from '@inertiajs/react';
import {
    AppShell,
    Center,
    Kbd,
    Stack,
    Text,
    ThemeIcon,
    Title,
    useMantineColorScheme,
    useMantineTheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { SpotlightActionData } from '@mantine/spotlight';
import { IconBook2 } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { type ReactNode, useEffect } from 'react';
import { FaviconImage } from '@/Components/FaviconImage/FaviconImage';
import AppShellLayout from '@/Layouts/AppShellLayout/AppShellLayout';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import type { PageProps } from '@/types';
import CurrentEntryPane from './CurrentEntryPane';
import EntryListPane from './EntryListPane';
import classes from './Reader.module.css';
import Sidebar from './Sidebar';

dayjs.extend(relativeTime);
dayjs.extend(utc);

interface ReaderProps extends PageProps {
    feeds: Feed[];
    entries: PaginatedEntries;
    currententry?: CurrentEntry;
    unreadEntriesCount: number;
    readEntriesCount: number;
    summary?: string;
    categories: Category[];
}

const Reader = ({
    feeds,
    entries,
    currententry,
    unreadEntriesCount,
    readEntriesCount,
    summary,
    categories,
}: ReaderProps) => {
    const actions: SpotlightActionData[] = feeds.map((feed) => ({
        id: `feed-${feed.id}`,
        label: feed.name,
        description: feed.site_url,
        onClick: () => {
            router.visit(route('feeds.index'), {
                only: ['entries', 'currententry', 'summary'],
                data: {
                    feed: feed.id,
                },
                reset: ['summary'],
                preserveScroll: true,
                preserveState: true,
            });
        },
        leftSection: (
            <FaviconImage
                src={feed.favicon_url}
                isDark={feed.favicon_is_dark}
                w={20}
                h={20}
                mr={9}
            />
        ),
    }));

    return (
        <AppShellLayout
            activePage="reader"
            sidebar={
                <Sidebar
                    feeds={feeds}
                    unreadEntriesCount={unreadEntriesCount}
                    readEntriesCount={readEntriesCount}
                    categories={categories}
                />
            }
            spotlight={{
                actions,
                searchPlaceholder: 'Search feeds...',
                nothingFoundLabel: 'Nothing found...',
            }}
        >
            <Main
                entries={entries}
                currententry={currententry}
                summary={summary}
                feeds={feeds}
                categories={categories}
            />
        </AppShellLayout>
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
    feeds,
    categories,
}: {
    entries: PaginatedEntries;
    currententry?: CurrentEntry;
    summary?: string;
    feeds: Feed[];
    categories: Category[];
}) {
    const { colorScheme } = useMantineColorScheme();
    const theme = useMantineTheme();
    const compactLayout = useMediaQuery('(max-width: 75em)', undefined, {
        getInitialValueInEffect: false,
    });
    const [optimisticallyReadEntryIDs, setOptimisticallyReadEntryIDs] =
        useRemember<number[]>([], 'reader.optimistically-read-entry-ids');

    const markEntryRead = (entryID: number) => {
        setOptimisticallyReadEntryIDs((current) =>
            current.includes(entryID)
                ? current
                : [...current, entryID].slice(-200),
        );
    };

    const rollbackEntryRead = (entryID: number) => {
        setOptimisticallyReadEntryIDs((current) =>
            current.filter((currentEntryID) => currentEntryID !== entryID),
        );
    };

    useEffect(() => {
        if (currententry && !currententry.read_at) {
            setOptimisticallyReadEntryIDs((current) =>
                current.filter(
                    (currentEntryID) => currentEntryID !== currententry.id,
                ),
            );
        }
    }, [currententry, setOptimisticallyReadEntryIDs]);

    const closeCurrentEntry = () => {
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.delete('entry');
        urlParams.delete('read');
        urlParams.delete('summarize');

        router.visit(route('feeds.index'), {
            only: ['entries', 'currententry', 'summary'],
            data: Object.fromEntries(urlParams),
            reset: ['summary'],
            preserveScroll: true,
            preserveState: true,
        });
    };

    return (
        <AppShell.Main className={classes.main}>
            {compactLayout ? (
                <div className={classes.compactPane}>
                    {currententry ? (
                        <CurrentEntryPane
                            key={`${currententry.id}-${summary ? 'summary' : 'no-summary'}`}
                            currententry={currententry}
                            summary={summary}
                            feeds={feeds}
                            categories={categories}
                            onBack={closeCurrentEntry}
                        />
                    ) : (
                        <EntryListPane
                            entries={entries}
                            optimisticallyReadEntryIDs={
                                optimisticallyReadEntryIDs
                            }
                            onOptimisticRead={markEntryRead}
                            onOptimisticReadRollback={rollbackEntryRead}
                        />
                    )}
                </div>
            ) : (
                <Split
                    size="sm"
                    radius="md"
                    spacing="sm"
                    color={
                        colorScheme === 'dark'
                            ? theme.colors.dark[5]
                            : theme.colors.gray[2]
                    }
                >
                    <Split.Pane initialWidth="38%" minWidth={320}>
                        <EntryListPane
                            entries={entries}
                            currentEntryID={currententry?.id}
                            optimisticallyReadEntryIDs={
                                optimisticallyReadEntryIDs
                            }
                            onOptimisticRead={markEntryRead}
                            onOptimisticReadRollback={rollbackEntryRead}
                        />
                    </Split.Pane>
                    <Split.Pane grow>
                        {currententry ? (
                            <CurrentEntryPane
                                key={`${currententry.id}-${summary ? 'summary' : 'no-summary'}`}
                                currententry={currententry}
                                summary={summary}
                                feeds={feeds}
                                categories={categories}
                            />
                        ) : (
                            <Center className={classes.emptyReader}>
                                <Stack align="center" gap="sm" maw={380}>
                                    <ThemeIcon
                                        size={52}
                                        radius="xl"
                                        variant="light"
                                        color="blue"
                                    >
                                        <IconBook2 size={25} stroke={1.6} />
                                    </ThemeIcon>
                                    <Title order={3} ta="center">
                                        Select an entry to start reading
                                    </Title>
                                    <Text c="dimmed" size="sm" ta="center">
                                        Choose an article from the list, or use{' '}
                                        <Kbd>J</Kbd> and <Kbd>K</Kbd> to move
                                        through your reading queue.
                                    </Text>
                                </Stack>
                            </Center>
                        )}
                    </Split.Pane>
                </Split>
            )}
        </AppShell.Main>
    );
};

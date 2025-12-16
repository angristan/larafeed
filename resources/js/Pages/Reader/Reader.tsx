import { Split } from '@gfazioli/mantine-split-pane';
import { router } from '@inertiajs/react';
import {
    AppShell,
    useMantineColorScheme,
    useMantineTheme,
} from '@mantine/core';
import type { SpotlightActionData } from '@mantine/spotlight';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import type { ReactNode } from 'react';
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
    currententry?: Entry;
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
    currententry?: Entry;
    summary?: string;
    feeds: Feed[];
    categories: Category[];
}) {
    const { colorScheme } = useMantineColorScheme();
    const theme = useMantineTheme();

    return (
        <AppShell.Main className={classes.main}>
            <Split
                size="sm"
                radius="xs"
                spacing="md"
                color={colorScheme === 'dark' ? theme.colors.dark[5] : ''}
            >
                <Split.Pane initialWidth="40%" minWidth={300}>
                    <EntryListPane
                        entries={entries}
                        currentEntryID={currententry?.id}
                    />
                </Split.Pane>
                <Split.Pane grow>
                    {currententry && (
                        <CurrentEntryPane
                            key={`${currententry.id}-${summary ? 'summary' : 'no-summary'}`}
                            currententry={currententry}
                            summary={summary}
                            feeds={feeds}
                            categories={categories}
                        />
                    )}
                </Split.Pane>
            </Split>
        </AppShell.Main>
    );
};

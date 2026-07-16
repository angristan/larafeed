import { Link, router } from '@inertiajs/react';
import {
    Button,
    Card,
    Center,
    Group,
    Kbd,
    Pagination,
    ScrollArea,
    Stack,
    Text,
    ThemeIcon,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { IconInbox, IconStarFilled } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { useCallback, useEffect, useRef } from 'react';
import { FaviconImage } from '@/Components/FaviconImage/FaviconImage';
import classes from './EntryListPane.module.css';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export default function EntryListPane({
    entries,
    currentEntryID,
    optimisticallyReadEntryIDs = [],
    onOptimisticRead,
    onOptimisticReadRollback,
}: {
    entries: PaginatedEntries;
    currentEntryID?: number;
    optimisticallyReadEntryIDs?: readonly number[];
    onOptimisticRead?: (entryID: number) => void;
    onOptimisticReadRollback?: (entryID: number) => void;
}) {
    const viewport = useRef<HTMLDivElement>(null);
    const readEntryIDs = new Set(
        entries.data
            .filter((entry) => Boolean(entry.read_at))
            .map((entry) => entry.id),
    );
    for (const entryID of optimisticallyReadEntryIDs) {
        readEntryIDs.add(entryID);
    }

    const scrollToTop = useCallback(() => {
        viewport.current?.scrollTo({ top: 0, behavior: 'instant' });
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: reset scroll when the paginated entries change
    useEffect(() => {
        scrollToTop();
    }, [entries, scrollToTop]);

    const entryQuery = (entryID: number) => {
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.delete('summarize');
        urlParams.set('entry', entryID.toString());
        urlParams.set('read', 'true');

        return Object.fromEntries(urlParams);
    };

    const markEntryRead = (entryID: number) => {
        onOptimisticRead?.(entryID);
    };

    const restoreUnreadEntry = (entryID: number, wasRead: boolean) => {
        if (wasRead) {
            return;
        }

        onOptimisticReadRollback?.(entryID);
    };

    const navigateToEntry = (offset: number) => {
        const index = entries.data.findIndex(
            (entry) => entry.id === currentEntryID,
        );
        const newIndex = index + offset;

        if (newIndex >= 0 && newIndex < entries.data.length) {
            const entry = entries.data[newIndex];
            const wasRead = readEntryIDs.has(entry.id);

            markEntryRead(entry.id);
            router.visit(route('feeds.index'), {
                only: [
                    'currententry',
                    'summary',
                    'unreadEntriesCount',
                    'readEntriesCount',
                ],
                data: entryQuery(entry.id),
                reset: ['summary'],
                preserveScroll: true,
                preserveState: true,
                onError: () => restoreUnreadEntry(entry.id, wasRead),
                onCancel: () => restoreUnreadEntry(entry.id, wasRead),
                onHttpException: () => restoreUnreadEntry(entry.id, wasRead),
                onNetworkError: () => restoreUnreadEntry(entry.id, wasRead),
            });
        }
    };

    const navigateToPage = (page: number) => {
        router.visit(route('feeds.index'), {
            only: ['entries'],
            data: {
                ...Object.fromEntries(
                    new URLSearchParams(window.location.search),
                ),
                page,
            },
            preserveScroll: true,
            preserveState: true,
            onSuccess: scrollToTop,
        });
    };

    useHotkeys([
        ['J', () => navigateToEntry(+1)],
        ['K', () => navigateToEntry(-1)],
    ]);

    const query = new URLSearchParams(window.location.search);
    const activeFilter = query.get('filter');
    const hasScopedView = Boolean(
        activeFilter || query.get('feed') || query.get('category'),
    );
    const viewTitle = activeFilter
        ? `${activeFilter.charAt(0).toUpperCase()}${activeFilter.slice(1)} entries`
        : hasScopedView
          ? 'Filtered entries'
          : 'All entries';

    return (
        <section className={classes.root} aria-label="Entry list">
            <header className={classes.listHeader}>
                <div>
                    <Text fw={700} size="sm" className={classes.queueTitle}>
                        {viewTitle}
                    </Text>
                    <Text size="xs" c="dimmed">
                        {entries.total.toLocaleString()}{' '}
                        {entries.total === 1 ? 'article' : 'articles'}
                    </Text>
                </div>
                <Group
                    gap={5}
                    visibleFrom="sm"
                    aria-label="Entry navigation shortcuts"
                >
                    <Kbd>J</Kbd>
                    <Text size="xs" c="dimmed">
                        /
                    </Text>
                    <Kbd>K</Kbd>
                </Group>
            </header>

            <ScrollArea
                className={classes.scrollArea}
                viewportRef={viewport}
                type="auto"
            >
                {entries.data.length > 0 ? (
                    <nav className={classes.entryList} aria-label={viewTitle}>
                        {entries.data.map((entry) => {
                            const wasRead = readEntryIDs.has(entry.id);
                            const isActive = entry.id === currentEntryID;
                            const published = dayjs
                                .utc(entry.published_at)
                                .fromNow();

                            return (
                                <Link
                                    key={entry.id}
                                    className={classes.entry}
                                    href={route('feeds.index')}
                                    only={[
                                        'currententry',
                                        'summary',
                                        'unreadEntriesCount',
                                        'readEntriesCount',
                                    ]}
                                    preserveScroll
                                    preserveState
                                    data={entryQuery(entry.id)}
                                    aria-current={isActive ? 'true' : undefined}
                                    aria-label={`${wasRead ? 'Read' : 'Unread'}${entry.starred_at ? ', starred' : ''}: ${entry.title}, ${entry.feed.name}, ${published}`}
                                    onStart={() => markEntryRead(entry.id)}
                                    onError={() =>
                                        restoreUnreadEntry(entry.id, wasRead)
                                    }
                                    onCancel={() =>
                                        restoreUnreadEntry(entry.id, wasRead)
                                    }
                                    onHttpException={() =>
                                        restoreUnreadEntry(entry.id, wasRead)
                                    }
                                    onNetworkError={() =>
                                        restoreUnreadEntry(entry.id, wasRead)
                                    }
                                >
                                    <Card
                                        className={`${classes.entryCard} ${
                                            isActive ? classes.activeEntry : ''
                                        } ${
                                            wasRead
                                                ? classes.readEntry
                                                : classes.unreadEntry
                                        }`}
                                        radius="md"
                                        padding="sm"
                                    >
                                        <Group
                                            align="flex-start"
                                            wrap="nowrap"
                                            gap="sm"
                                        >
                                            <span
                                                className={classes.unreadDot}
                                                aria-hidden="true"
                                            />
                                            <Stack
                                                gap={9}
                                                className={classes.entryBody}
                                            >
                                                <Group
                                                    justify="space-between"
                                                    align="flex-start"
                                                    wrap="nowrap"
                                                    gap="xs"
                                                >
                                                    <Text
                                                        className={
                                                            classes.entryTitle
                                                        }
                                                        size="sm"
                                                        fw={wasRead ? 500 : 700}
                                                        lineClamp={3}
                                                    >
                                                        {entry.title}
                                                    </Text>
                                                    {entry.starred_at && (
                                                        <IconStarFilled
                                                            className={
                                                                classes.star
                                                            }
                                                            size={15}
                                                            aria-hidden="true"
                                                        />
                                                    )}
                                                </Group>

                                                <Group
                                                    justify="space-between"
                                                    wrap="nowrap"
                                                    gap="xs"
                                                >
                                                    <Group
                                                        gap={7}
                                                        wrap="nowrap"
                                                        className={
                                                            classes.feedMeta
                                                        }
                                                    >
                                                        <FaviconImage
                                                            src={
                                                                entry.feed
                                                                    .favicon_url
                                                            }
                                                            isDark={
                                                                entry.feed
                                                                    .favicon_is_dark
                                                            }
                                                            w={17}
                                                            h={17}
                                                        />
                                                        <Text
                                                            size="xs"
                                                            c="dimmed"
                                                            truncate
                                                        >
                                                            {entry.feed.name}
                                                        </Text>
                                                    </Group>
                                                    <Text
                                                        size="xs"
                                                        c="dimmed"
                                                        className={
                                                            classes.timestamp
                                                        }
                                                    >
                                                        {published}
                                                    </Text>
                                                </Group>
                                            </Stack>
                                        </Group>
                                    </Card>
                                </Link>
                            );
                        })}
                    </nav>
                ) : (
                    <Center className={classes.emptyState}>
                        <Stack align="center" gap="sm" maw={310}>
                            <ThemeIcon
                                size={46}
                                radius="xl"
                                variant="light"
                                color="gray"
                            >
                                <IconInbox size={22} stroke={1.6} />
                            </ThemeIcon>
                            <Stack align="center" gap={3}>
                                <Text fw={700}>No entries here</Text>
                                <Text size="sm" c="dimmed" ta="center">
                                    {hasScopedView
                                        ? 'Try another feed or clear the current filters.'
                                        : 'Add a subscription or check back after your feeds refresh.'}
                                </Text>
                            </Stack>
                            <Button
                                component={Link}
                                href={
                                    hasScopedView
                                        ? route('feeds.index')
                                        : route('subscriptions.index')
                                }
                                variant="light"
                                size="xs"
                            >
                                {hasScopedView
                                    ? 'Show all entries'
                                    : 'Manage subscriptions'}
                            </Button>
                        </Stack>
                    </Center>
                )}
            </ScrollArea>

            {entries.last_page > 1 && (
                <footer className={classes.paginationFooter}>
                    <Text size="xs" c="dimmed" visibleFrom="sm">
                        Page {entries.current_page} of {entries.last_page}
                    </Text>
                    <Pagination.Root
                        size="sm"
                        total={entries.last_page}
                        value={entries.current_page}
                        siblings={1}
                        onChange={navigateToPage}
                    >
                        <Group gap={5} wrap="nowrap">
                            <Pagination.First />
                            <Pagination.Previous />
                            <Pagination.Items />
                            <Pagination.Next />
                            <Pagination.Last />
                        </Group>
                    </Pagination.Root>
                </footer>
            )}
        </section>
    );
}

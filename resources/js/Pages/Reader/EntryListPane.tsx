import classes from './EntryListPane.module.css';

import { InfiniteScroll, Link, router } from '@inertiajs/react';
import {
    Card,
    Divider,
    Flex,
    Group,
    Image,
    Indicator,
    List,
    Pagination,
    ScrollArea,
    Text,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { IconStarFilled } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { useEffect, useRef } from 'react';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export default function EntryListPane({
    entries,
    currentEntryID,
    paginationType = 'infinite',
}: {
    entries: PaginatedEntries;
    currentEntryID?: number;
    paginationType?: string;
}) {
    const viewport = useRef<HTMLDivElement>(null);

    const navigateToEntry = (offset: number) => {
        const index = entries.data.findIndex(
            (entry) => entry.id === currentEntryID,
        );
        const newIndex = index + offset;

        if (newIndex >= 0 && newIndex < entries.data.length) {
            router.visit('feeds', {
                only: [
                    'currententry',
                    'unreadEntriesCount',
                    'readEntriesCount',
                ],
                data: {
                    ...Object.fromEntries(
                        new URLSearchParams(window.location.search),
                    ),
                    entry: entries.data[newIndex].id,
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

    const scrollToTop = () => {
        viewport.current?.scrollTo({ top: 0, behavior: 'instant' });
    };

    useEffect(() => {
        if (paginationType === 'classic') {
            scrollToTop();
        }
    }, [entries, paginationType]);

    const entryList = entries.data.map((entry) => {
        const urlParams = new URLSearchParams(window.location.search);

        urlParams.delete('summarize');
        urlParams.delete('read');
        urlParams.set('entry', entry.id.toString());

        const data = Object.fromEntries(urlParams);
        return (
            <Link
                key={entry.id}
                className={classes.entry}
                href={route('feeds.index')}
                only={['currententry']}
                preserveScroll
                preserveState
                data={{
                    ...data,
                }}
                prefetch
                as="div"
                onSuccess={() => {
                    router.patch(
                        route('entry.update', entry.id),
                        {
                            read: true,
                        },
                        {
                            preserveScroll: true,
                            preserveState: true,
                            showProgress: true,
                            only: [
                                'currententry',
                                'unreadEntriesCount',
                                'readEntriesCount',
                            ],
                        },
                    );

                    // Mark entry as read in list, we don't refetch the list
                    entry.read_at = dayjs().toISOString();
                }}
            >
                <Indicator
                    size={12}
                    offset={15}
                    disabled={!!entry.read_at}
                    color="grey"
                    withBorder
                >
                    <Card
                        shadow="sm"
                        radius="sm"
                        withBorder
                        pt={10}
                        pb={10}
                        mb={10}
                        className={`${classes.entryCard}
                        ${entry.id === currentEntryID ? classes.activeEntry : ''}
                        ${entry.read_at ? classes.readEntry : ''}`}
                    >
                        <div>
                            <span className={classes.entryTitle}>
                                {entry.title}{' '}
                                {entry.starred_at && (
                                    <IconStarFilled size={15} />
                                )}
                            </span>
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
                    </Card>
                </Indicator>
            </Link>
        );
    });

    if (paginationType === 'classic') {
        return (
            <List
                style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    width: '100%',
                }}
            >
                <ScrollArea style={{ flex: 1 }} viewportRef={viewport}>
                    {entryList}
                </ScrollArea>
                <Divider />
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Pagination.Root
                        size="sm"
                        total={entries.last_page}
                        value={entries.current_page}
                        getItemProps={(page: number) => ({
                            component: Link,
                            href: route('feeds.index'),
                            only: ['entries'],
                            preserveScroll: true,
                            preserveState: true,
                            prefetch: true,
                            data: {
                                ...Object.fromEntries(
                                    new URLSearchParams(window.location.search),
                                ),
                                page,
                            },
                        })}
                    >
                        <Group gap={7} mt="md">
                            <Pagination.First
                                component={Link}
                                href={route('feeds.index')}
                                only={['entries']}
                                preserveScroll
                                preserveState
                                prefetch
                                data={{
                                    ...Object.fromEntries(
                                        new URLSearchParams(
                                            window.location.search,
                                        ),
                                    ),
                                    page: 1,
                                }}
                            />
                            <Pagination.Previous
                                component={Link}
                                href={route('feeds.index')}
                                only={['entries']}
                                preserveScroll
                                preserveState
                                prefetch
                                data={{
                                    ...Object.fromEntries(
                                        new URLSearchParams(
                                            window.location.search,
                                        ),
                                    ),
                                    page: Math.max(1, entries.current_page - 1),
                                }}
                            />
                            <Pagination.Items />
                            <Pagination.Next
                                component={Link}
                                href={route('feeds.index')}
                                only={['entries']}
                                preserveScroll
                                preserveState
                                prefetch
                                data={{
                                    ...Object.fromEntries(
                                        new URLSearchParams(
                                            window.location.search,
                                        ),
                                    ),
                                    page: Math.min(
                                        entries.last_page,
                                        entries.current_page + 1,
                                    ),
                                }}
                            />
                            <Pagination.Last
                                component={Link}
                                href={route('feeds.index')}
                                only={['entries']}
                                preserveScroll
                                preserveState
                                prefetch
                                data={{
                                    ...Object.fromEntries(
                                        new URLSearchParams(
                                            window.location.search,
                                        ),
                                    ),
                                    page: entries.last_page,
                                }}
                            />
                        </Group>
                    </Pagination.Root>
                </div>
            </List>
        );
    }

    // Infinite scroll mode
    return (
        <div
            ref={viewport}
            style={{
                height: '100%',
                width: '100%',
                overflowY: 'auto',
            }}
        >
            <InfiniteScroll data="entries" onlyNext buffer={50}>
                {({ loading }: { loading: boolean }) => (
                    <>
                        {entryList}
                        {loading && (
                            <div
                                style={{ padding: '20px', textAlign: 'center' }}
                            >
                                <Text size="sm" c="dimmed">
                                    Loading more entries...
                                </Text>
                            </div>
                        )}
                    </>
                )}
            </InfiniteScroll>
        </div>
    );
}

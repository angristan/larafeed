import classes from './EntryListPane.module.css';

import { PaginationMode } from '@/types';
import { InfiniteScroll, Link, router } from '@inertiajs/react';
import {
    Badge,
    Card,
    Divider,
    Flex,
    Group,
    Image,
    Indicator,
    Pagination,
    ScrollArea,
    Text,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import {
    IconFlame,
    IconMessageCircle,
    IconStarFilled,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { useEffect, useMemo, useRef } from 'react';

dayjs.extend(relativeTime);
dayjs.extend(utc);

interface EntryListPaneProps {
    entries: PaginatedEntries;
    currentEntryID?: number;
    paginationMode: PaginationMode;
    showHnBadges: boolean;
}

export default function EntryListPane({
    entries,
    currentEntryID,
    paginationMode,
    showHnBadges,
}: EntryListPaneProps) {
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

    useEffect(() => {
        if (paginationMode === 'classic') {
            viewport.current?.scrollTo({ top: 0, behavior: 'auto' });
        }
    }, [entries.current_page, paginationMode]);

    const entryItems = useMemo(
        () =>
            entries.data.map((entry) => {
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
                        ${
                            entry.id === currentEntryID
                                ? classes.activeEntry
                                : ''
                        }
                        ${entry.read_at ? classes.readEntry : ''}`}
                            >
                                <div>
                                    <span className={classes.entryTitle}>
                                        {entry.title}{' '}
                                        {entry.starred_at && (
                                            <IconStarFilled size={15} />
                                        )}
                                    </span>
                                    <Flex
                                        justify="space-between"
                                        mt={10}
                                        align="center"
                                    >
                                        <Flex align="center">
                                            <Image
                                                src={entry.feed.favicon_url}
                                                w={20}
                                                h={20}
                                                mr={9}
                                            />
                                            <Text size="xs" c="dimmed">
                                                <span>{entry.feed.name}</span>
                                            </Text>
                                            {showHnBadges &&
                                                (entry.hn_points !== null ||
                                                    entry.hn_comments_count !==
                                                        null) && (
                                                    <Group gap={6} ml={10}>
                                                        {entry.hn_points !==
                                                            null && (
                                                            <Badge
                                                                size="xs"
                                                                radius="sm"
                                                                variant="light"
                                                                color="orange"
                                                                styles={{
                                                                    root: {
                                                                        display:
                                                                            'inline-flex',
                                                                        alignItems:
                                                                            'center',
                                                                        padding:
                                                                            '3px 7px',
                                                                    },
                                                                    label: {
                                                                        fontSize:
                                                                            '0.72rem',
                                                                        lineHeight: 1.2,
                                                                    },
                                                                    leftSection: {
                                                                        marginRight:
                                                                            '2px',
                                                                    },
                                                                }}
                                                                leftSection={
                                                                    <IconFlame
                                                                        size={12}
                                                                    />
                                                                }
                                                            >
                                                                {
                                                                    entry.hn_points
                                                                }
                                                            </Badge>
                                                        )}
                                                        {entry.hn_comments_count !==
                                                            null && (
                                                            <Badge
                                                                size="xs"
                                                                radius="sm"
                                                                variant="light"
                                                                color="blue"
                                                                styles={{
                                                                    root: {
                                                                        display:
                                                                            'inline-flex',
                                                                        alignItems:
                                                                            'center',
                                                                        padding:
                                                                            '3px 7px',
                                                                    },
                                                                    label: {
                                                                        fontSize:
                                                                            '0.72rem',
                                                                        lineHeight: 1.2,
                                                                    },
                                                                    leftSection: {
                                                                        marginRight:
                                                                            '2px',
                                                                    },
                                                                }}
                                                                leftSection={
                                                                    <IconMessageCircle
                                                                        size={12}
                                                                    />
                                                                }
                                                            >
                                                                {
                                                                    entry.hn_comments_count
                                                                }
                                                            </Badge>
                                                        )}
                                                    </Group>
                                                )}
                                        </Flex>
                                        <Text size="xs" c="dimmed">
                                            {dayjs
                                                .utc(entry.published_at)
                                                .fromNow()}
                                        </Text>
                                    </Flex>
                                </div>
                            </Card>
                        </Indicator>
                    </Link>
                );
            }),
        [entries.data, currentEntryID, showHnBadges],
    );

    if (paginationMode === 'infinite') {
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
                            {entryItems}
                            {loading && (
                                <div
                                    style={{
                                        padding: '20px',
                                        textAlign: 'center',
                                    }}
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

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
            }}
        >
            <ScrollArea style={{ flex: 1 }} viewportRef={viewport}>
                {entryItems}
            </ScrollArea>
            <Divider my="sm" />
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
                                    new URLSearchParams(window.location.search),
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
                                    new URLSearchParams(window.location.search),
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
                                    new URLSearchParams(window.location.search),
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
                                    new URLSearchParams(window.location.search),
                                ),
                                page: entries.last_page,
                            }}
                        />
                    </Group>
                </Pagination.Root>
            </div>
        </div>
    );
}

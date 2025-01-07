import classes from './EntryListPane.module.css';

import { Link, router } from '@inertiajs/react';
import {
    Card,
    Divider,
    Flex,
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
}: {
    entries: PaginatedEntries;
    currentEntryID?: number;
}) {
    const viewport = useRef<HTMLDivElement>(null);

    const scrollToTop = () => {
        viewport.current?.scrollTo({ top: 0, behavior: 'instant' });
    };

    useEffect(() => {
        scrollToTop();
    }, [entries]);

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

    return (
        <List
            style={{
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
                <Pagination
                    size="sm"
                    withEdges
                    color="dark"
                    total={entries.last_page}
                    value={entries.current_page}
                    onChange={(page) => {
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
                        });
                    }}
                    mt="md"
                />
            </div>
        </List>
    );
}

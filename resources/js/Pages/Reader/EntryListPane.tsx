import classes from './EntryListPane.module.css';

import { router } from '@inertiajs/react';
import { Card, Flex, Image, Indicator, ScrollArea, Text } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { IconStarFilled } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export default function EntryListPane({
    entries,
    currentEntryID,
}: {
    entries: Entry[];
    currentEntryID?: number;
}) {
    const getCurrentFeedIdFromURL = () =>
        window.location.search.match(/feed=(\d+)/)?.[1];

    const navigateToEntry = (offset: number) => {
        const index = entries.findIndex((entry) => entry.id === currentEntryID);
        const newIndex = index + offset;

        if (newIndex >= 0 && newIndex < entries.length) {
            router.visit('feeds', {
                only: [
                    'currententry',
                    'unreadEntriesCount',
                    'readEntriesCount',
                ],
                data: {
                    entry: entries[newIndex].id,
                    feed: window.location.search.match(/feed=(\d+)/)?.[1],
                    filter: window.location.search.match(/filter=(\w+)/)?.[1],
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

    const entryList = entries.map((entry) => (
        <div
            key={entry.id}
            className={classes.entry}
            onClick={() => {
                router.visit('feeds', {
                    only: [
                        'currententry',
                        'unreadEntriesCount',
                        'readEntriesCount',
                    ],
                    data: {
                        entry: entry.id,
                        feed: getCurrentFeedIdFromURL(),
                        filter: window.location.search.match(
                            /filter=(\w+)/,
                        )?.[1],
                    },
                    preserveScroll: true,
                    preserveState: true,
                });
                // Mark as read locally because we don't refetch the entries
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
                    className={`${classes.entryCard}
                        ${entry.id === currentEntryID ? classes.activeEntry : ''}
                        ${entry.read_at ? classes.readEntry : ''}`}
                >
                    <div>
                        <span className={classes.entryTitle}>
                            {entry.title}{' '}
                            {entry.starred_at && <IconStarFilled size={15} />}
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
        </div>
    ));

    return (
        <ScrollArea style={{ height: '100%', width: '100%' }}>
            {entryList}
        </ScrollArea>
    );
}

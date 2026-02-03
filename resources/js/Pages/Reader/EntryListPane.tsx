import { Link, router } from '@inertiajs/react';
import {
    Card,
    Divider,
    Flex,
    Group,
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
import { useCallback, useEffect, useRef } from 'react';
import { FaviconImage } from '@/Components/FaviconImage/FaviconImage';
import { getUrlParams } from '@/utils/queryString';
import classes from './EntryListPane.module.css';

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

    const scrollToTop = useCallback(() => {
        viewport.current?.scrollTo({ top: 0, behavior: 'instant' });
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on entries change
    useEffect(() => {
        scrollToTop();
    }, [entries, scrollToTop]);

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
                    ...getUrlParams(),
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
        const urlParams = { ...getUrlParams() };

        delete urlParams.summarize;
        delete urlParams.read;
        urlParams.entry = entry.id.toString();

        const data = urlParams;
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
                        pl={12}
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
                            <Flex justify="space-between" mt={10}>
                                <Flex>
                                    <FaviconImage
                                        src={entry.feed.favicon_url}
                                        isDark={entry.feed.favicon_is_dark}
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
            listStyleType="none"
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                paddingLeft: 0,
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
                            ...getUrlParams(),
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
                                ...getUrlParams(),
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
                                ...getUrlParams(),
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
                                ...getUrlParams(),
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
                                ...getUrlParams(),
                                page: entries.last_page,
                            }}
                        />
                    </Group>
                </Pagination.Root>
            </div>
        </List>
    );
}

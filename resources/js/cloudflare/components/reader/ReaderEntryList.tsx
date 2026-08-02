import {
    Alert,
    Button,
    Card,
    Center,
    Divider,
    Flex,
    Group,
    Indicator,
    List,
    Pagination,
    ScrollArea,
    Skeleton,
    Stack,
    Text,
} from '@mantine/core';
import { IconRefresh, IconStarFilled } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';

import type { ReaderEntryPage } from '../../api/reader';
import { type ReaderState, readerHref } from '../../readerState';
import { FeedFavicon } from './FeedFavicon';
import classes from './Reader.module.css';

interface ReaderEntryListProps {
    readonly state: ReaderState;
    readonly page: ReaderEntryPage | undefined;
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly isPlaceholderData: boolean;
    readonly error: Error | null;
    readonly onRetry: () => void;
    readonly onPrefetchEntry: (entryId: number) => void;
    readonly onPageChange: (page: number) => void;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: 'auto',
});

function formatRelativeTime(timestamp: number): string {
    const seconds = Math.round((timestamp - Date.now()) / 1_000);
    const ranges = [
        ['year', 31_536_000],
        ['month', 2_592_000],
        ['week', 604_800],
        ['day', 86_400],
        ['hour', 3_600],
        ['minute', 60],
    ] as const;

    for (const [unit, duration] of ranges) {
        if (Math.abs(seconds) >= duration) {
            return relativeTimeFormatter.format(
                Math.round(seconds / duration),
                unit,
            );
        }
    }

    return relativeTimeFormatter.format(seconds, 'second');
}

export function ReaderEntryList({
    state,
    page,
    isPending,
    isFetching,
    isPlaceholderData,
    error,
    onRetry,
    onPrefetchEntry,
    onPageChange,
}: ReaderEntryListProps) {
    const viewport = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isPlaceholderData && page?.pagination.page !== undefined) {
            viewport.current?.scrollTo({ top: 0, behavior: 'instant' });
        }
    }, [isPlaceholderData, page?.pagination.page]);

    return (
        <List
            aria-busy={isPending || isFetching}
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
                {isPending && page === undefined && (
                    <Stack gap="sm" p="sm">
                        {['first', 'second', 'third', 'fourth', 'fifth'].map(
                            (key) => (
                                <Skeleton key={key} height={92} radius="sm" />
                            ),
                        )}
                    </Stack>
                )}

                {error !== null && page === undefined && (
                    <Center p="xl">
                        <Alert color="red" title="Entries unavailable">
                            <Stack gap="sm">
                                <Text size="sm">{error.message}</Text>
                                <Button
                                    leftSection={
                                        <IconRefresh
                                            aria-hidden="true"
                                            size={15}
                                        />
                                    }
                                    onClick={onRetry}
                                    size="xs"
                                    variant="light"
                                >
                                    Retry
                                </Button>
                            </Stack>
                        </Alert>
                    </Center>
                )}

                {page?.entries.map((entry) => {
                    const active = state.entryId === entry.id;
                    const feedName = entry.customFeedName ?? entry.feedName;
                    return (
                        <Link
                            key={entry.id}
                            id={`reader-entry-${entry.id}`}
                            aria-current={active ? 'true' : undefined}
                            className={classes.entry}
                            onFocus={() => onPrefetchEntry(entry.id)}
                            onMouseEnter={() => onPrefetchEntry(entry.id)}
                            to={readerHref(state, { entryId: entry.id })}
                        >
                            <Indicator
                                color="gray"
                                disabled={entry.read}
                                offset={15}
                                size={12}
                                withBorder
                            >
                                <Card
                                    className={`${classes.entryCard} ${
                                        active ? classes.activeEntry : ''
                                    } ${entry.read ? classes.readEntry : ''}`}
                                    mb={10}
                                    pb={10}
                                    pl={12}
                                    pt={10}
                                    radius="sm"
                                    shadow="sm"
                                    withBorder
                                >
                                    <span className={classes.entryTitle}>
                                        {entry.title || 'Untitled entry'}{' '}
                                        {entry.starred && (
                                            <IconStarFilled size={15} />
                                        )}
                                    </span>
                                    <Flex justify="space-between" mt={10}>
                                        <Flex>
                                            <FeedFavicon
                                                isDark={entry.faviconIsDark}
                                                size={20}
                                                src={entry.faviconUrl}
                                            />
                                            <Text c="dimmed" ml={9} size="xs">
                                                {feedName}
                                            </Text>
                                        </Flex>
                                        <Text
                                            c="dimmed"
                                            component="time"
                                            dateTime={new Date(
                                                entry.publishedAt,
                                            ).toISOString()}
                                            size="xs"
                                        >
                                            {formatRelativeTime(
                                                entry.publishedAt,
                                            )}
                                        </Text>
                                    </Flex>
                                </Card>
                            </Indicator>
                        </Link>
                    );
                })}
            </ScrollArea>

            {page !== undefined && page.pagination.totalPages > 1 && (
                <>
                    <Divider />
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <Pagination.Root
                            onChange={onPageChange}
                            size="sm"
                            total={page.pagination.totalPages}
                            value={state.page}
                        >
                            <Group gap={7} mt="md">
                                <Pagination.First />
                                <Pagination.Previous />
                                <Pagination.Items />
                                <Pagination.Next />
                                <Pagination.Last />
                            </Group>
                        </Pagination.Root>
                    </div>
                </>
            )}
        </List>
    );
}

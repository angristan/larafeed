import {
    Alert,
    Button,
    Center,
    Group,
    Loader,
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

const filterTitles = {
    all: 'All entries',
    unread: 'Unread entries',
    read: 'Read entries',
    favorites: 'Favorites',
} as const;

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

    const scopeTitle =
        state.feedId !== null
            ? 'Feed entries'
            : state.categoryId !== null
              ? 'Category entries'
              : filterTitles[state.filter];

    return (
        <section
            aria-busy={isPending || isFetching}
            aria-label={scopeTitle}
            className={classes.entryList}
        >
            <header className={classes.listHeader}>
                <div>
                    <Text fw={700} size="sm">
                        {scopeTitle}
                    </Text>
                    <Text c="dimmed" size="xs">
                        {page === undefined
                            ? 'Loading entries'
                            : `${page.pagination.total.toLocaleString()} total`}
                    </Text>
                </div>
                {isFetching && page !== undefined && (
                    <Loader aria-label="Refreshing entries" size="xs" />
                )}
            </header>

            <ScrollArea
                className={classes.entryListScroll}
                classNames={{
                    scrollbar: classes.readerScrollbar,
                    thumb: classes.readerScrollbarThumb,
                    viewport: classes.entryListViewport,
                }}
                viewportRef={viewport}
            >
                <div className={classes.entryScrollContent}>
                    {isPending && page === undefined && (
                        <Stack gap={0} aria-label="Loading entries">
                            {[
                                'first',
                                'second',
                                'third',
                                'fourth',
                                'fifth',
                            ].map((key) => (
                                <div
                                    className={classes.entrySkeleton}
                                    key={key}
                                >
                                    <Skeleton
                                        height={18}
                                        radius="sm"
                                        width="82%"
                                    />
                                    <Skeleton
                                        height={12}
                                        mt={14}
                                        radius="sm"
                                        width="58%"
                                    />
                                </div>
                            ))}
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

                    {page !== undefined && page.entries.length === 0 && (
                        <Center className={classes.emptyEntries}>
                            <Stack align="center" gap={4} ta="center">
                                <Text fw={650} size="sm">
                                    No entries here
                                </Text>
                                <Text c="dimmed" maw={260} size="xs">
                                    Choose another feed or filter, or wait for
                                    the next refresh.
                                </Text>
                            </Stack>
                        </Center>
                    )}

                    {page !== undefined && page.entries.length > 0 && (
                        <ul className={classes.entriesList}>
                            {page.entries.map((entry) => {
                                const active = state.entryId === entry.id;
                                const feedName =
                                    entry.customFeedName ?? entry.feedName;
                                return (
                                    <li
                                        className={classes.entryItem}
                                        key={entry.id}
                                    >
                                        <Link
                                            id={`reader-entry-${entry.id}`}
                                            aria-current={
                                                active ? 'true' : undefined
                                            }
                                            className={`${classes.entry} ${
                                                active
                                                    ? classes.activeEntry
                                                    : ''
                                            } ${entry.read ? classes.readEntry : ''}`}
                                            onFocus={() =>
                                                onPrefetchEntry(entry.id)
                                            }
                                            onMouseEnter={() =>
                                                onPrefetchEntry(entry.id)
                                            }
                                            to={readerHref(state, {
                                                entryId: entry.id,
                                            })}
                                        >
                                            <span
                                                aria-hidden="true"
                                                className={classes.unreadMarker}
                                                data-read={
                                                    entry.read || undefined
                                                }
                                            />
                                            <span className={classes.entryCopy}>
                                                <span
                                                    className={
                                                        classes.entryTitle
                                                    }
                                                >
                                                    {entry.title ||
                                                        'Untitled entry'}
                                                    {entry.starred && (
                                                        <IconStarFilled
                                                            aria-label="Favorite"
                                                            className={
                                                                classes.starredIcon
                                                            }
                                                            size={14}
                                                        />
                                                    )}
                                                </span>
                                                <span
                                                    className={
                                                        classes.entryMeta
                                                    }
                                                >
                                                    <span
                                                        className={
                                                            classes.feedMeta
                                                        }
                                                    >
                                                        <FeedFavicon
                                                            isDark={
                                                                entry.faviconIsDark
                                                            }
                                                            size={18}
                                                            src={
                                                                entry.faviconUrl
                                                            }
                                                        />
                                                        <span>{feedName}</span>
                                                    </span>
                                                    <time
                                                        dateTime={new Date(
                                                            entry.publishedAt,
                                                        ).toISOString()}
                                                    >
                                                        {formatRelativeTime(
                                                            entry.publishedAt,
                                                        )}
                                                    </time>
                                                </span>
                                            </span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </ScrollArea>

            {page !== undefined && (
                <footer className={classes.listPagination}>
                    <Pagination.Root
                        onChange={onPageChange}
                        size="sm"
                        total={page.pagination.totalPages}
                        value={state.page}
                    >
                        <Group gap={7} justify="center" wrap="nowrap">
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

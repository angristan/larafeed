import {
    Alert,
    Button,
    Center,
    Group,
    Loader,
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
    readonly entries: ReaderEntryPage['entries'];
    readonly total: number | undefined;
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly isFetchingNextPage: boolean;
    readonly hasNextPage: boolean;
    readonly error: Error | null;
    readonly onRetry: () => void;
    readonly onPrefetchEntry: (entryId: number) => void;
    readonly onLoadMore: () => void;
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

const orderLabels = {
    published_at: 'Published',
    created_at: 'Added',
} as const;

export function ReaderEntryList({
    state,
    entries,
    total,
    isPending,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    error,
    onRetry,
    onPrefetchEntry,
    onLoadMore,
}: ReaderEntryListProps) {
    const viewport = useRef<HTMLDivElement>(null);
    const sentinel = useRef<HTMLDivElement>(null);
    const loadMore = useRef(onLoadMore);
    loadMore.current = onLoadMore;

    const scopeKey = `${state.feedId}:${state.categoryId}:${state.filter}:${state.orderBy}`;
    // biome-ignore lint/correctness/useExhaustiveDependencies: the scroll position resets whenever the list scope changes
    useEffect(() => {
        viewport.current?.scrollTo({ top: 0, behavior: 'instant' });
    }, [scopeKey]);

    useEffect(() => {
        const target = sentinel.current;
        if (
            target === null ||
            !hasNextPage ||
            typeof IntersectionObserver === 'undefined'
        ) {
            return;
        }

        const observer = new IntersectionObserver(
            (observed) => {
                if (observed.some((entry) => entry.isIntersecting)) {
                    loadMore.current();
                }
            },
            { root: viewport.current, rootMargin: '320px 0px' },
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, [hasNextPage]);

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
                        {total === undefined
                            ? 'Loading entries'
                            : `${total.toLocaleString()} total`}
                    </Text>
                </div>
                <Group gap="xs" wrap="nowrap">
                    <Text c="dimmed" size="xs">
                        {orderLabels[state.orderBy]}
                    </Text>
                    {isFetching && !isPending && !isFetchingNextPage && (
                        <Loader aria-label="Refreshing entries" size="xs" />
                    )}
                </Group>
            </header>

            <ScrollArea
                className={classes.entryListScroll}
                classNames={{
                    scrollbar: classes.readerScrollbar,
                    thumb: classes.readerScrollbarThumb,
                }}
                viewportRef={viewport}
            >
                <div className={classes.entryScrollContent}>
                    {isPending && (
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

                    {error !== null && entries.length === 0 && (
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

                    {!isPending && error === null && entries.length === 0 && (
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

                    {entries.length > 0 && (
                        <ul className={classes.entriesList}>
                            {entries.map((entry) => {
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
                    {hasNextPage && (
                        <div
                            aria-hidden="true"
                            className={classes.listSentinel}
                            ref={sentinel}
                        />
                    )}
                    {isFetchingNextPage && (
                        <Center className={classes.listLoadingMore}>
                            <Loader
                                aria-label="Loading more entries"
                                size="xs"
                            />
                        </Center>
                    )}
                </div>
            </ScrollArea>
        </section>
    );
}

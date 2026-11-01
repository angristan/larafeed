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
    VisuallyHidden,
} from '@mantine/core';
import {
    IconArrowUp,
    IconCheck,
    IconRefresh,
    IconStarFilled,
} from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import type { ReaderEntryPage } from '../../api/reader';
import type { FeedListDensity } from '../../readerPreferences';
import { type ReaderState, readerHref } from '../../readerState';
import { FeedFavicon } from './FeedFavicon';
import classes from './Reader.module.css';

interface ReaderEntryListProps {
    readonly density: FeedListDensity;
    readonly state: ReaderState;
    readonly scopeTitle: string;
    readonly entries: ReaderEntryPage['entries'];
    readonly total: number | undefined;
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly isFetchingNextPage: boolean;
    readonly hasNextPage: boolean;
    readonly newEntryCount: number;
    readonly error: Error | null;
    readonly onRetry: () => void;
    readonly onPrefetchEntry: (entryId: number) => void;
    readonly onLoadMore: () => void;
    readonly onShowNewEntries: () => void;
    readonly restoreFocusEntryId: number | null;
    readonly onRestoreFocusHandled: () => void;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: 'auto',
});
const absoluteTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
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

const emptyStates = {
    all: {
        title: 'No entries yet',
        message: 'New entries will appear after the next feed refresh.',
    },
    unread: {
        title: 'You’re all caught up',
        message: 'New unread entries will appear here.',
    },
    read: {
        title: 'No read entries',
        message: 'Entries you open will appear here.',
    },
    favorites: {
        title: 'No favorites yet',
        message: 'Star an entry to keep it here.',
    },
} as const;

const orderLabels = {
    published_at: 'Published',
    created_at: 'Added',
} as const;

// The list header overlays the top of the scroll viewport; the virtualizer
// must reserve that space so scrollToIndex keeps rows clear of it.
const LIST_HEADER_HEIGHT = 57;

// Row heights from Reader.module.css (min-height plus the 1px separator).
const estimateEntrySize = (density: FeedListDensity): number => {
    switch (density) {
        case 'compact':
            return 45;
        case 'spacious':
            return 73;
        default:
            return 65;
    }
};

export function ReaderEntryList({
    density,
    state,
    scopeTitle,
    entries,
    total,
    isPending,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    newEntryCount,
    error,
    onRetry,
    onPrefetchEntry,
    onLoadMore,
    onShowNewEntries,
    restoreFocusEntryId,
    onRestoreFocusHandled,
}: ReaderEntryListProps) {
    const viewport = useRef<HTMLDivElement>(null);
    const sentinel = useRef<HTMLDivElement>(null);
    const loadMore = useRef(onLoadMore);
    loadMore.current = onLoadMore;
    // Indices of the rows present when the scope changed or entries first
    // loaded; only those get the enter animation.
    const [animateRows, setAnimateRows] = useState<ReadonlySet<number> | null>(
        null,
    );

    const virtualizer = useVirtualizer({
        count: entries.length,
        getScrollElement: () => viewport.current,
        estimateSize: () => estimateEntrySize(density),
        overscan: 6,
        paddingStart: LIST_HEADER_HEIGHT,
        scrollPaddingStart: LIST_HEADER_HEIGHT,
        // Gives server-rendered markup a first window of rows; the real
        // viewport rect replaces it once the scroll element mounts.
        initialRect: { width: 1024, height: 640 },
    });

    const emptyState = emptyStates[state.filter];
    const scopeKey = `${state.feedId}:${state.categoryId}:${state.filter}:${state.orderBy}`;
    const previousScope = useRef(scopeKey);
    const wasEmpty = useRef(entries.length === 0);
    const animationTimer = useRef<number | null>(null);
    useEffect(() => {
        const scopeChanged = previousScope.current !== scopeKey;
        const entriesArrived = wasEmpty.current && entries.length > 0;
        previousScope.current = scopeKey;
        wasEmpty.current = entries.length === 0;
        if (scopeChanged) {
            viewport.current?.scrollTo({ top: 0, behavior: 'instant' });
        }
        if (!scopeChanged && !entriesArrived) {
            return;
        }
        // Rows mount and unmount as the virtual window moves, so the enter
        // animation only plays for rows present when the scope changes or
        // entries first load; scroll-mounted rows must not animate (the
        // stagger delay would hold them at opacity 0). The expiry timer
        // lives in a ref: effect re-runs caused by pagination must not
        // cancel it, or the gate would stay on indefinitely.
        setAnimateRows(
            new Set(virtualizer.getVirtualItems().map((item) => item.index)),
        );
        if (animationTimer.current !== null) {
            window.clearTimeout(animationTimer.current);
        }
        animationTimer.current = window.setTimeout(() => {
            animationTimer.current = null;
            setAnimateRows(null);
        }, 900);
    }, [scopeKey, entries.length, virtualizer.getVirtualItems]);
    useEffect(
        () => () => {
            if (animationTimer.current !== null) {
                window.clearTimeout(animationTimer.current);
            }
        },
        [],
    );

    // Scroll to the selected row only when the selection changes or the list
    // first loads with a selection (deep link). Refetches can shift the row's
    // index when new entries arrive above it, and scrolling then would yank
    // the user's scroll position.
    const selectedEntryId = state.entryId;
    const previousSelection = useRef<number | null>(selectedEntryId);
    const selectionScrollPending = useRef(selectedEntryId !== null);
    useEffect(() => {
        if (selectedEntryId === null) {
            previousSelection.current = null;
            selectionScrollPending.current = false;
            return;
        }
        // Persist the pending request on every selection change and clear it
        // only once the row is found or the selection is cleared, so history
        // navigation to an entry on a not-yet-loaded page still scrolls once
        // it arrives.
        if (previousSelection.current !== selectedEntryId) {
            previousSelection.current = selectedEntryId;
            selectionScrollPending.current = true;
        }
        if (!selectionScrollPending.current) {
            return;
        }
        const index = entries.findIndex(
            (entry) => entry.id === selectedEntryId,
        );
        if (index === -1) {
            return;
        }
        selectionScrollPending.current = false;
        virtualizer.scrollToIndex(index, { align: 'auto' });
    }, [selectedEntryId, entries, virtualizer]);

    useEffect(() => {
        if (restoreFocusEntryId === null) {
            return;
        }
        const index = entries.findIndex(
            (entry) => entry.id === restoreFocusEntryId,
        );
        if (index === -1) {
            return;
        }
        const entryId = restoreFocusEntryId;
        virtualizer.scrollToIndex(index, { align: 'center' });
        // On single-pane layouts the list pane is display:none while the
        // detail is open, so the row only mounts once the pane is visible
        // again; retry until then.
        let cancelled = false;
        let frame = 0;
        let attempts = 0;
        const focusWhenMounted = () => {
            if (cancelled) {
                return;
            }
            const row = document.getElementById(`reader-entry-${entryId}`);
            if (row !== null || attempts >= 180) {
                row?.focus();
                onRestoreFocusHandled();
                return;
            }
            attempts += 1;
            frame = window.requestAnimationFrame(focusWhenMounted);
        };
        frame = window.requestAnimationFrame(focusWhenMounted);
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame);
        };
    }, [restoreFocusEntryId, entries, virtualizer, onRestoreFocusHandled]);

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

    return (
        <section
            aria-busy={isPending || isFetching}
            aria-label={scopeTitle}
            className={classes.entryList}
            data-density={density}
        >
            <header className={classes.listHeader}>
                <div className={classes.listHeaderCopy}>
                    <Text fw={700} size="sm" title={scopeTitle} truncate>
                        {scopeTitle}
                    </Text>
                    <Text c="dimmed" size="xs">
                        {total === undefined
                            ? 'Loading entries'
                            : `${total.toLocaleString()} total`}
                    </Text>
                </div>
                <Group gap="xs" wrap="nowrap">
                    {newEntryCount > 0 && (
                        <Button
                            className={classes.newEntriesChip}
                            leftSection={
                                <IconArrowUp aria-hidden="true" size={12} />
                            }
                            onClick={() => {
                                const target = viewport.current;
                                const reduceMotion = window.matchMedia(
                                    '(prefers-reduced-motion: reduce)',
                                ).matches;
                                target?.scrollTo({
                                    top: 0,
                                    behavior:
                                        reduceMotion || target.scrollTop > 3_000
                                            ? 'instant'
                                            : 'smooth',
                                });
                                onShowNewEntries();
                            }}
                            size="compact-xs"
                            variant="light"
                        >
                            {newEntryCount.toLocaleString()} new{' '}
                            {newEntryCount === 1 ? 'entry' : 'entries'}
                        </Button>
                    )}
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
                    viewport: classes.entryListViewport,
                }}
                viewportRef={viewport}
            >
                <div className={classes.entryScrollContent}>
                    {isPending && (
                        <Stack
                            aria-label="Loading entries"
                            className={classes.entryScrollState}
                            gap={0}
                        >
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
                        <Center
                            className={classes.entryScrollState}
                            pb="xl"
                            px="xl"
                        >
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
                        <Center
                            className={`${classes.emptyEntries} ${classes.entryScrollState}`}
                        >
                            <Stack align="center" gap={4} ta="center">
                                <Text fw={650} size="sm">
                                    {emptyState.title}
                                </Text>
                                <Text c="dimmed" maw={260} size="xs">
                                    {emptyState.message}
                                </Text>
                            </Stack>
                        </Center>
                    )}

                    {entries.length > 0 && (
                        <ul
                            className={classes.entriesList}
                            data-animating={animateRows !== null || undefined}
                            style={{
                                height: `${virtualizer.getTotalSize()}px`,
                            }}
                        >
                            {virtualizer
                                .getVirtualItems()
                                .map((virtualItem) => {
                                    const entry = entries[virtualItem.index];
                                    if (entry === undefined) {
                                        return null;
                                    }
                                    const active = state.entryId === entry.id;
                                    const feedName =
                                        entry.customFeedName ?? entry.feedName;
                                    return (
                                        <li
                                            className={`${classes.entryItem}${animateRows?.has(virtualItem.index) ? ` ${classes.rowEnter}` : ''}`}
                                            data-index={virtualItem.index}
                                            key={entry.id}
                                            ref={virtualizer.measureElement}
                                            style={
                                                {
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    width: '100%',
                                                    transform: `translateY(${virtualItem.start}px)`,
                                                    '--entry-enter-delay': `${Math.min(virtualItem.index, 12) * 16}ms`,
                                                } as CSSProperties
                                            }
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
                                                data-read={entry.read}
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
                                                    className={
                                                        classes.unreadMarker
                                                    }
                                                    data-read={
                                                        entry.read || undefined
                                                    }
                                                >
                                                    {entry.read && (
                                                        <IconCheck
                                                            size={11}
                                                            stroke={2.5}
                                                        />
                                                    )}
                                                </span>
                                                <VisuallyHidden>
                                                    {entry.read
                                                        ? 'Read entry. '
                                                        : 'Unread entry. '}
                                                </VisuallyHidden>
                                                <span
                                                    className={
                                                        classes.entryCopy
                                                    }
                                                >
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
                                                            <span
                                                                title={feedName}
                                                            >
                                                                {feedName}
                                                            </span>
                                                        </span>
                                                        <time
                                                            dateTime={new Date(
                                                                entry.publishedAt,
                                                            ).toISOString()}
                                                            title={absoluteTimeFormatter.format(
                                                                entry.publishedAt,
                                                            )}
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

import {
    Alert,
    Badge,
    Button,
    Center,
    Group,
    Loader,
    Pagination,
    ScrollArea,
    Skeleton,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import {
    IconCheck,
    IconRefresh,
    IconRss,
    IconStarFilled,
} from '@tabler/icons-react';
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
    readonly selectedFeedName: string | null;
    readonly onMarkFeedRead: (() => void) | null;
    readonly markFeedReadPending: boolean;
    readonly markFeedReadError: Error | null;
}

function formatTimestamp(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(timestamp));
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
    selectedFeedName,
    onMarkFeedRead,
    markFeedReadPending,
    markFeedReadError,
}: ReaderEntryListProps) {
    const viewport = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isPlaceholderData && page?.pagination.page !== undefined) {
            viewport.current?.scrollTo({ top: 0, behavior: 'instant' });
        }
    }, [isPlaceholderData, page?.pagination.page]);

    return (
        <section
            aria-busy={isPending || isFetching}
            aria-labelledby="entry-list-title"
            className={classes.listPane}
        >
            <Group
                className={classes.paneHeader}
                justify="space-between"
                wrap="nowrap"
            >
                <Stack gap={0} className={classes.headingClamp}>
                    <Title id="entry-list-title" order={2} size="h4">
                        {selectedFeedName ?? 'Entries'}
                    </Title>
                    {page !== undefined && (
                        <Text c="dimmed" size="xs">
                            {page.pagination.total.toLocaleString()} entries
                        </Text>
                    )}
                </Stack>

                <Group gap="xs" wrap="nowrap">
                    {isFetching && !isPending && (
                        <Loader aria-label="Refreshing entries" size={16} />
                    )}
                    {onMarkFeedRead !== null && (
                        <Button
                            aria-label="Mark all entries in this feed as read"
                            leftSection={
                                <IconCheck aria-hidden="true" size={15} />
                            }
                            loading={markFeedReadPending}
                            onClick={onMarkFeedRead}
                            size="xs"
                            variant="light"
                        >
                            Mark feed read
                        </Button>
                    )}
                </Group>
            </Group>

            {markFeedReadError !== null && (
                <Alert color="red" m="sm" role="alert">
                    {markFeedReadError.message}
                </Alert>
            )}

            <ScrollArea
                className={classes.entryScroll}
                offsetScrollbars="y"
                viewportRef={viewport}
            >
                {isPending && page === undefined && (
                    <Stack gap="sm" p="sm">
                        {[
                            'first',
                            'second',
                            'third',
                            'fourth',
                            'fifth',
                            'sixth',
                            'seventh',
                            'eighth',
                        ].map((key) => (
                            <Skeleton key={key} height={96} radius="md" />
                        ))}
                    </Stack>
                )}

                {error !== null && page === undefined && (
                    <Center className={classes.paneState}>
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
                    <Center className={classes.paneState}>
                        <Stack align="center" gap="xs">
                            <IconRss
                                aria-hidden="true"
                                color="var(--mantine-color-dimmed)"
                                size={32}
                            />
                            <Text fw={600}>No entries here</Text>
                            <Text c="dimmed" size="sm" ta="center">
                                Try another feed or filter.
                            </Text>
                        </Stack>
                    </Center>
                )}

                {page !== undefined && page.entries.length > 0 && (
                    <ol
                        aria-label="Feed entries"
                        className={classes.entryList}
                        data-placeholder={isPlaceholderData || undefined}
                    >
                        {page.entries.map((entry) => {
                            const active = state.entryId === entry.id;
                            const feedName =
                                entry.customFeedName ?? entry.feedName;

                            return (
                                <li key={entry.id}>
                                    <Link
                                        id={`reader-entry-${entry.id}`}
                                        aria-current={
                                            active ? 'true' : undefined
                                        }
                                        className={classes.entryLink}
                                        data-active={active || undefined}
                                        data-read={entry.read || undefined}
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
                                        <Group
                                            align="flex-start"
                                            gap="sm"
                                            justify="space-between"
                                            wrap="nowrap"
                                        >
                                            <Stack
                                                className={classes.entryCopy}
                                                gap="xs"
                                            >
                                                <Group gap={6} wrap="nowrap">
                                                    {!entry.read && (
                                                        <span
                                                            aria-label="Unread"
                                                            className={
                                                                classes.unreadDot
                                                            }
                                                            role="img"
                                                        />
                                                    )}
                                                    <Text
                                                        className={
                                                            classes.entryTitle
                                                        }
                                                        fw={
                                                            entry.read
                                                                ? 500
                                                                : 700
                                                        }
                                                        lineClamp={2}
                                                    >
                                                        {entry.title ||
                                                            'Untitled entry'}
                                                    </Text>
                                                    {entry.starred && (
                                                        <IconStarFilled
                                                            aria-label="Favorite"
                                                            className={
                                                                classes.starIcon
                                                            }
                                                            role="img"
                                                            size={15}
                                                        />
                                                    )}
                                                </Group>

                                                <Group
                                                    gap="xs"
                                                    justify="space-between"
                                                    wrap="nowrap"
                                                >
                                                    <Group
                                                        className={
                                                            classes.entryFeed
                                                        }
                                                        gap={6}
                                                        wrap="nowrap"
                                                    >
                                                        <FeedFavicon
                                                            isDark={
                                                                entry.faviconIsDark
                                                            }
                                                            size={16}
                                                            src={
                                                                entry.faviconUrl
                                                            }
                                                        />
                                                        <Text
                                                            c="dimmed"
                                                            lineClamp={1}
                                                            size="xs"
                                                        >
                                                            {feedName}
                                                        </Text>
                                                    </Group>
                                                    <Text
                                                        c="dimmed"
                                                        component="time"
                                                        dateTime={new Date(
                                                            entry.publishedAt,
                                                        ).toISOString()}
                                                        size="xs"
                                                        title={formatTimestamp(
                                                            entry.publishedAt,
                                                        )}
                                                    >
                                                        {formatTimestamp(
                                                            entry.publishedAt,
                                                        )}
                                                    </Text>
                                                </Group>
                                            </Stack>
                                            {entry.archived && (
                                                <Badge
                                                    color="gray"
                                                    size="xs"
                                                    variant="light"
                                                >
                                                    Archived
                                                </Badge>
                                            )}
                                        </Group>
                                    </Link>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </ScrollArea>

            {page !== undefined && page.pagination.totalPages > 1 && (
                <div className={classes.pagination}>
                    <Pagination
                        aria-label="Entry pages"
                        disabled={isPlaceholderData}
                        onChange={onPageChange}
                        size="sm"
                        total={page.pagination.totalPages}
                        value={state.page}
                        withEdges
                    />
                </div>
            )}
        </section>
    );
}

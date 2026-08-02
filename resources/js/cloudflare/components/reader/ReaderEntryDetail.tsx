import {
    ActionIcon,
    Alert,
    Box,
    Button,
    Center,
    Divider,
    Group,
    Loader,
    ScrollArea,
    Skeleton,
    Stack,
    Text,
    Title,
    Tooltip,
    Typography,
} from '@mantine/core';
import {
    IconArchive,
    IconArchiveOff,
    IconArrowLeft,
    IconCircle,
    IconCircleFilled,
    IconExternalLink,
    IconRefresh,
    IconRss,
    IconSparkles,
    IconStar,
    IconStarFilled,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import type { ReaderEntry } from '../../api/reader';
import {
    entrySummaryQueryOptions,
    generateEntrySummaryMutationOptions,
} from '../../queries/summaries';
import { FeedFavicon } from './FeedFavicon';
import classes from './Reader.module.css';
import { estimateReadingTime, textFromSanitizedHtml } from './readingTime';

interface ReaderEntryDetailProps {
    readonly entry: ReaderEntry | undefined;
    readonly selected: boolean;
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly error: Error | null;
    readonly mutationError: Error | null;
    readonly readPending: boolean;
    readonly starPending: boolean;
    readonly archivePending: boolean;
    readonly onRetry: () => void;
    readonly onBack: () => void;
    readonly onSetRead: (read: boolean) => void;
    readonly onSetStarred: (starred: boolean) => void;
    readonly onSetArchived: (archived: boolean) => void;
}

function formatTimestamp(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'long',
        timeStyle: 'short',
    }).format(new Date(timestamp));
}

function ReaderEntrySummary({ entryId }: { readonly entryId: number }) {
    const queryClient = useQueryClient();
    const summaryQuery = useQuery(entrySummaryQueryOptions(entryId));
    const generateMutation = useMutation(
        generateEntrySummaryMutationOptions(queryClient, entryId),
    );
    const summary = summaryQuery.data?.summary ?? null;

    if (summaryQuery.isPending) {
        return (
            <Group aria-label="Loading AI summary" gap="xs" mt="xl">
                <Loader size={15} />
                <Text c="dimmed" size="sm">
                    Loading summary…
                </Text>
            </Group>
        );
    }

    if (summaryQuery.error !== null) {
        return (
            <Alert color="red" mt="xl" title="Summary unavailable">
                <Stack gap="sm">
                    <Text size="sm">{summaryQuery.error.message}</Text>
                    <Button
                        onClick={() => void summaryQuery.refetch()}
                        size="xs"
                        variant="light"
                    >
                        Retry
                    </Button>
                </Stack>
            </Alert>
        );
    }

    return (
        <Stack gap="sm" mt="xl">
            {summary === null ? (
                <Text c="dimmed" size="sm">
                    Generate a concise AI summary of this article.
                </Text>
            ) : (
                <Alert
                    color="blue"
                    icon={<IconSparkles size={17} />}
                    title="AI summary"
                >
                    <div
                        // Summary HTML is sanitized by the Worker before persistence.
                        dangerouslySetInnerHTML={{ __html: summary.html }}
                    />
                </Alert>
            )}
            {generateMutation.error !== null && (
                <Alert color="red" role="alert">
                    {generateMutation.error.message}
                </Alert>
            )}
            {summary === null && (
                <Button
                    leftSection={<IconSparkles aria-hidden="true" size={16} />}
                    loading={generateMutation.isPending}
                    onClick={() => generateMutation.mutate()}
                    size="xs"
                    variant="light"
                    w="fit-content"
                >
                    Generate summary
                </Button>
            )}
        </Stack>
    );
}

export function ReaderEntryDetail({
    entry,
    selected,
    isPending,
    isFetching,
    error,
    mutationError,
    readPending,
    starPending,
    archivePending,
    onRetry,
    onBack,
    onSetRead,
    onSetStarred,
    onSetArchived,
}: ReaderEntryDetailProps) {
    const articleContent = useRef<HTMLDivElement>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const readingTime = useMemo(
        () =>
            entry?.contentHtml == null
                ? null
                : estimateReadingTime(textFromSanitizedHtml(entry.contentHtml)),
        [entry?.contentHtml],
    );

    useEffect(() => {
        if (entry === undefined) {
            return;
        }

        heading.current?.focus({ preventScroll: true });
        const content = articleContent.current;
        if (content === null) {
            return;
        }

        for (const anchor of content.querySelectorAll<HTMLAnchorElement>(
            'a[href]',
        )) {
            anchor.target = '_blank';
            const rel = new Set(
                (anchor.rel ?? '').split(/\s+/).filter(Boolean),
            );
            rel.add('noopener');
            rel.add('noreferrer');
            anchor.rel = [...rel].join(' ');
        }
    }, [entry]);

    if (!selected) {
        return (
            <section aria-label="Entry detail" className={classes.detailPane}>
                <Center className={classes.paneState}>
                    <Stack align="center" gap="xs">
                        <IconRss
                            aria-hidden="true"
                            color="var(--mantine-color-dimmed)"
                            size={36}
                        />
                        <Text fw={600}>Select an entry to read</Text>
                        <Text c="dimmed" size="sm">
                            Use J and K to move through the list.
                        </Text>
                    </Stack>
                </Center>
            </section>
        );
    }

    if (isPending && entry === undefined) {
        return (
            <section
                aria-busy="true"
                aria-label="Loading entry"
                className={classes.detailPane}
            >
                <Stack gap="md" p="lg">
                    <Skeleton height={30} width="70%" />
                    <Skeleton height={16} width="35%" />
                    <Skeleton height={12} mt="lg" />
                    <Skeleton height={12} />
                    <Skeleton height={12} width="92%" />
                    <Skeleton height={180} mt="md" />
                </Stack>
            </section>
        );
    }

    if (error !== null && entry === undefined) {
        return (
            <section aria-label="Entry error" className={classes.detailPane}>
                <Center className={classes.paneState}>
                    <Alert color="red" title="Entry unavailable">
                        <Stack gap="sm">
                            <Text size="sm">{error.message}</Text>
                            <Group>
                                <Button
                                    className={classes.mobileOnly}
                                    leftSection={
                                        <IconArrowLeft
                                            aria-hidden="true"
                                            size={15}
                                        />
                                    }
                                    onClick={onBack}
                                    size="xs"
                                    variant="default"
                                >
                                    Back to entries
                                </Button>
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
                            </Group>
                        </Stack>
                    </Alert>
                </Center>
            </section>
        );
    }

    if (entry === undefined) {
        return null;
    }

    const feedName = entry.customFeedName ?? entry.feedName;

    return (
        <article
            aria-busy={isFetching}
            aria-labelledby="entry-detail-title"
            className={classes.detailPane}
        >
            <Group
                className={classes.paneHeader}
                justify="space-between"
                wrap="nowrap"
            >
                <Group className={classes.headingClamp} gap="xs" wrap="nowrap">
                    <Button
                        aria-label="Back to entry list"
                        className={classes.mobileOnly}
                        leftSection={
                            <IconArrowLeft aria-hidden="true" size={16} />
                        }
                        onClick={onBack}
                        size="xs"
                        variant="subtle"
                    >
                        Back
                    </Button>
                    <FeedFavicon
                        isDark={entry.faviconIsDark}
                        src={entry.faviconUrl}
                        size={18}
                    />
                    <Text c="dimmed" lineClamp={1} size="sm">
                        {feedName}
                    </Text>
                </Group>

                <Group gap={6} wrap="nowrap">
                    {isFetching && (
                        <Loader aria-label="Refreshing entry" size={15} />
                    )}
                    {entry.url !== null && (
                        <Tooltip label="Open original article">
                            <ActionIcon
                                aria-label="Open original article in a new tab"
                                component="a"
                                href={entry.url}
                                rel="noopener noreferrer"
                                target="_blank"
                                variant="default"
                            >
                                <IconExternalLink
                                    aria-hidden="true"
                                    size={16}
                                />
                            </ActionIcon>
                        </Tooltip>
                    )}
                    <Tooltip
                        label={
                            entry.starred ? 'Remove favorite' : 'Add favorite'
                        }
                    >
                        <ActionIcon
                            aria-label={
                                entry.starred
                                    ? 'Remove entry from favorites'
                                    : 'Add entry to favorites'
                            }
                            aria-pressed={entry.starred}
                            loading={starPending}
                            onClick={() => onSetStarred(!entry.starred)}
                            variant="default"
                        >
                            {entry.starred ? (
                                <IconStarFilled aria-hidden="true" size={16} />
                            ) : (
                                <IconStar aria-hidden="true" size={16} />
                            )}
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip label={entry.read ? 'Mark unread' : 'Mark read'}>
                        <ActionIcon
                            aria-label={
                                entry.read
                                    ? 'Mark entry as unread'
                                    : 'Mark entry as read'
                            }
                            aria-pressed={entry.read}
                            loading={readPending}
                            onClick={() => onSetRead(!entry.read)}
                            variant="default"
                        >
                            {entry.read ? (
                                <IconCircle aria-hidden="true" size={16} />
                            ) : (
                                <IconCircleFilled
                                    aria-hidden="true"
                                    size={16}
                                />
                            )}
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip
                        label={
                            entry.archived ? 'Restore entry' : 'Archive entry'
                        }
                    >
                        <ActionIcon
                            aria-label={
                                entry.archived
                                    ? 'Restore archived entry'
                                    : 'Archive entry'
                            }
                            aria-pressed={entry.archived}
                            loading={archivePending}
                            onClick={() => onSetArchived(!entry.archived)}
                            variant="default"
                        >
                            {entry.archived ? (
                                <IconArchiveOff aria-hidden="true" size={16} />
                            ) : (
                                <IconArchive aria-hidden="true" size={16} />
                            )}
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </Group>

            {mutationError !== null && (
                <Alert color="red" m="sm" role="alert">
                    {mutationError.message}
                </Alert>
            )}

            <Divider />

            <ScrollArea className={classes.detailScroll} offsetScrollbars="y">
                <Box className={classes.article}>
                    <Title
                        ref={heading}
                        id="entry-detail-title"
                        order={1}
                        tabIndex={-1}
                    >
                        {entry.title || 'Untitled entry'}
                    </Title>
                    <Group gap="xs" justify="space-between" mt="sm">
                        <Text c="dimmed" size="sm">
                            {entry.author ?? feedName}
                        </Text>
                        <Group gap="xs">
                            {readingTime !== null && readingTime.words > 0 && (
                                <Text
                                    aria-label="Estimated reading time at 300 words per minute"
                                    c="dimmed"
                                    size="sm"
                                >
                                    {readingTime.minutes} min read
                                </Text>
                            )}
                            <Text
                                c="dimmed"
                                component="time"
                                dateTime={new Date(
                                    entry.publishedAt,
                                ).toISOString()}
                                size="sm"
                            >
                                {formatTimestamp(entry.publishedAt)}
                            </Text>
                        </Group>
                    </Group>

                    <ReaderEntrySummary entryId={entry.id} />

                    <Typography mt="xl">
                        {entry.contentHtml === null ||
                        entry.contentHtml.trim().length === 0 ? (
                            <Alert color="gray" title="No article content">
                                Open the original article to read it on the
                                publisher’s website.
                            </Alert>
                        ) : (
                            <div
                                ref={articleContent}
                                className={classes.articleContent}
                                // Content is sanitized before persistence by the Worker.
                                dangerouslySetInnerHTML={{
                                    __html: entry.contentHtml,
                                }}
                            />
                        )}
                    </Typography>
                </Box>
            </ScrollArea>
        </article>
    );
}

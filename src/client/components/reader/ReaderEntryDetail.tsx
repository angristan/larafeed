import {
    ActionIcon,
    Alert,
    Badge,
    Box,
    Button,
    Center,
    Flex,
    Group,
    Menu,
    Paper,
    ScrollArea,
    SegmentedControl,
    Skeleton,
    Space,
    Stack,
    Text,
    Title,
    Tooltip,
    Typography,
    useMantineTheme,
} from '@mantine/core';
import {
    IconArchive,
    IconArchiveOff,
    IconArrowLeft,
    IconBook,
    IconBrain,
    IconCircle,
    IconCircleFilled,
    IconExternalLink,
    IconFileText,
    IconFileTextFilled,
    IconRefresh,
    IconRobot,
    IconStar,
    IconStarFilled,
} from '@tabler/icons-react';
import {
    useMutation,
    useMutationState,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReaderEntry } from '../../api/reader';
import {
    entryFullContentQueryOptions,
    fetchEntryFullContentMutationOptions,
    fullContentKeys,
    summarizeEntryFullContentMutationOptions,
} from '../../queries/fullContent';
import { subscriptionManagementQueryOptions } from '../../queries/subscriptions';
import {
    entrySummaryQueryOptions,
    generateEntrySummaryMutationOptions,
} from '../../queries/summaries';
import { externalizeArticleLinks } from './articleHtml';
import { FeedFavicon } from './FeedFavicon';
import classes from './Reader.module.css';
import { FeedActions } from './ReaderSidebar';
import {
    estimateReadingTime,
    readingTimeLabel,
    textFromSanitizedHtml,
} from './readingTime';

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
    readonly summarize: boolean;
    readonly onRetry: () => void;
    readonly onBack: () => void;
    readonly onSetSummarize: (summarize: boolean) => void;
    readonly onSetRead: (read: boolean) => void;
    readonly onSetStarred: (starred: boolean) => void;
    readonly onSetArchived: (archived: boolean) => void;
}

const SINGLE_PANE_MEDIA_QUERY = '(max-width: 68.74em)';

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

function PaneSkeleton({ label }: { readonly label: string }) {
    return (
        <div
            aria-label={label}
            className={classes.articleContent}
            role="status"
        >
            <Skeleton height={8} radius="xl" width="95%" />
            <Skeleton height={8} mt={6} radius="xl" width="100%" />
            <Skeleton height={8} mt={6} radius="xl" width="89%" />
            <Skeleton height={8} mt={6} radius="xl" width="92%" />
            <Box mt={16} />
            <Skeleton height={8} radius="xl" width="97%" />
            <Skeleton height={8} mt={6} radius="xl" width="85%" />
            <Skeleton height={8} mb={20} mt={6} radius="xl" width="91%" />
        </div>
    );
}

function SummarySkeleton() {
    return <PaneSkeleton label="Loading summary" />;
}

function ReaderEntryFullContent({ entryId }: { readonly entryId: number }) {
    const queryClient = useQueryClient();
    const contentQuery = useQuery(entryFullContentQueryOptions(entryId));
    const fetchMutation = useMutation(
        fetchEntryFullContentMutationOptions(queryClient, entryId),
    );
    const fullContent = contentQuery.data?.fullContent ?? null;
    const fetchContent = fetchMutation.mutate;
    const fullHtml = useMemo(
        () =>
            fullContent === null
                ? null
                : externalizeArticleLinks(fullContent.html),
        [fullContent],
    );

    useEffect(() => {
        if (
            contentQuery.isSuccess &&
            fullContent === null &&
            fetchMutation.isIdle
        ) {
            fetchContent();
        }
    }, [
        fetchContent,
        fetchMutation.isIdle,
        fullContent,
        contentQuery.isSuccess,
    ]);

    if (contentQuery.error !== null) {
        return (
            <Alert color="red" title="Full article unavailable">
                <Stack gap="sm">
                    <Text size="sm">{contentQuery.error.message}</Text>
                    <Button
                        onClick={() => void contentQuery.refetch()}
                        size="xs"
                        variant="light"
                    >
                        Retry
                    </Button>
                </Stack>
            </Alert>
        );
    }

    if (fetchMutation.error !== null) {
        return (
            <Alert color="red" role="alert" title="Full article unavailable">
                <Stack gap="sm">
                    <Text size="sm">{fetchMutation.error.message}</Text>
                    <Text c="dimmed" size="sm">
                        You can still open the original article on the
                        publisher’s website.
                    </Text>
                    <Button
                        onClick={() => fetchMutation.mutate()}
                        size="xs"
                        variant="light"
                    >
                        Retry
                    </Button>
                </Stack>
            </Alert>
        );
    }

    if (fullContent === null || fetchMutation.isPending) {
        return <PaneSkeleton label="Loading full article" />;
    }

    return (
        <div
            className={classes.articleContent}
            // Full article HTML is sanitized by the Worker before storage.
            dangerouslySetInnerHTML={{ __html: fullHtml ?? '' }}
        />
    );
}

function ReaderEntryFullSummary({ entryId }: { readonly entryId: number }) {
    const queryClient = useQueryClient();
    const contentQuery = useQuery(entryFullContentQueryOptions(entryId));
    const summarizeMutation = useMutation(
        summarizeEntryFullContentMutationOptions(queryClient, entryId),
    );
    // The article pane owns fetching; observe its mutation to surface errors.
    const fetchStates = useMutationState({
        filters: { mutationKey: fullContentKeys.fetch(entryId) },
        select: (mutation) => ({
            status: mutation.state.status,
            error: mutation.state.error,
        }),
    });
    const latestFetch = fetchStates[fetchStates.length - 1];
    const fullContent = contentQuery.data?.fullContent ?? null;
    const summary = fullContent?.summary ?? null;
    const generate = summarizeMutation.mutate;
    const summaryHtml = useMemo(
        () => (summary === null ? null : externalizeArticleLinks(summary.html)),
        [summary],
    );

    useEffect(() => {
        if (
            fullContent !== null &&
            summary === null &&
            summarizeMutation.isIdle
        ) {
            generate();
        }
    }, [fullContent, generate, summary, summarizeMutation.isIdle]);

    if (contentQuery.error !== null) {
        return (
            <Alert color="red" title="Summary unavailable">
                <Stack gap="sm">
                    <Text size="sm">{contentQuery.error.message}</Text>
                    <Button
                        onClick={() => void contentQuery.refetch()}
                        size="xs"
                        variant="light"
                    >
                        Retry
                    </Button>
                </Stack>
            </Alert>
        );
    }

    if (fullContent === null && latestFetch?.status === 'error') {
        return (
            <Alert color="red" role="alert" title="Full article unavailable">
                <Text size="sm">
                    {latestFetch.error?.message ??
                        'Could not fetch the full article.'}{' '}
                    Switch to the article view to retry.
                </Text>
            </Alert>
        );
    }

    if (summarizeMutation.error !== null) {
        return (
            <Alert color="red" role="alert" title="Summary unavailable">
                <Stack gap="sm">
                    <Text size="sm">{summarizeMutation.error.message}</Text>
                    <Button
                        onClick={() => summarizeMutation.mutate()}
                        size="xs"
                        variant="light"
                    >
                        Retry
                    </Button>
                </Stack>
            </Alert>
        );
    }

    if (summary === null || summarizeMutation.isPending) {
        return <SummarySkeleton />;
    }

    return (
        <>
            <div
                className={classes.articleContent}
                // Summary HTML is sanitized by the Worker before storage.
                dangerouslySetInnerHTML={{ __html: summaryHtml ?? '' }}
            />
            <Space mt={20} />
        </>
    );
}

function ReaderEntrySummary({ entryId }: { readonly entryId: number }) {
    const queryClient = useQueryClient();
    const summaryQuery = useQuery(entrySummaryQueryOptions(entryId));
    const generateMutation = useMutation(
        generateEntrySummaryMutationOptions(queryClient, entryId),
    );
    const summary = summaryQuery.data?.summary ?? null;
    const generate = generateMutation.mutate;
    const summaryHtml = useMemo(
        () => (summary === null ? null : externalizeArticleLinks(summary.html)),
        [summary],
    );

    useEffect(() => {
        if (
            summaryQuery.isSuccess &&
            summary === null &&
            generateMutation.isIdle
        ) {
            generate();
        }
    }, [generate, generateMutation.isIdle, summary, summaryQuery.isSuccess]);

    if (summaryQuery.error !== null) {
        return (
            <Alert color="red" title="Summary unavailable">
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

    if (generateMutation.error !== null) {
        return (
            <Alert color="red" role="alert" title="Summary unavailable">
                <Stack gap="sm">
                    <Text size="sm">{generateMutation.error.message}</Text>
                    <Button
                        onClick={() => generateMutation.mutate()}
                        size="xs"
                        variant="light"
                    >
                        Retry
                    </Button>
                </Stack>
            </Alert>
        );
    }

    if (summary === null || generateMutation.isPending) {
        return <SummarySkeleton />;
    }

    return (
        <>
            <div
                className={classes.articleContent}
                // Summary HTML is sanitized by the Worker before persistence.
                dangerouslySetInnerHTML={{ __html: summaryHtml ?? '' }}
            />
            <Space mt={20} />
        </>
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
    summarize,
    onRetry,
    onBack,
    onSetSummarize,
    onSetRead,
    onSetStarred,
    onSetArchived,
}: ReaderEntryDetailProps) {
    const theme = useMantineTheme();
    const management = useQuery(subscriptionManagementQueryOptions);
    const managedSubscription = management.data?.subscriptions.find(
        (subscription) => subscription.feedId === entry?.feedId,
    );
    const detailHeading = useRef<HTMLHeadingElement>(null);
    const focusedEntry = useRef<number | null>(null);
    const viewport = useRef<HTMLDivElement>(null);
    const readingTime = useMemo(
        () =>
            entry?.contentHtml == null
                ? null
                : estimateReadingTime(textFromSanitizedHtml(entry.contentHtml)),
        [entry?.contentHtml],
    );
    const scrollToTop = useCallback(
        () => viewport.current?.scrollTo({ top: 0, behavior: 'instant' }),
        [],
    );
    const articleHtml = useMemo(
        () =>
            entry?.contentHtml == null
                ? null
                : externalizeArticleLinks(entry.contentHtml),
        [entry?.contentHtml],
    );

    const [fullArticle, setFullArticle] = useState(false);

    const entryId = entry?.id;
    useEffect(() => {
        if (entryId === undefined) return;
        setFullArticle(false);
        scrollToTop();
    }, [entryId, scrollToTop]);

    useEffect(() => {
        if (!selected) {
            focusedEntry.current = null;
            return;
        }
        if (
            entry === undefined ||
            focusedEntry.current === entry.id ||
            typeof window === 'undefined' ||
            !window.matchMedia(SINGLE_PANE_MEDIA_QUERY).matches
        ) {
            return;
        }

        const heading = detailHeading.current;
        if (heading !== null) {
            focusedEntry.current = entry.id;
            heading.focus();
        }
    }, [entry, selected]);

    if (!selected) {
        return (
            <section aria-label="Entry detail" className={classes.detailPane}>
                <Center className={classes.emptyDetail}>
                    <Stack align="center" gap="xs" ta="center">
                        <IconBook aria-hidden="true" size={28} stroke={1.4} />
                        <Text fw={650} size="sm">
                            Select an entry to read
                        </Text>
                        <Text c="dimmed" maw={300} size="xs">
                            Choose an article from the reading queue. You can
                            use J and K to move through entries.
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
                <Alert color="red" m="lg" title="Entry unavailable">
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
                                    <IconRefresh aria-hidden="true" size={15} />
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
            </section>
        );
    }

    if (entry === undefined) return null;

    const feedName = entry.customFeedName ?? entry.feedName;

    return (
        <Flex
            aria-busy={isFetching}
            className={classes.detailPane}
            direction="column"
            w="100%"
        >
            <div className={classes.detailToolbar}>
                <Flex
                    align="center"
                    className={classes.detailHeader}
                    direction="row"
                    justify="space-between"
                >
                    <Group
                        className={classes.sourceIdentity}
                        gap="xs"
                        wrap="nowrap"
                    >
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
                            size={18}
                            src={entry.faviconUrl}
                        />
                        <Text c="dimmed" lineClamp={1} size="xs">
                            {feedName}
                        </Text>
                        {entry !== undefined &&
                            managedSubscription !== undefined && (
                                <FeedActions
                                    categories={
                                        management.data?.categories ?? []
                                    }
                                    entrySection={
                                        <>
                                            <Menu.Label>Entry</Menu.Label>
                                            <Menu.Item
                                                disabled={archivePending}
                                                leftSection={
                                                    entry.archived ? (
                                                        <IconArchiveOff
                                                            size={14}
                                                        />
                                                    ) : (
                                                        <IconArchive
                                                            size={14}
                                                        />
                                                    )
                                                }
                                                onClick={() =>
                                                    onSetArchived(
                                                        !entry.archived,
                                                    )
                                                }
                                            >
                                                {entry.archived
                                                    ? 'Restore entry'
                                                    : 'Archive entry'}
                                            </Menu.Item>
                                            <Menu.Divider />
                                        </>
                                    }
                                    managed={managedSubscription}
                                    onUnsubscribed={onBack}
                                    subscription={{
                                        feedId: entry.feedId,
                                        categoryId:
                                            managedSubscription.categoryId,
                                        feedName: entry.feedName,
                                        customFeedName: entry.customFeedName,
                                        faviconUrl: entry.faviconUrl,
                                        faviconIsDark: entry.faviconIsDark,
                                        totalCount:
                                            managedSubscription.entryCount,
                                        unreadCount:
                                            managedSubscription.unreadCount,
                                    }}
                                />
                            )}
                    </Group>
                    <Group
                        className={classes.entryActions}
                        gap={6}
                        wrap="nowrap"
                    >
                        <SegmentedControl
                            aria-label="Entry view"
                            data={[
                                {
                                    label: (
                                        <Group gap={4} wrap="nowrap">
                                            <IconBook
                                                aria-label="Article content"
                                                size={14}
                                            />
                                            <span className={classes.viewLabel}>
                                                Article
                                            </span>
                                        </Group>
                                    ),
                                    value: 'content',
                                },
                                {
                                    label: (
                                        <Group gap={4} wrap="nowrap">
                                            <IconBrain
                                                aria-label="AI summary"
                                                size={14}
                                            />
                                            <span className={classes.viewLabel}>
                                                Summary
                                            </span>
                                        </Group>
                                    ),
                                    value: 'summary',
                                },
                            ]}
                            onChange={(value) =>
                                onSetSummarize(value === 'summary')
                            }
                            size="xs"
                            value={summarize ? 'summary' : 'content'}
                        />

                        {entry.url !== null && (
                            <Button
                                aria-label="Open original article in a new tab"
                                className={classes.originalAction}
                                component="a"
                                href={entry.url}
                                leftSection={
                                    <IconExternalLink size={14} stroke={1.8} />
                                }
                                rel="noopener noreferrer"
                                size="xs"
                                target="_blank"
                                variant="default"
                            >
                                <span className={classes.originalLabel}>
                                    Original
                                </span>
                            </Button>
                        )}

                        {entry.url !== null && (
                            <Tooltip
                                label={
                                    fullArticle
                                        ? 'Show the feed version'
                                        : 'Fetch the full article'
                                }
                            >
                                <ActionIcon
                                    aria-label={
                                        fullArticle
                                            ? 'Show the feed version'
                                            : 'Fetch the full article'
                                    }
                                    aria-pressed={fullArticle}
                                    className={classes.fullToggle}
                                    color="gray"
                                    onClick={() =>
                                        setFullArticle((value) => !value)
                                    }
                                    variant="subtle"
                                >
                                    {fullArticle ? (
                                        <IconFileTextFilled size={15} />
                                    ) : (
                                        <IconFileText size={15} stroke={2} />
                                    )}
                                </ActionIcon>
                            </Tooltip>
                        )}

                        <Tooltip
                            label={
                                entry.starred
                                    ? 'Remove from favorites'
                                    : 'Add to favorites'
                            }
                        >
                            <ActionIcon
                                aria-label={
                                    entry.starred
                                        ? 'Remove entry from favorites'
                                        : 'Add entry to favorites'
                                }
                                aria-pressed={entry.starred}
                                color="gray"
                                loading={starPending}
                                onClick={() => onSetStarred(!entry.starred)}
                                variant="subtle"
                            >
                                {entry.starred ? (
                                    <IconStarFilled size={15} stroke={3} />
                                ) : (
                                    <IconStar size={15} stroke={3} />
                                )}
                            </ActionIcon>
                        </Tooltip>

                        <Tooltip
                            label={
                                entry.read ? 'Mark as unread' : 'Mark as read'
                            }
                        >
                            <ActionIcon
                                aria-label={
                                    entry.read
                                        ? 'Mark entry as unread'
                                        : 'Mark entry as read'
                                }
                                aria-pressed={entry.read}
                                color="gray"
                                loading={readPending}
                                onClick={() => onSetRead(!entry.read)}
                                variant="subtle"
                            >
                                {entry.read ? (
                                    <IconCircle size={15} stroke={3} />
                                ) : (
                                    <IconCircleFilled size={15} stroke={3} />
                                )}
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                </Flex>
            </div>

            <ScrollArea
                className={classes.detailScroll}
                classNames={{
                    scrollbar: classes.readerScrollbar,
                    thumb: classes.readerScrollbarThumb,
                }}
                viewportRef={viewport}
            >
                <Box className={classes.articleScrollContent} pl={20} pr={20}>
                    {mutationError !== null && (
                        <Alert color="red" mb="sm" role="alert">
                            {mutationError.message}
                        </Alert>
                    )}
                    <Typography className={classes.articleTypography}>
                        <Title
                            ref={detailHeading}
                            className={classes.entryTitle}
                            tabIndex={-1}
                        >
                            {entry.title || 'Untitled entry'}
                        </Title>
                        <Text c="dimmed" size="sm">
                            {entry.author ? `${entry.author} • ` : ''}
                            {formatRelativeTime(entry.publishedAt)}
                            {readingTime !== null && (
                                <span title="Estimated reading time at 300 words per minute">
                                    {` • ${readingTimeLabel(readingTime)}`}
                                </span>
                            )}
                        </Text>

                        <div hidden={summarize}>
                            {fullArticle && entry.url !== null ? (
                                <ReaderEntryFullContent entryId={entry.id} />
                            ) : entry.contentHtml === null ||
                              entry.contentHtml.trim().length === 0 ? (
                                <Alert color="gray" title="No article content">
                                    <Stack align="flex-start" gap="sm">
                                        <Text size="sm">
                                            Open the original article to read it
                                            on the publisher’s website.
                                        </Text>
                                        {entry.url !== null && (
                                            <Button
                                                leftSection={
                                                    <IconFileText
                                                        size={15}
                                                        stroke={2}
                                                    />
                                                }
                                                onClick={() =>
                                                    setFullArticle(true)
                                                }
                                                size="xs"
                                                variant="light"
                                            >
                                                Fetch full article
                                            </Button>
                                        )}
                                    </Stack>
                                </Alert>
                            ) : (
                                <div
                                    className={classes.articleContent}
                                    // Content is sanitized before persistence by the Worker.
                                    dangerouslySetInnerHTML={{
                                        __html: articleHtml ?? '',
                                    }}
                                />
                            )}
                        </div>
                        <Paper
                            className={classes.entrySummary}
                            hidden={!summarize}
                            pb={0}
                            style={{
                                display: summarize ? undefined : 'none',
                            }}
                            p="md"
                            shadow="xs"
                            withBorder
                        >
                            <Flex align="center" gap="xs" mb="sm">
                                <IconRobot
                                    color={theme.colors.blue[5]}
                                    size={16}
                                />
                                <Tooltip
                                    label="Generated with Workers AI"
                                    position="right"
                                >
                                    <Badge
                                        color="blue"
                                        size="sm"
                                        variant="light"
                                    >
                                        AI Summary
                                    </Badge>
                                </Tooltip>
                            </Flex>
                            {summarize &&
                                (fullArticle && entry.url !== null ? (
                                    <ReaderEntryFullSummary
                                        entryId={entry.id}
                                    />
                                ) : (
                                    <ReaderEntrySummary entryId={entry.id} />
                                ))}
                        </Paper>
                    </Typography>
                </Box>
            </ScrollArea>
        </Flex>
    );
}

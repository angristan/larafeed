import {
    ActionIcon,
    Alert,
    Badge,
    Box,
    Button,
    Center,
    Divider,
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
    IconDots,
    IconExternalLink,
    IconRefresh,
    IconRobot,
    IconStar,
    IconStarFilled,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { ReaderEntry } from '../../api/reader';
import { subscriptionManagementQueryOptions } from '../../queries/subscriptions';
import {
    entrySummaryQueryOptions,
    generateEntrySummaryMutationOptions,
} from '../../queries/summaries';
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

function SummarySkeleton() {
    return (
        <div
            aria-label="Loading summary"
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

function ReaderEntrySummary({ entryId }: { readonly entryId: number }) {
    const queryClient = useQueryClient();
    const summaryQuery = useQuery(entrySummaryQueryOptions(entryId));
    const generateMutation = useMutation(
        generateEntrySummaryMutationOptions(queryClient, entryId),
    );
    const summary = summaryQuery.data?.summary ?? null;
    const generate = generateMutation.mutate;

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
                dangerouslySetInnerHTML={{ __html: summary.html }}
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
    const articleContent = useRef<HTMLDivElement>(null);
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

    useEffect(() => {
        if (entry === undefined) return;
        scrollToTop();
        const content = articleContent.current;
        if (content === null) return;
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
    }, [entry, scrollToTop]);

    useEffect(() => {
        if (!selected) {
            focusedEntry.current = null;
            return;
        }
        if (
            entry === undefined ||
            focusedEntry.current === entry.id ||
            typeof window === 'undefined' ||
            !window.matchMedia('(max-width: 47.99em)').matches
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

                        <Menu shadow="md">
                            <Menu.Target>
                                <ActionIcon
                                    aria-label="Archive entry"
                                    color="gray"
                                    variant="subtle"
                                >
                                    <IconDots size={15} stroke={1.5} />
                                </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Label>Manage entry</Menu.Label>
                                <Menu.Item
                                    leftSection={
                                        entry.archived ? (
                                            <IconArchiveOff size={14} />
                                        ) : (
                                            <IconArchive size={14} />
                                        )
                                    }
                                    disabled={archivePending}
                                    onClick={() =>
                                        onSetArchived(!entry.archived)
                                    }
                                >
                                    {entry.archived
                                        ? 'Restore entry'
                                        : 'Archive entry'}
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    </Group>
                </Flex>
            </div>

            {mutationError !== null && (
                <Alert color="red" m="sm" role="alert">
                    {mutationError.message}
                </Alert>
            )}

            <Divider mb={20} />
            <ScrollArea style={{ height: '100%' }} viewportRef={viewport}>
                <Box pl={20} pr={20}>
                    <Typography className={classes.articleTypography}>
                        <Title
                            ref={detailHeading}
                            className={classes.entryTitle}
                            tabIndex={-1}
                        >
                            {entry.title || 'Untitled entry'}
                        </Title>
                        <Flex justify="space-between">
                            <Text
                                aria-label="Estimated reading time at 300 words per minute"
                                c="dimmed"
                                size="sm"
                            >
                                {readingTime === null
                                    ? ''
                                    : readingTimeLabel(readingTime)}
                            </Text>
                            <Text c="dimmed" size="sm">
                                {entry.author ? `${entry.author} • ` : ''}
                                {formatRelativeTime(entry.publishedAt)}
                            </Text>
                        </Flex>

                        <div hidden={summarize}>
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
                                    label="Generated with Google Gemini"
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
                            {summarize && (
                                <ReaderEntrySummary entryId={entry.id} />
                            )}
                        </Paper>
                    </Typography>
                </Box>
            </ScrollArea>
        </Flex>
    );
}

import {
    ActionIcon,
    Alert,
    Badge,
    Box,
    Button,
    Card,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReaderEntry } from '../../api/reader';
import { subscriptionManagementQueryOptions } from '../../queries/subscriptions';
import {
    entrySummaryQueryOptions,
    generateEntrySummaryMutationOptions,
} from '../../queries/summaries';
import { FeedFavicon } from './FeedFavicon';
import classes from './Reader.module.css';
import { FeedActions } from './ReaderSidebar';
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

    if (summaryQuery.isPending || generateMutation.isPending) {
        return <SummarySkeleton />;
    }

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

    if (summary === null) {
        return (
            <Stack align="flex-start" gap="sm">
                <Text c="dimmed" size="sm">
                    Generate a concise AI summary of this article.
                </Text>
                {generateMutation.error !== null && (
                    <Alert color="red" role="alert">
                        {generateMutation.error.message}
                    </Alert>
                )}
                <Button
                    loading={generateMutation.isPending}
                    onClick={() => generateMutation.mutate()}
                    size="xs"
                    variant="light"
                >
                    Generate summary
                </Button>
            </Stack>
        );
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
    onRetry,
    onBack,
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
    const viewport = useRef<HTMLDivElement>(null);
    const [view, setView] = useState<'content' | 'summary'>('content');
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

    if (!selected) {
        return (
            <section aria-label="Entry detail" className={classes.detailPane} />
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
            <Card bg="transparent" pb={10} pl={10} pr={10} pt={0}>
                <Flex align="center" direction="row" justify="space-between">
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
                        size={20}
                        src={entry.faviconUrl}
                    />
                    <Group gap={6} wrap="nowrap">
                        <Text c="dimmed" size="sm">
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
                    <Group>
                        <Tooltip
                            label="Summarize content with AI or switch back to content"
                            openDelay={500}
                            transitionProps={{
                                transition: 'fade',
                                duration: 300,
                            }}
                        >
                            <SegmentedControl
                                aria-label="Entry view"
                                data={[
                                    {
                                        label: (
                                            <IconBook
                                                aria-label="Article content"
                                                size={16}
                                                style={{ marginBottom: -3 }}
                                            />
                                        ),
                                        value: 'content',
                                    },
                                    {
                                        label: (
                                            <IconBrain
                                                aria-label="AI summary"
                                                size={15}
                                                style={{ marginBottom: -3 }}
                                            />
                                        ),
                                        value: 'summary',
                                    },
                                ]}
                                onChange={(value) =>
                                    setView(value as 'content' | 'summary')
                                }
                                size="xs"
                                styles={{
                                    label: {
                                        paddingInline: '10px',
                                        paddingBlock: '3px',
                                    },
                                }}
                                value={view}
                            />
                        </Tooltip>

                        {entry.url !== null && (
                            <Tooltip
                                label="Open in a new tab"
                                transitionProps={{
                                    transition: 'fade',
                                    duration: 300,
                                }}
                            >
                                <ActionIcon
                                    aria-label="Open original article in a new tab"
                                    color="gray"
                                    component="a"
                                    href={entry.url}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                    variant="outline"
                                >
                                    <IconExternalLink size={15} stroke={3} />
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
                                variant="outline"
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
                                variant="outline"
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
                                    variant="outline"
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
            </Card>

            {mutationError !== null && (
                <Alert color="red" m="sm" role="alert">
                    {mutationError.message}
                </Alert>
            )}

            <Divider mb={20} />
            <ScrollArea style={{ height: '100%' }} viewportRef={viewport}>
                <Box pl={20} pr={20}>
                    <Typography className={classes.articleTypography}>
                        <Title className={classes.entryTitle}>
                            {entry.title || 'Untitled entry'}
                        </Title>
                        <Flex justify="space-between">
                            <Text
                                aria-label="Estimated reading time at 300 words per minute"
                                c="dimmed"
                                size="sm"
                            >
                                {readingTime === null || readingTime.words === 0
                                    ? ''
                                    : `${readingTime.minutes} min read`}
                            </Text>
                            <Text c="dimmed" size="sm">
                                {entry.author ? `${entry.author} • ` : ''}
                                {formatRelativeTime(entry.publishedAt)}
                            </Text>
                        </Flex>

                        <div hidden={view !== 'content'}>
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
                            hidden={view !== 'summary'}
                            pb={0}
                            style={{
                                display:
                                    view === 'summary' ? undefined : 'none',
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
                            <ReaderEntrySummary entryId={entry.id} />
                        </Paper>
                    </Typography>
                </Box>
            </ScrollArea>
        </Flex>
    );
}

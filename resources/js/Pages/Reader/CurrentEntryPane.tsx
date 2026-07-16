import { router } from '@inertiajs/react';
import {
    ActionIcon,
    Alert,
    Badge,
    Box,
    Button,
    Divider,
    Flex,
    Group,
    Paper,
    ScrollArea,
    SegmentedControl,
    Skeleton,
    Stack,
    Text,
    Title,
    Tooltip,
    Typography,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconArrowLeft,
    IconBook,
    IconBrain,
    IconCircle,
    IconCircleFilled,
    IconExternalLink,
    IconRobot,
    IconStar,
    IconStarFilled,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FaviconImage } from '@/Components/FaviconImage/FaviconImage';
import { FeedMenu } from '@/Components/FeedMenu';
import classes from './CurrentEntryPane.module.css';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export default function CurrentEntryPane({
    currententry,
    summary,
    feeds,
    categories,
    onBack,
}: {
    currententry: CurrentEntry;
    summary?: string;
    feeds: Feed[];
    categories: Category[];
    onBack?: () => void;
}) {
    const viewport = useRef<HTMLDivElement>(null);
    const scrollToTop = useCallback(
        () => viewport.current?.scrollTo({ top: 0, behavior: 'instant' }),
        [],
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on entry change
    useEffect(() => {
        scrollToTop();
    }, [currententry.id, scrollToTop]);

    // Find the current feed from the feeds array
    const currentFeed = feeds.find((feed) => feed.id === currententry.feed.id);

    const [favoritePending, setFavoritePending] = useState(false);
    const [readPending, setReadPending] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);

    const updateFavorite = () => {
        if (favoritePending) {
            return;
        }

        setFavoritePending(true);
        router.patch(
            route('entry.update', currententry.id),
            {
                starred: !currententry.starred_at,
            },
            {
                preserveScroll: true,
                preserveState: true,
                only: ['currententry', 'entries'],
                onSuccess: () => {
                    if (currententry.starred_at) {
                        notifications.show({
                            title: 'Removed from favorites',
                            message: 'Entry removed from favorites',
                            color: 'blue',
                            withBorder: true,
                        });
                    } else {
                        notifications.show({
                            title: 'Starred!',
                            message: 'Entry added to favorites',
                            color: 'blue',
                            withBorder: true,
                        });
                    }
                },
                onError: (error) => {
                    notifications.show({
                        title: 'Failed to star entry',
                        message: error.message,
                        color: 'red',
                        withBorder: true,
                    });
                },
                onFinish: () => setFavoritePending(false),
            },
        );
    };

    const updateRead = () => {
        if (readPending) {
            return;
        }

        setReadPending(true);
        const urlParams = new URLSearchParams(window.location.search);

        if (currententry.read_at) {
            urlParams.set('read', 'false');
        } else {
            urlParams.set('read', 'true');
        }

        router.visit(route('feeds.index'), {
            data: {
                ...Object.fromEntries(urlParams),
            },
            preserveScroll: true,
            preserveState: true,
            only: [
                'currententry',
                'entries',
                'unreadEntriesCount',
                'readEntriesCount',
            ],
            onSuccess: () => {
                if (currententry.read_at) {
                    notifications.show({
                        title: 'Marked as unread',
                        message: 'Entry marked as unread',
                        color: 'blue',
                        withBorder: true,
                    });
                } else {
                    notifications.show({
                        title: 'Marked as read',
                        message: 'Entry marked as read',
                        color: 'blue',
                        withBorder: true,
                    });
                }
            },
            onError: (error) => {
                notifications.show({
                    title: 'Failed to mark entry as read',
                    message: error.message,
                    color: 'red',
                    withBorder: true,
                });
            },
            onFinish: () => setReadPending(false),
        });
    };

    const [value, setValue] = useState(summary ? 'summary' : 'content');

    const requestSummary = useCallback(() => {
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.set('summarize', 'true');
        setSummaryError(null);

        router.visit(route('feeds.index'), {
            only: ['summary'],
            data: Object.fromEntries(urlParams),
            preserveScroll: true,
            preserveState: true,
            onError: () => {
                setSummaryError(
                    'The summary could not be generated. Please try again.',
                );
            },
            onHttpException: () => {
                setSummaryError(
                    'The summary could not be generated. Please try again.',
                );
                return false;
            },
            onNetworkError: () => {
                setSummaryError(
                    'Larafeed could not reach the server. Check your connection and try again.',
                );
                return false;
            },
        });
    }, []);

    useEffect(() => {
        if (
            value === 'summary' &&
            !window.location.search.includes('summarize')
        ) {
            requestSummary();
        }
        if (
            value === 'content' &&
            window.location.search.includes('summarize')
        ) {
            const urlParams = new URLSearchParams(window.location.search);
            urlParams.delete('summarize');
            setSummaryError(null);

            router.visit(route('feeds.index'), {
                only: ['summary'],
                data: Object.fromEntries(urlParams),
                preserveScroll: true,
                preserveState: true,
            });
        }
    }, [requestSummary, value]);

    const typographyProviderRef = useRef<HTMLDivElement>(null);

    // Update entry content anchor targets to open in a new tab
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on entry change
    useEffect(() => {
        const element = typographyProviderRef.current;
        if (!element) {
            return;
        }

        const anchors = element.querySelectorAll<HTMLAnchorElement>('a[href]');
        for (const anchor of anchors) {
            anchor.setAttribute('target', '_blank');

            const relTokens = new Set(
                (anchor.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean),
            );
            relTokens.add('noopener');
            relTokens.add('noreferrer');
            anchor.setAttribute('rel', Array.from(relTokens).join(' '));
        }
    }, [currententry.id]);

    return (
        <Flex direction="column" w="100%" className={classes.pane}>
            <header className={classes.toolbar}>
                <Group gap="sm" wrap="nowrap" className={classes.feedIdentity}>
                    {onBack && (
                        <Button
                            variant="subtle"
                            size="xs"
                            leftSection={<IconArrowLeft size={16} />}
                            onClick={onBack}
                        >
                            Entries
                        </Button>
                    )}
                    <FaviconImage
                        src={currententry.feed.favicon_url}
                        isDark={currententry.feed.favicon_is_dark}
                        w={20}
                        h={20}
                    />
                    <Text size="sm" fw={600} truncate>
                        {currententry.feed.name}
                    </Text>
                </Group>

                <Group gap={6} wrap="nowrap" className={classes.toolbarActions}>
                    <Tooltip
                        label="Switch between the article and its AI summary"
                        openDelay={500}
                    >
                        <SegmentedControl
                            value={value}
                            onChange={setValue}
                            size="xs"
                            aria-label="Entry view"
                            data={[
                                {
                                    label: (
                                        <Group gap={5} wrap="nowrap">
                                            <IconBook size={15} />
                                            <span>Article</span>
                                        </Group>
                                    ),
                                    value: 'content',
                                },
                                {
                                    label: (
                                        <Group gap={5} wrap="nowrap">
                                            <IconBrain size={15} />
                                            <span>Summary</span>
                                        </Group>
                                    ),
                                    value: 'summary',
                                },
                            ]}
                        />
                    </Tooltip>

                    <Tooltip label="Open original article" withArrow>
                        <ActionIcon
                            component="a"
                            href={currententry.url}
                            target="_blank"
                            rel="noreferrer"
                            variant="subtle"
                            color="gray"
                            size="lg"
                            aria-label="Open original article in a new tab"
                        >
                            <IconExternalLink size={17} stroke={1.8} />
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip
                        label={
                            currententry.starred_at
                                ? 'Remove from favorites'
                                : 'Add to favorites'
                        }
                        withArrow
                    >
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={updateFavorite}
                            loading={favoritePending}
                            loaderProps={{ type: 'dots' }}
                            aria-label={
                                currententry.starred_at
                                    ? 'Remove from favorites'
                                    : 'Add to favorites'
                            }
                            aria-pressed={Boolean(currententry.starred_at)}
                        >
                            {currententry.starred_at ? (
                                <IconStarFilled size={17} stroke={1.8} />
                            ) : (
                                <IconStar size={17} stroke={1.8} />
                            )}
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip
                        label={
                            currententry.read_at
                                ? 'Mark as unread'
                                : 'Mark as read'
                        }
                        withArrow
                    >
                        <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            onClick={updateRead}
                            loading={readPending}
                            loaderProps={{ type: 'dots' }}
                            aria-label={
                                currententry.read_at
                                    ? 'Mark as unread'
                                    : 'Mark as read'
                            }
                            aria-pressed={Boolean(currententry.read_at)}
                        >
                            {currententry.read_at ? (
                                <IconCircle size={17} stroke={1.8} />
                            ) : (
                                <IconCircleFilled size={17} stroke={1.8} />
                            )}
                        </ActionIcon>
                    </Tooltip>
                    {currentFeed && (
                        <FeedMenu
                            feed={currentFeed}
                            categories={categories}
                            variant="subtle"
                            size="lg"
                        />
                    )}
                </Group>
            </header>
            <Divider />
            <ScrollArea
                className={classes.articleScroll}
                viewportRef={viewport}
                type="auto"
            >
                <Box
                    component="article"
                    className={classes.articleShell}
                    aria-labelledby={`entry-title-${currententry.id}`}
                >
                    <Typography className={classes.entry}>
                        <Title
                            id={`entry-title-${currententry.id}`}
                            order={1}
                            className={classes.entryTitle}
                        >
                            {currententry.title}
                        </Title>
                        <Group
                            justify="space-between"
                            align="center"
                            gap="xs"
                            className={classes.entryMeta}
                        >
                            <Text size="sm" c="dimmed">
                                {currententry.reading_time_text}
                            </Text>
                            <Text size="sm" c="dimmed" ta="right">
                                {currententry.author
                                    ? `${currententry.author} • `
                                    : ''}
                                {dayjs.utc(currententry.published_at).fromNow()}
                            </Text>
                        </Group>
                        {value === 'content' ? (
                            currententry.content ? (
                                <div
                                    ref={typographyProviderRef}
                                    className={classes.entryContent}
                                    dangerouslySetInnerHTML={{
                                        __html: currententry.content,
                                    }}
                                />
                            ) : (
                                <Paper
                                    withBorder
                                    p="xl"
                                    className={classes.emptyContent}
                                >
                                    <Stack align="center" gap="sm">
                                        <Text fw={700}>
                                            This feed did not include article
                                            content.
                                        </Text>
                                        <Text size="sm" c="dimmed" ta="center">
                                            Open the original article to
                                            continue reading on the
                                            publisher&apos;s site.
                                        </Text>
                                        <Button
                                            component="a"
                                            href={currententry.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            variant="light"
                                            size="sm"
                                            rightSection={
                                                <IconExternalLink size={15} />
                                            }
                                        >
                                            Open original article
                                        </Button>
                                    </Stack>
                                </Paper>
                            )
                        ) : (
                            <Paper
                                p="lg"
                                withBorder
                                className={classes.entrySummary}
                                role="region"
                                aria-label="AI summary"
                            >
                                <Flex align="center" gap="xs" mb="sm">
                                    <IconRobot
                                        size={18}
                                        className={classes.summaryIcon}
                                    />
                                    <Tooltip
                                        label="Generated with Google Gemini"
                                        position="right"
                                    >
                                        <Badge
                                            size="sm"
                                            variant="light"
                                            color="blue"
                                        >
                                            AI Summary
                                        </Badge>
                                    </Tooltip>
                                </Flex>
                                {summaryError ? (
                                    <Alert
                                        color="red"
                                        variant="light"
                                        icon={<IconAlertCircle size={18} />}
                                        title="Summary unavailable"
                                    >
                                        <Stack gap="sm">
                                            <Text size="sm">
                                                {summaryError}
                                            </Text>
                                            <Button
                                                variant="light"
                                                color="red"
                                                size="xs"
                                                onClick={requestSummary}
                                                className={classes.retryButton}
                                            >
                                                Try again
                                            </Button>
                                        </Stack>
                                    </Alert>
                                ) : summary ? (
                                    <div
                                        className={classes.entryContent}
                                        dangerouslySetInnerHTML={{
                                            __html: summary,
                                        }}
                                    />
                                ) : (
                                    <div
                                        className={classes.summaryLoading}
                                        aria-live="polite"
                                        aria-busy="true"
                                    >
                                        <Text size="sm" c="dimmed" mb="sm">
                                            Generating a concise summary…
                                        </Text>
                                        <Skeleton
                                            height={8}
                                            width="95%"
                                            radius="xl"
                                        />
                                        <Skeleton
                                            height={8}
                                            mt={6}
                                            width="100%"
                                            radius="xl"
                                        />
                                        <Skeleton
                                            height={8}
                                            mt={6}
                                            width="89%"
                                            radius="xl"
                                        />
                                        <Skeleton
                                            height={8}
                                            mt={6}
                                            width="92%"
                                            radius="xl"
                                        />
                                        <Box mt={16} />
                                        <Skeleton
                                            height={8}
                                            width="97%"
                                            radius="xl"
                                        />
                                        <Skeleton
                                            height={8}
                                            mt={6}
                                            width="85%"
                                            radius="xl"
                                        />
                                        <Skeleton
                                            height={8}
                                            mt={6}
                                            width="91%"
                                            radius="xl"
                                            mb={20}
                                        />
                                    </div>
                                )}
                            </Paper>
                        )}
                    </Typography>
                </Box>
            </ScrollArea>
        </Flex>
    );
}

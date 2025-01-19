import classes from './CurrentEntryPane.module.css';

import { router } from '@inertiajs/react';
import {
    ActionIcon,
    Badge,
    Box,
    Card,
    Divider,
    Flex,
    Group,
    Image,
    Paper,
    ScrollArea,
    SegmentedControl,
    Skeleton,
    Space,
    Text,
    Title,
    Tooltip,
    TypographyStylesProvider,
    useMantineTheme,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
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
import { useEffect, useRef, useState } from 'react';
import { readingTime } from 'reading-time-estimator';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export default function CurrentEntryPane({
    currententry,
    summary,
}: {
    currententry: Entry;
    summary?: string;
}) {
    const theme = useMantineTheme();

    const viewport = useRef<HTMLDivElement>(null);
    const scrollToTop = () =>
        viewport.current?.scrollTo({ top: 0, behavior: 'instant' });

    useEffect(() => {
        scrollToTop();
    }, [currententry.id]);

    const updateFavorite = () => {
        router.patch(
            route('entry.update', currententry.id),
            {
                starred: currententry.starred_at ? false : true,
            },
            {
                preserveScroll: true,
                preserveState: true,
                only: ['currententry', 'entries'],
                onSuccess: () => {
                    if (currententry.starred_at) {
                        notifications.show({
                            title: 'Not that good...',
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
            },
        );
    };

    const updateRead = () => {
        const urlParams = new URLSearchParams(window.location.search);

        if (currententry.read_at) {
            urlParams.set('read', 'false');
        } else {
            urlParams.set('read', 'true');
        }

        router.visit('feeds', {
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
        });
    };

    const [value, setValue] = useState(summary ? 'summary' : 'content');

    useEffect(() => {
        if (summary) {
            setValue('summary');
        } else {
            setValue('content');
        }
    }, [summary]);

    useEffect(() => {
        if (
            value === 'summary' &&
            !window.location.search.includes('summarize')
        ) {
            const urlParams = new URLSearchParams(window.location.search);
            urlParams.set('summarize', 'true');

            router.visit('feeds', {
                only: ['summary'],
                data: {
                    ...Object.fromEntries(urlParams),
                },
                preserveScroll: true,
                preserveState: true,
            });
        }
        if (
            value === 'content' &&
            window.location.search.includes('summarize')
        ) {
            const urlParams = new URLSearchParams(window.location.search);
            urlParams.delete('summarize');

            router.visit('feeds', {
                only: ['summary'],
                data: {
                    ...Object.fromEntries(urlParams),
                },
                preserveScroll: true,
                preserveState: true,
            });
        }
    }, [value]);

    const typographyProviderRef = useRef<HTMLDivElement>(null);

    // Update entry content anchor targets to open in a new tab
    useEffect(() => {
        const updateAnchorsTarget = () => {
            try {
                const element = typographyProviderRef.current;
                if (!element) return;

                const parser = new DOMParser();
                const htmlText = element.innerHTML;
                const content = parser.parseFromString(htmlText, 'text/html');
                const anchors = content.getElementsByTagName('a');

                Array.from(anchors).forEach((a) => {
                    a.setAttribute('target', '_blank');
                });

                element.innerHTML = content.body.innerHTML;
            } catch (error) {
                console.error('Error updating anchor targets:', error);
            }
        };

        updateAnchorsTarget();
    }, [currententry]);

    return (
        <Flex direction="column" w="100%">
            <Card pb={10} pt={10} pl={10} pr={10}>
                <Flex direction="row" justify="space-between">
                    <Image
                        src={currententry.feed.favicon_url}
                        w={20}
                        h={20}
                        mr={9}
                    />

                    <Text size="sm" c="dimmed">
                        {currententry.feed.name}
                    </Text>
                    <Group>
                        <Tooltip
                            label={
                                'Summarize conent with AI or switch back to content'
                            }
                            openDelay={500}
                            transitionProps={{
                                transition: 'fade',
                                duration: 300,
                            }}
                        >
                            <SegmentedControl
                                value={value}
                                onChange={setValue}
                                size="xs"
                                styles={{
                                    label: {
                                        paddingInline: '10px',
                                        paddingBlock: '3px',
                                    },
                                }}
                                data={[
                                    {
                                        label: (
                                            <IconBook
                                                size={16}
                                                style={{ marginBottom: -3 }}
                                            />
                                        ),
                                        value: 'content',
                                    },
                                    {
                                        label: (
                                            <IconBrain
                                                size={15}
                                                style={{ marginBottom: -3 }}
                                            />
                                        ),
                                        value: 'summary',
                                    },
                                ]}
                            />
                        </Tooltip>
                        <Tooltip
                            label={'Open in a new tab'}
                            transitionProps={{
                                transition: 'fade',
                                duration: 300,
                            }}
                        >
                            <ActionIcon
                                variant="outline"
                                color="gray"
                                onClick={() => {
                                    window.open(currententry.url, '_blank');
                                }}
                            >
                                <IconExternalLink size={15} stroke={3} />
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip
                            label={
                                currententry.starred_at
                                    ? 'Remove from favorites'
                                    : 'Add to favorites'
                            }
                            transitionProps={{
                                transition: 'fade',
                                duration: 300,
                            }}
                        >
                            <ActionIcon
                                variant="outline"
                                color="gray"
                                onClick={updateFavorite}
                                loaderProps={{ type: 'dots' }}
                            >
                                {currententry.starred_at ? (
                                    <IconStarFilled size={15} stroke={3} />
                                ) : (
                                    <IconStar size={15} stroke={3} />
                                )}
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip
                            label={
                                currententry.read_at
                                    ? 'Mark as unread'
                                    : 'Mark as read'
                            }
                            transitionProps={{
                                transition: 'fade',
                                duration: 300,
                            }}
                        >
                            <ActionIcon
                                variant="outline"
                                color="gray"
                                onClick={updateRead}
                                loaderProps={{ type: 'dots' }}
                            >
                                {currententry.read_at ? (
                                    <IconCircle size={15} stroke={3} />
                                ) : (
                                    <IconCircleFilled size={15} stroke={3} />
                                )}
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                </Flex>
            </Card>
            <Divider mb={20} />
            <ScrollArea style={{ height: '100%' }} viewportRef={viewport}>
                <Box pr={20} pl={20}>
                    <TypographyStylesProvider className={classes.entry}>
                        <Title className={classes.entryTitle}>
                            {currententry.title}
                        </Title>
                        <Flex justify={'space-between'}>
                            <Text size="sm" c="dimmed">
                                {readingTime(currententry.content ?? '').text}
                            </Text>
                            <Flex>
                                <Text size="sm" c="dimmed">
                                    {currententry.author
                                        ? currententry.author + ' • '
                                        : ''}
                                    {dayjs
                                        .utc(currententry.published_at)
                                        .fromNow()}
                                </Text>
                            </Flex>
                        </Flex>
                        {value === 'content' ? (
                            <div
                                ref={typographyProviderRef}
                                className={classes.entryContent}
                                dangerouslySetInnerHTML={{
                                    __html: currententry.content || '',
                                }}
                            />
                        ) : (
                            <Paper
                                shadow="xs"
                                p="md"
                                withBorder
                                pb={0}
                                className={classes.entrySummary}
                            >
                                <Flex align="center" gap="xs" mb="sm">
                                    <IconRobot
                                        size={16}
                                        color={theme.colors.blue[5]}
                                    />
                                    <Tooltip
                                        label="Generated with Google's Gemini 1.5 Flash"
                                        position="right"
                                        transitionProps={{
                                            transition: 'fade',
                                            duration: 300,
                                        }}
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
                                {summary ? (
                                    <>
                                        <div
                                            className={classes.entryContent}
                                            dangerouslySetInnerHTML={{
                                                __html: summary,
                                            }}
                                        />
                                        <Space mt={20} />
                                    </>
                                ) : (
                                    <div className={classes.entryContent}>
                                        {/* First paragraph */}
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

                                        {/* Paragraph break */}
                                        <Box mt={16} />

                                        {/* Second paragraph */}
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
                    </TypographyStylesProvider>
                </Box>
            </ScrollArea>
        </Flex>
    );
}

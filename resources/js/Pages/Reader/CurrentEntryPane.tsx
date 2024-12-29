import classes from './CurrentEntryPane.module.css';

import { router } from '@inertiajs/react';
import {
    ActionIcon,
    Box,
    Button,
    Card,
    Divider,
    Flex,
    Group,
    Image,
    Menu,
    Modal,
    ScrollArea,
    SegmentedControl,
    Skeleton,
    Text,
    Title,
    Tooltip,
    TypographyStylesProvider,
    rem,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconAdjustments,
    IconBook,
    IconBrain,
    IconCircle,
    IconCircleFilled,
    IconExternalLink,
    IconStar,
    IconStarFilled,
    IconTrash,
} from '@tabler/icons-react';
import axios from 'axios';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { useEffect, useRef, useState } from 'react';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export default function CurrentEntryPane({
    currententry,
    summary,
}: {
    currententry: Entry;
    summary?: string;
}) {
    const viewport = useRef<HTMLDivElement>(null);
    const scrollToTop = () =>
        viewport.current!.scrollTo({ top: 0, behavior: 'instant' });

    useEffect(() => {
        scrollToTop();
    }, [currententry]);

    const [favoriteLoading, setFavoriteLoading] = useState(false);
    const [showLoading, setShowLoading] = useState(false);
    const loadingTimeout = useRef<NodeJS.Timeout>();

    // Show loading indicator only after 1s
    useEffect(() => {
        if (favoriteLoading) {
            loadingTimeout.current = setTimeout(() => {
                setShowLoading(true);
            }, 1000);
        } else {
            setShowLoading(false);
        }

        return () => {
            if (loadingTimeout.current) {
                clearTimeout(loadingTimeout.current);
            }
        };
    }, [favoriteLoading]);

    const updateFavorite = () => {
        setFavoriteLoading(true);
        axios
            .patch(route('entry.update', currententry.id), {
                starred: currententry.starred_at ? false : true,
            })
            .then((response) => {
                const { data } = response as {
                    data: {
                        error?: string;
                        message?: string;
                    };
                };
                if (data.error) {
                    notifications.show({
                        title: 'Failed to star entry',
                        message: data.error,
                        color: 'red',
                        withBorder: true,
                    });
                    return;
                }
                if (currententry.starred_at) {
                    notifications.show({
                        title: 'Not that good...',
                        message: data.message,
                        color: 'blue',
                        withBorder: true,
                    });
                } else {
                    notifications.show({
                        title: 'Starred!',
                        message: data.message,
                        color: 'blue',
                        withBorder: true,
                    });
                }
            })
            .catch((error) => {
                notifications.show({
                    title: 'Failed to star entry',
                    message: error.message,
                    color: 'red',
                    withBorder: true,
                });
            })
            .finally(() => {
                setFavoriteLoading(false);
                router.visit('feeds', {
                    only: ['currententry', 'entries'],
                    data: {
                        entry: window.location.search.match(/entry=(\d+)/)?.[1],
                        feed: window.location.search.match(/feed=(\d+)/)?.[1],
                        filter: window.location.search.match(
                            /filter=(\w+)/,
                        )?.[1],
                        summarize: window.location.search.includes('summarize'),
                    },
                    preserveScroll: true,
                    preserveState: true,
                });
            });
    };

    const updateRead = () => {
        axios
            .patch(route('entry.update', currententry.id), {
                read: currententry.read_at ? false : true,
            })
            .then((response) => {
                const { data } = response as {
                    data: {
                        error?: string;
                        message?: string;
                    };
                };
                if (data.error) {
                    notifications.show({
                        title: 'Failed to mark entry as read',
                        message: data.error,
                        color: 'red',
                        withBorder: true,
                    });
                    return;
                }
                if (currententry.read_at) {
                    notifications.show({
                        title: 'Marked as unread',
                        message: data.message,
                        color: 'blue',
                        withBorder: true,
                    });
                } else {
                    notifications.show({
                        title: 'Marked as read',
                        message: data.message,
                        color: 'blue',
                        withBorder: true,
                    });
                }
            })
            .catch((error) => {
                notifications.show({
                    title: 'Failed to mark entry as read',
                    message: error.message,
                    color: 'red',
                    withBorder: true,
                });
            })
            .finally(() => {
                router.visit('feeds', {
                    only: ['currententry', 'entries'],
                    data: {
                        entry: window.location.search.match(/entry=(\d+)/)?.[1],
                        feed: window.location.search.match(/feed=(\d+)/)?.[1],
                        filter: window.location.search.match(
                            /filter=(\w+)/,
                        )?.[1],
                        skipSetRead: true,
                        summarize: window.location.search.includes('summarize'),
                    },
                    preserveScroll: true,
                    preserveState: true,
                });
            });
    };

    const [opened, { open, close }] = useDisclosure(false);

    const [value, setValue] = useState(summary ? 'summary' : 'content');

    useEffect(() => {
        if (summary) {
            setValue('summary');
        } else {
            setValue('content');
        }
    }, [summary]);

    useEffect(() => {
        console.log('value', value);
        if (value === 'summary') {
            router.visit('feeds', {
                only: ['summary'],
                data: {
                    entry: window.location.search.match(/entry=(\d+)/)?.[1],
                    feed: window.location.search.match(/feed=(\d+)/)?.[1],
                    filter: window.location.search.match(/filter=(\w+)/)?.[1],
                    summarize: true,
                },
                preserveScroll: true,
                preserveState: true,
            });
        }
        if (
            value === 'content' &&
            window.location.search.includes('summarize')
        ) {
            router.visit('feeds', {
                only: ['summary'],
                data: {
                    entry: window.location.search.match(/entry=(\d+)/)?.[1],
                    feed: window.location.search.match(/feed=(\d+)/)?.[1],
                    filter: window.location.search.match(/filter=(\w+)/)?.[1],
                },
                preserveScroll: true,
                preserveState: true,
            });
        }
    }, [value]);

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
                                loading={showLoading}
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
                                // loading={showLoading}
                                loaderProps={{ type: 'dots' }}
                            >
                                {currententry.read_at ? (
                                    <IconCircle size={15} stroke={3} />
                                ) : (
                                    <IconCircleFilled size={15} stroke={3} />
                                )}
                            </ActionIcon>
                        </Tooltip>
                        <Menu shadow="md">
                            <Menu.Target>
                                <ActionIcon
                                    color="gray"
                                    variant="outline"
                                    aria-label="Settings"
                                >
                                    <IconAdjustments
                                        style={{ width: '70%', height: '70%' }}
                                    />
                                </ActionIcon>
                            </Menu.Target>

                            {currententry.feed && (
                                <DeleteFeedModal
                                    feed={currententry.feed}
                                    opened={opened}
                                    onClose={close}
                                />
                            )}

                            <Menu.Dropdown>
                                <Menu.Label>Feed</Menu.Label>
                                <Menu.Item
                                    color="red"
                                    leftSection={
                                        <IconTrash
                                            style={{
                                                width: rem(14),
                                                height: rem(14),
                                            }}
                                        />
                                    }
                                    onClick={() => {
                                        open();
                                    }}
                                >
                                    Unsubscribe from feed
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
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
                                {currententry.author}
                            </Text>
                            <Text size="sm" c="dimmed">
                                {dayjs.utc(currententry.published_at).fromNow()}
                            </Text>
                        </Flex>
                        {value === 'content' ? (
                            <div
                                className={classes.entryContent}
                                dangerouslySetInnerHTML={{
                                    __html: currententry.content || '',
                                }}
                            />
                        ) : summary ? (
                            <div
                                className={classes.entryContent}
                                dangerouslySetInnerHTML={{
                                    __html: summary,
                                }}
                            />
                        ) : (
                            <div className={classes.entryContent}>
                                {/* First paragraph */}
                                <Skeleton height={8} width="95%" radius="xl" />
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
                                <Skeleton height={8} width="97%" radius="xl" />
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
                                />
                            </div>
                        )}
                    </TypographyStylesProvider>
                </Box>
            </ScrollArea>
        </Flex>
    );
}

const DeleteFeedModal = ({
    feed,
    opened,
    onClose,
}: {
    feed: { name: string; id: number };
    opened: boolean;
    onClose: () => void;
}) => {
    return (
        <Modal title="Unsubscribe from feed" opened={opened} onClose={onClose}>
            <Text size="sm">
                Are you sure you want to delete the feed{' '}
                <strong>{feed.name}</strong>?
            </Text>
            <Group justify="center" mt="xl">
                <Button variant="outline" size="sm" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    onClick={() => {
                        router.delete(route('feed.unsubscribe', feed.id));
                        notifications.show({
                            title: 'Unsubscribed',
                            message: `You have successfully unsubscribed from ${feed.name}.`,
                            color: 'blue',
                            withBorder: true,
                        });
                        onClose();
                    }}
                    color="red"
                    variant="outline"
                    size="sm"
                >
                    Delete
                </Button>
            </Group>
        </Modal>
    );
};

import classes from './CurrentEntryPane.module.css';

import { Split } from '@gfazioli/mantine-split-pane';
import { router } from '@inertiajs/react';
import {
    ActionIcon,
    Card,
    Divider,
    Flex,
    Image,
    Paper,
    ScrollArea,
    Text,
    Title,
    TypographyStylesProvider,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconStar, IconStarFilled } from '@tabler/icons-react';
import axios from 'axios';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { useEffect, useRef, useState } from 'react';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export default function CurrentEntryPane({
    currententry,
}: {
    currententry?: Entry;
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
            .patch(route('entry.update', currententry?.id), {
                starred: currententry?.starred_at ? false : true,
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
                if (currententry?.starred_at) {
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
                    },
                    preserveScroll: true,
                    preserveState: true,
                });
            });
    };

    return (
        <Split.Pane grow style={{ height: '100%' }}>
            <Flex direction="column">
                <Card pb={10} pt={10} pl={10} pr={10}>
                    <Flex direction="row" justify="space-between">
                        <Image
                            src={currententry?.feed.favicon_url}
                            w={28}
                            p={4}
                            h={28}
                            mr={9}
                        />

                        <Text size="sm" c="dimmed">
                            {currententry?.feed.name}
                        </Text>
                        <ActionIcon
                            variant="outline"
                            color="gray"
                            onClick={updateFavorite}
                            loading={showLoading}
                            loaderProps={{ type: 'dots' }}
                        >
                            {currententry?.starred_at ? (
                                <IconStarFilled size={15} stroke={1.5} />
                            ) : (
                                <IconStar size={15} stroke={1.5} />
                            )}
                        </ActionIcon>
                    </Flex>
                </Card>
                <Divider mb={20} />
                <ScrollArea style={{ height: '100%' }} viewportRef={viewport}>
                    {currententry ? (
                        <div>
                            <Paper shadow="xs" withBorder p={20}>
                                <TypographyStylesProvider>
                                    <Title className={classes.entryTitle}>
                                        {currententry.title}
                                    </Title>
                                    <Flex justify={'space-between'}>
                                        <Text size="sm" c="dimmed">
                                            {currententry.author}
                                        </Text>
                                        <Text size="sm" c="dimmed">
                                            {dayjs
                                                .utc(currententry.published_at)
                                                .fromNow()}
                                        </Text>
                                    </Flex>
                                    <div
                                        className={classes.entryContent}
                                        dangerouslySetInnerHTML={{
                                            __html: currententry.content || '',
                                        }}
                                    />
                                </TypographyStylesProvider>
                            </Paper>
                        </div>
                    ) : (
                        <Text>Select an entry</Text>
                    )}
                </ScrollArea>
            </Flex>
        </Split.Pane>
    );
}

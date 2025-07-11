import { DeleteFeedModal } from '@/Pages/Reader/Components/DeleteFeedModal';
import { UpdateFeedModal } from '@/Pages/Reader/Components/UpdateFeedModal';
import { router } from '@inertiajs/react';
import { ActionIcon, Menu, rem } from '@mantine/core';
import { useHover } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconDots,
    IconExternalLink,
    IconPencil,
    IconPhoto,
    IconRefresh,
    IconTrash,
} from '@tabler/icons-react';
import axios, { AxiosError } from 'axios';
import { useState } from 'react';

interface RefreshResponse {
    error?: string;
    message?: string;
}

interface FeedMenuProps {
    feed: Feed;
    categories?: Category[];
    onEditFeed?: () => void;
    onDeleteFeed?: () => void;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    variant?: 'outline' | 'filled' | 'subtle' | 'transparent';
    showOnHover?: boolean;
    className?: string;
    showBadge?: boolean;
    badgeContent?: React.ReactNode;
}

export function FeedMenu({
    feed,
    categories = [],
    onEditFeed,
    onDeleteFeed,
    size,
    variant = 'outline',
    showOnHover = false,
    className,
    showBadge = false,
    badgeContent,
}: FeedMenuProps) {
    const { hovered, ref } = useHover();
    const [opened, setOpened] = useState(false);
    const [editModalOpened, setEditModalOpened] = useState(false);
    const [deleteModalOpened, setDeleteModalOpened] = useState(false);

    // Use 'xs' size for sidebar (showOnHover mode), undefined for title bar (default size)
    const buttonSize = size ?? (showOnHover ? 'xs' : undefined);

    const markFeedAsRead = () => {
        router.post(
            route('feed.mark-read', feed.id),
            {},
            {
                only: [
                    'unreadEntriesCount',
                    'readEntriesCount',
                    'entries',
                    'currententry',
                ],
                onSuccess: () => {
                    notifications.show({
                        title: 'Feed marked as read',
                        message: `All entries from ${feed.name} have been marked as read.`,
                        color: 'blue',
                        withBorder: true,
                    });
                },
                onError: (error) => {
                    notifications.show({
                        title: 'Failed to mark feed as read',
                        message: error.message,
                        color: 'red',
                        withBorder: true,
                    });
                },
            },
        );
    };

    const requestRefresh = () => {
        axios
            .post<RefreshResponse>(route('feed.refresh', feed.id))
            .then((response) => {
                const { data } = response;
                if (data.error) {
                    notifications.show({
                        title: 'Failed to refresh feed',
                        message: data.error,
                        color: 'red',
                        withBorder: true,
                    });
                    return;
                }

                notifications.show({
                    title: data.message,
                    message: 'Check back in a few minutes',
                    color: 'blue',
                    withBorder: true,
                });
            })
            .catch((error: AxiosError<RefreshResponse>) => {
                if (error.response) {
                    if (error.response.status === 429) {
                        notifications.show({
                            title: 'What an avid reader you are!',
                            message: error.response.data.message,
                            color: 'yellow',
                            withBorder: true,
                        });
                        return;
                    }
                    notifications.show({
                        title: 'Failed to refresh feed',
                        message: error.response.data.error,
                        color: 'red',
                        withBorder: true,
                    });
                }
            });
    };

    const requestFaviconRefresh = () => {
        axios
            .post<RefreshResponse>(route('feed.refresh-favicon', feed.id))
            .then((response) => {
                const { data } = response;
                if (data.error) {
                    notifications.show({
                        title: 'Failed to refresh favicon',
                        message: data.error,
                        color: 'red',
                        withBorder: true,
                    });
                    return;
                }

                notifications.show({
                    title: 'Favicon refresh requested',
                    message: 'The favicon will be updated shortly',
                    color: 'blue',
                    withBorder: true,
                });
            })
            .catch((error: AxiosError<RefreshResponse>) => {
                if (error.response) {
                    notifications.show({
                        title: 'Failed to refresh favicon',
                        message: error.response.data.error,
                        color: 'red',
                        withBorder: true,
                    });
                }
            });
    };

    const shouldShowButton = showOnHover ? hovered || opened : true;
    const shouldShowBadge = showBadge && !shouldShowButton;

    return (
        <div
            ref={ref}
            onClick={(e) => {
                e.stopPropagation();
            }}
        >
            {shouldShowBadge ? (
                badgeContent
            ) : (
                <Menu
                    shadow="md"
                    width={200}
                    opened={opened}
                    onChange={setOpened}
                >
                    <Menu.Target>
                        <ActionIcon
                            size={buttonSize}
                            color="gray"
                            variant={variant}
                            className={className}
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                            style={{
                                visibility: shouldShowButton
                                    ? 'visible'
                                    : 'hidden',
                            }}
                        >
                            <IconDots size={15} stroke={1.5} />
                        </ActionIcon>
                    </Menu.Target>

                    <Menu.Dropdown>
                        <Menu.Label>Manage feed</Menu.Label>
                        <Menu.Item
                            leftSection={
                                <IconExternalLink
                                    style={{
                                        width: rem(14),
                                        height: rem(14),
                                    }}
                                />
                            }
                            onClick={(e) => {
                                e.stopPropagation();
                                window.open(feed.site_url, '_blank');
                            }}
                        >
                            Open website
                        </Menu.Item>
                        <Menu.Item
                            leftSection={
                                <IconExternalLink
                                    style={{
                                        width: rem(14),
                                        height: rem(14),
                                    }}
                                />
                            }
                            onClick={(e) => {
                                e.stopPropagation();
                                window.open(feed.feed_url, '_blank');
                            }}
                        >
                            Open feed
                        </Menu.Item>
                        <Menu.Item
                            onClick={(e) => {
                                e.stopPropagation();
                                markFeedAsRead();
                            }}
                            leftSection={
                                <IconCheck
                                    style={{
                                        width: rem(14),
                                        height: rem(14),
                                    }}
                                />
                            }
                        >
                            Mark as read
                        </Menu.Item>
                        <Menu.Item
                            leftSection={
                                <IconRefresh
                                    style={{
                                        width: rem(14),
                                        height: rem(14),
                                    }}
                                />
                            }
                            onClick={(e) => {
                                e.stopPropagation();
                                requestRefresh();
                            }}
                        >
                            Request refresh
                        </Menu.Item>
                        <Menu.Item
                            leftSection={
                                <IconPhoto
                                    style={{
                                        width: rem(14),
                                        height: rem(14),
                                    }}
                                />
                            }
                            onClick={(e) => {
                                e.stopPropagation();
                                requestFaviconRefresh();
                            }}
                        >
                            Refresh favicon
                        </Menu.Item>
                        <Menu.Item
                            leftSection={
                                <IconPencil
                                    style={{
                                        width: rem(14),
                                        height: rem(14),
                                    }}
                                />
                            }
                            onClick={(e) => {
                                e.stopPropagation();
                                setEditModalOpened(true);
                                onEditFeed?.();
                            }}
                        >
                            Edit feed
                        </Menu.Item>
                        <Menu.Divider />
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
                            onClick={(e) => {
                                e.stopPropagation();
                                setDeleteModalOpened(true);
                                onDeleteFeed?.();
                            }}
                        >
                            Unsubscribe
                        </Menu.Item>{' '}
                    </Menu.Dropdown>
                </Menu>
            )}

            {categories.length > 0 && (
                <UpdateFeedModal
                    feed={feed}
                    categories={categories}
                    opened={editModalOpened}
                    onClose={() => setEditModalOpened(false)}
                />
            )}

            <DeleteFeedModal
                feed={feed}
                opened={deleteModalOpened}
                onClose={() => setDeleteModalOpened(false)}
            />
        </div>
    );
}

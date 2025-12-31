import { router } from '@inertiajs/react';
import { Button, Group, Modal, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { getUrlParam, getUrlParams } from '@/utils/queryString';

interface DeleteFeedModalProps {
    feed: { name: string; id: number };
    opened: boolean;
    onClose: () => void;
}

export const DeleteFeedModal = ({
    feed,
    opened,
    onClose,
}: DeleteFeedModalProps) => {
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
                        router.delete(route('feed.unsubscribe', feed.id), {
                            onSuccess: () => {
                                notifications.show({
                                    title: 'Unsubscribed',
                                    message: `You have successfully unsubscribed from ${feed.name}.`,
                                    color: 'blue',
                                    withBorder: true,
                                });

                                const params = { ...getUrlParams() };
                                if (
                                    getUrlParam('feed') === feed.id.toString()
                                ) {
                                    delete params.feed;
                                }

                                router.visit(route('feeds.index'), {
                                    only: [
                                        'feeds',
                                        'entries',
                                        'currententry',
                                        'unreadEntriesCount',
                                        'readEntriesCount',
                                    ],
                                    data: params,
                                    preserveScroll: true,
                                    preserveState: true,
                                });

                                onClose();
                            },

                            onError: (error) => {
                                notifications.show({
                                    title: 'Failed to unsubscribe from feed',
                                    message: error.message,
                                    color: 'red',
                                    withBorder: true,
                                });
                            },
                        });
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

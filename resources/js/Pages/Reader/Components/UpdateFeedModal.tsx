import { router, useForm } from '@inertiajs/react';
import {
    Button,
    Fieldset,
    Modal,
    NativeSelect,
    rem,
    Space,
    TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconExclamationCircle } from '@tabler/icons-react';
import type { FormEventHandler } from 'react';

interface UpdateFeedModalProps {
    feed: Feed;
    categories: Category[];
    opened: boolean;
    onClose: () => void;
}

export const UpdateFeedModal = ({
    feed,
    categories,
    opened,
    onClose,
}: UpdateFeedModalProps) => {
    const { data, setData, errors, processing } = useForm<{
        category_id: number;
        name: string;
    }>({
        category_id: feed.category_id,
        name: feed.name === feed.original_name ? '' : feed.name,
    });

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        router.patch(
            route('feed.update', feed.id),
            {
                category_id: data.category_id,
                name: data.name,
            },
            {
                onSuccess: () => {
                    notifications.show({
                        title: 'Feed updated',
                        message: 'The feed has been updated',
                        color: 'green',
                        withBorder: true,
                    });

                    onClose();
                },
                onError: (errors) => {
                    notifications.show({
                        title: 'Failed to update feed',
                        message: errors.name,
                        color: 'red',
                        withBorder: true,
                    });
                },
            },
        );
    };

    return (
        <Modal title="Update feed" opened={opened} onClose={onClose}>
            <Fieldset variant="filled">
                <form onSubmit={submit}>
                    <TextInput
                        type="text"
                        label="Feed name"
                        placeholder={feed.original_name}
                        description="Leave empty to keep the original name"
                        data-autofocus
                        value={data.name}
                        onChange={(e) => setData('name', e.target.value)}
                        withErrorStyles={false}
                        rightSectionPointerEvents="none"
                        rightSection={
                            errors.name && (
                                <IconExclamationCircle
                                    style={{
                                        width: rem(20),
                                        height: rem(20),
                                    }}
                                    color="var(--mantine-color-error)"
                                />
                            )
                        }
                        error={errors.name}
                    />

                    <Space mt="md" />

                    <NativeSelect
                        label="Category"
                        description="The category where the feed will be moved"
                        data={categories.map((category) => ({
                            value: category.id.toString(),
                            label: category.name,
                        }))}
                        value={data.category_id.toString()}
                        onChange={(e) =>
                            setData('category_id', parseInt(e.target.value, 10))
                        }
                        error={errors.category_id}
                    />

                    <Button
                        mt="md"
                        fullWidth
                        type="submit"
                        disabled={processing}
                        loading={processing}
                    >
                        Submit
                    </Button>
                </form>
            </Fieldset>
        </Modal>
    );
};

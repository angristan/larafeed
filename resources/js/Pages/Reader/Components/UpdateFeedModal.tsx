import { router, useForm } from '@inertiajs/react';
import {
    ActionIcon,
    Button,
    Fieldset,
    Group,
    Modal,
    NativeSelect,
    rem,
    Space,
    Text,
    TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconExclamationCircle,
    IconPlus,
    IconTrash,
} from '@tabler/icons-react';
import type { FormEventHandler } from 'react';

interface FilterSectionProps {
    label: string;
    placeholder: string;
    buttonText: string;
    filters: string[];
    onAdd: () => void;
    onRemove: (index: number) => void;
    onUpdate: (index: number, value: string) => void;
}

const FilterSection = ({
    label,
    placeholder,
    buttonText,
    filters,
    onAdd,
    onRemove,
    onUpdate,
}: FilterSectionProps) => (
    <>
        <Text size="xs" fw={500} mt="sm">
            {label}
        </Text>
        {filters.map((filter, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Filter rules are simple strings without stable IDs
            <Group key={index} gap="xs" mt="xs">
                <TextInput
                    placeholder={placeholder}
                    value={filter}
                    onChange={(e) => onUpdate(index, e.target.value)}
                    style={{ flex: 1 }}
                    size="xs"
                    aria-label={`${label} pattern ${index + 1}`}
                />
                <ActionIcon
                    color="red"
                    variant="subtle"
                    onClick={() => onRemove(index)}
                    size="sm"
                    aria-label={`Remove ${label.toLowerCase()} pattern ${index + 1}`}
                >
                    <IconTrash size={14} />
                </ActionIcon>
            </Group>
        ))}
        <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={onAdd}
            mt="xs"
        >
            {buttonText}
        </Button>
    </>
);

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
        filter_rules: FilterRules;
    }>({
        category_id: feed.category_id,
        name: feed.name === feed.original_name ? '' : feed.name,
        filter_rules: {
            exclude_title: feed.filter_rules?.exclude_title ?? [],
            exclude_content: feed.filter_rules?.exclude_content ?? [],
            exclude_author: feed.filter_rules?.exclude_author ?? [],
        },
    });

    const addFilter = (field: keyof FilterRules) => {
        setData('filter_rules', {
            ...data.filter_rules,
            [field]: [...(data.filter_rules[field] ?? []), ''],
        });
    };

    const removeFilter = (field: keyof FilterRules, index: number) => {
        setData('filter_rules', {
            ...data.filter_rules,
            [field]: (data.filter_rules[field] ?? []).filter(
                (_, i) => i !== index,
            ),
        });
    };

    const updateFilter = (
        field: keyof FilterRules,
        index: number,
        value: string,
    ) => {
        const newFilters = [...(data.filter_rules[field] ?? [])];
        newFilters[index] = value;
        setData('filter_rules', {
            ...data.filter_rules,
            [field]: newFilters,
        });
    };

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        // Clean up empty filter values before submitting
        const cleanedFilterRules: FilterRules = {
            exclude_title: (data.filter_rules.exclude_title ?? []).filter(
                (v) => v.trim() !== '',
            ),
            exclude_content: (data.filter_rules.exclude_content ?? []).filter(
                (v) => v.trim() !== '',
            ),
            exclude_author: (data.filter_rules.exclude_author ?? []).filter(
                (v) => v.trim() !== '',
            ),
        };

        router.patch(
            route('feed.update', feed.id),
            {
                category_id: data.category_id,
                name: data.name,
                filter_rules: cleanedFilterRules,
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

                    <Space mt="lg" />

                    <Text size="sm" fw={500}>
                        Filter rules
                    </Text>
                    <Text size="xs" c="dimmed" mb="xs">
                        Hide entries matching these patterns (supports regex)
                    </Text>

                    <FilterSection
                        label="Exclude by title"
                        placeholder="e.g. alpha|beta"
                        buttonText="Add title filter"
                        filters={data.filter_rules.exclude_title ?? []}
                        onAdd={() => addFilter('exclude_title')}
                        onRemove={(index) =>
                            removeFilter('exclude_title', index)
                        }
                        onUpdate={(index, value) =>
                            updateFilter('exclude_title', index, value)
                        }
                    />

                    <FilterSection
                        label="Exclude by content"
                        placeholder="e.g. sponsored"
                        buttonText="Add content filter"
                        filters={data.filter_rules.exclude_content ?? []}
                        onAdd={() => addFilter('exclude_content')}
                        onRemove={(index) =>
                            removeFilter('exclude_content', index)
                        }
                        onUpdate={(index, value) =>
                            updateFilter('exclude_content', index, value)
                        }
                    />

                    <FilterSection
                        label="Exclude by author"
                        placeholder="e.g. bot"
                        buttonText="Add author filter"
                        filters={data.filter_rules.exclude_author ?? []}
                        onAdd={() => addFilter('exclude_author')}
                        onRemove={(index) =>
                            removeFilter('exclude_author', index)
                        }
                        onUpdate={(index, value) =>
                            updateFilter('exclude_author', index, value)
                        }
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

import {
    ActionIcon,
    Alert,
    Anchor,
    Badge,
    Button,
    Container,
    Divider,
    Drawer,
    Group,
    Loader,
    Modal,
    Paper,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import {
    IconAlertTriangle,
    IconArrowLeft,
    IconCheck,
    IconEdit,
    IconExternalLink,
    IconPlus,
    IconRefresh,
    IconRss,
    IconSearch,
    IconSettings,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router';

import type {
    ManagedCategory,
    ManagedSubscription,
    SubscriptionFilterRules,
} from '../api/subscriptions';
import { FeedFavicon } from '../components/reader/FeedFavicon';
import {
    createCategoryMutationOptions,
    createSubscriptionMutationOptions,
    deleteCategoryMutationOptions,
    refreshSubscriptionMutationOptions,
    subscriptionManagementQueryOptions,
    unsubscribeMutationOptions,
    updateCategoryMutationOptions,
    updateSubscriptionMutationOptions,
} from '../queries/subscriptions';
import classes from './SubscriptionsPage.module.css';

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
});

const numberFormatter = new Intl.NumberFormat();

type SubscriptionStatus = 'healthy' | 'failing' | 'never' | 'gone';
type StatusFilter = SubscriptionStatus | 'all';
type SortOrder = 'name' | 'entries' | 'recent';
type FilterField = keyof SubscriptionFilterRules;

const statusPresentation: Record<
    SubscriptionStatus,
    { readonly label: string; readonly color: string }
> = {
    healthy: { label: 'Healthy', color: 'green' },
    failing: { label: 'Needs attention', color: 'red' },
    never: { label: 'Never refreshed', color: 'gray' },
    gone: { label: 'Gone', color: 'orange' },
};

function formatTimestamp(timestamp: number | null): string {
    if (timestamp === null) {
        return 'Never';
    }
    const value = new Date(timestamp);
    return Number.isNaN(value.getTime())
        ? 'Unknown time'
        : dateTimeFormatter.format(value);
}

export function getSubscriptionStatus(
    subscription: ManagedSubscription,
): SubscriptionStatus {
    if (subscription.isGone) {
        return 'gone';
    }
    if (
        subscription.consecutiveFailures > 0 ||
        subscription.refreshes[0]?.successful === false
    ) {
        return 'failing';
    }
    return subscription.lastSuccessfulRefreshAt === null ? 'never' : 'healthy';
}

function StatusBadge({ subscription }: { subscription: ManagedSubscription }) {
    const status = getSubscriptionStatus(subscription);
    const presentation = statusPresentation[status];
    return (
        <Badge color={presentation.color} variant="light">
            {presentation.label}
        </Badge>
    );
}

function MutationError({
    error,
    title,
}: {
    readonly error: Error | null;
    readonly title: string;
}) {
    if (error === null) {
        return null;
    }
    return (
        <Alert color="red" role="alert" title={title}>
            {error.message}
        </Alert>
    );
}

function AddSubscriptionForm({
    categories,
}: {
    readonly categories: readonly ManagedCategory[];
}) {
    const queryClient = useQueryClient();
    const mutation = useMutation(
        createSubscriptionMutationOptions(queryClient),
    );
    const [feedUrl, setFeedUrl] = useState('');
    const [categoryId, setCategoryId] = useState<string | null>(
        categories[0] === undefined ? null : String(categories[0].id),
    );
    const [touched, setTouched] = useState(false);

    const normalizedUrl = feedUrl.trim();
    const feedUrlError =
        normalizedUrl.length === 0
            ? 'Enter a feed or website URL.'
            : normalizedUrl.length > 2_048
              ? 'Use 2,048 characters or fewer.'
              : undefined;

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setTouched(true);
        const parsedCategoryId = Number(categoryId);
        if (
            feedUrlError !== undefined ||
            !Number.isSafeInteger(parsedCategoryId) ||
            parsedCategoryId < 1
        ) {
            return;
        }

        mutation.mutate(
            { feedUrl: normalizedUrl, categoryId: parsedCategoryId },
            {
                onSuccess: () => {
                    setFeedUrl('');
                    setTouched(false);
                },
            },
        );
    };

    return (
        <Paper
            component="section"
            aria-labelledby="add-subscription-heading"
            withBorder
            p={{ base: 'lg', sm: 'xl' }}
        >
            <form onSubmit={submit}>
                <Stack gap="md">
                    <Stack gap={4}>
                        <Title
                            id="add-subscription-heading"
                            order={2}
                            size="h3"
                        >
                            Add a feed
                        </Title>
                        <Text c="dimmed" size="sm">
                            Enter a feed URL or a website that advertises a
                            feed.
                        </Text>
                    </Stack>
                    <TextInput
                        autoComplete="url"
                        disabled={mutation.isPending}
                        error={touched ? feedUrlError : undefined}
                        label="Feed or website URL"
                        leftSection={<IconRss aria-hidden="true" size={16} />}
                        maxLength={2_048}
                        onBlur={() => setTouched(true)}
                        onChange={(event) => {
                            setFeedUrl(event.currentTarget.value);
                            mutation.reset();
                        }}
                        placeholder="https://example.com/feed.xml"
                        required
                        value={feedUrl}
                    />
                    <Select
                        allowDeselect={false}
                        data={categories.map((category) => ({
                            value: String(category.id),
                            label: category.name,
                        }))}
                        disabled={mutation.isPending || categories.length === 0}
                        label="Category"
                        nothingFoundMessage="Create a category first"
                        onChange={(value) => {
                            setCategoryId(value);
                            mutation.reset();
                        }}
                        placeholder="Choose a category"
                        required
                        searchable
                        value={categoryId}
                    />
                    {categories.length === 0 && (
                        <Text c="dimmed" size="sm">
                            Create a category before adding your first feed.
                        </Text>
                    )}
                    <MutationError
                        error={mutation.error}
                        title="Feed could not be added"
                    />
                    {mutation.isSuccess && (
                        <Alert
                            color="green"
                            icon={<IconCheck aria-hidden="true" size={18} />}
                            role="status"
                            title="Feed added"
                        >
                            The first refresh has been queued.
                        </Alert>
                    )}
                    <Group justify="flex-end">
                        <Button
                            disabled={
                                categories.length === 0 ||
                                feedUrlError !== undefined ||
                                categoryId === null
                            }
                            leftSection={
                                <IconPlus aria-hidden="true" size={17} />
                            }
                            loading={mutation.isPending}
                            type="submit"
                        >
                            Add feed
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Paper>
    );
}

function CategoryManager({
    categories,
}: {
    readonly categories: readonly ManagedCategory[];
}) {
    const queryClient = useQueryClient();
    const createMutation = useMutation(
        createCategoryMutationOptions(queryClient),
    );
    const updateMutation = useMutation(
        updateCategoryMutationOptions(queryClient),
    );
    const deleteMutation = useMutation(
        deleteCategoryMutationOptions(queryClient),
    );
    const [newName, setNewName] = useState('');
    const [newNameTouched, setNewNameTouched] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingName, setEditingName] = useState('');
    const [categoryToDelete, setCategoryToDelete] =
        useState<ManagedCategory | null>(null);

    const normalizedNewName = newName.trim();
    const newNameError =
        normalizedNewName.length === 0
            ? 'Enter a category name.'
            : normalizedNewName.length > 64
              ? 'Use 64 characters or fewer.'
              : undefined;
    const normalizedEditingName = editingName.trim();
    const editingNameError =
        normalizedEditingName.length === 0
            ? 'Enter a category name.'
            : normalizedEditingName.length > 64
              ? 'Use 64 characters or fewer.'
              : undefined;

    const submitCreate = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setNewNameTouched(true);
        if (newNameError !== undefined) {
            return;
        }
        createMutation.mutate(
            { name: normalizedNewName },
            {
                onSuccess: () => {
                    setNewName('');
                    setNewNameTouched(false);
                },
            },
        );
    };

    const beginRename = (category: ManagedCategory) => {
        updateMutation.reset();
        setEditingId(category.id);
        setEditingName(category.name);
    };

    const saveRename = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (editingId === null || editingNameError !== undefined) {
            return;
        }
        updateMutation.mutate(
            { categoryId: editingId, name: normalizedEditingName },
            { onSuccess: () => setEditingId(null) },
        );
    };

    const confirmDelete = () => {
        if (categoryToDelete === null) {
            return;
        }
        deleteMutation.mutate(
            { categoryId: categoryToDelete.id },
            { onSuccess: () => setCategoryToDelete(null) },
        );
    };

    return (
        <Paper
            component="section"
            aria-labelledby="categories-heading"
            withBorder
            p={{ base: 'lg', sm: 'xl' }}
        >
            <Modal
                centered
                closeOnClickOutside={!deleteMutation.isPending}
                closeOnEscape={!deleteMutation.isPending}
                onClose={() => {
                    if (!deleteMutation.isPending) {
                        setCategoryToDelete(null);
                        deleteMutation.reset();
                    }
                }}
                opened={categoryToDelete !== null}
                title="Delete category?"
            >
                <Stack gap="md">
                    <Text size="sm">
                        Delete <strong>{categoryToDelete?.name}</strong>? This
                        action cannot be undone.
                    </Text>
                    <MutationError
                        error={deleteMutation.error}
                        title="Category was not deleted"
                    />
                    <Group justify="flex-end">
                        <Button
                            disabled={deleteMutation.isPending}
                            onClick={() => setCategoryToDelete(null)}
                            variant="default"
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            loading={deleteMutation.isPending}
                            onClick={confirmDelete}
                        >
                            Delete category
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Stack gap="md">
                <Stack gap={4}>
                    <Title id="categories-heading" order={2} size="h3">
                        Categories
                    </Title>
                    <Text c="dimmed" size="sm">
                        Organize feeds. A category must be empty before
                        deletion.
                    </Text>
                </Stack>
                <form onSubmit={submitCreate}>
                    <Group align="flex-start" wrap="nowrap">
                        <TextInput
                            aria-label="New category name"
                            disabled={createMutation.isPending}
                            error={newNameTouched ? newNameError : undefined}
                            maxLength={64}
                            onBlur={() => setNewNameTouched(true)}
                            onChange={(event) => {
                                setNewName(event.currentTarget.value);
                                createMutation.reset();
                            }}
                            placeholder="Technology"
                            style={{ flex: 1 }}
                            value={newName}
                        />
                        <Button
                            disabled={newNameError !== undefined}
                            leftSection={
                                <IconPlus aria-hidden="true" size={16} />
                            }
                            loading={createMutation.isPending}
                            type="submit"
                        >
                            Create
                        </Button>
                    </Group>
                </form>
                <MutationError
                    error={createMutation.error}
                    title="Category could not be created"
                />
                <Divider />
                {categories.length === 0 ? (
                    <Text c="dimmed" size="sm">
                        No categories yet.
                    </Text>
                ) : (
                    <Stack gap="sm">
                        {categories.map((category) => {
                            const explanationId = `category-${category.id}-delete-help`;
                            const isEditing = editingId === category.id;
                            return (
                                <Paper key={category.id} p="sm" withBorder>
                                    {isEditing ? (
                                        <form onSubmit={saveRename}>
                                            <Group
                                                align="flex-start"
                                                wrap="nowrap"
                                            >
                                                <TextInput
                                                    aria-label={`Rename ${category.name}`}
                                                    autoFocus
                                                    disabled={
                                                        updateMutation.isPending
                                                    }
                                                    error={editingNameError}
                                                    maxLength={64}
                                                    onChange={(event) => {
                                                        setEditingName(
                                                            event.currentTarget
                                                                .value,
                                                        );
                                                        updateMutation.reset();
                                                    }}
                                                    style={{ flex: 1 }}
                                                    value={editingName}
                                                />
                                                <ActionIcon
                                                    aria-label="Save category name"
                                                    color="green"
                                                    loading={
                                                        updateMutation.isPending
                                                    }
                                                    size="lg"
                                                    type="submit"
                                                    variant="light"
                                                >
                                                    <IconCheck
                                                        aria-hidden="true"
                                                        size={17}
                                                    />
                                                </ActionIcon>
                                                <ActionIcon
                                                    aria-label="Cancel category rename"
                                                    disabled={
                                                        updateMutation.isPending
                                                    }
                                                    onClick={() =>
                                                        setEditingId(null)
                                                    }
                                                    size="lg"
                                                    variant="subtle"
                                                >
                                                    <IconX
                                                        aria-hidden="true"
                                                        size={17}
                                                    />
                                                </ActionIcon>
                                            </Group>
                                            <MutationError
                                                error={updateMutation.error}
                                                title="Category was not renamed"
                                            />
                                        </form>
                                    ) : (
                                        <div className={classes.categoryRow}>
                                            <Stack gap={2}>
                                                <Group gap="xs">
                                                    <Text fw={600}>
                                                        {category.name}
                                                    </Text>
                                                    <Badge
                                                        color="gray"
                                                        variant="light"
                                                    >
                                                        {
                                                            category.subscriptionCount
                                                        }{' '}
                                                        {category.subscriptionCount ===
                                                        1
                                                            ? 'feed'
                                                            : 'feeds'}
                                                    </Badge>
                                                </Group>
                                                {category.subscriptionCount >
                                                    0 && (
                                                    <Text
                                                        c="dimmed"
                                                        id={explanationId}
                                                        size="xs"
                                                    >
                                                        Move or unsubscribe
                                                        every feed before
                                                        deleting this category.
                                                    </Text>
                                                )}
                                            </Stack>
                                            <Group gap="xs" justify="flex-end">
                                                <ActionIcon
                                                    aria-label={`Rename ${category.name}`}
                                                    onClick={() =>
                                                        beginRename(category)
                                                    }
                                                    variant="light"
                                                >
                                                    <IconEdit
                                                        aria-hidden="true"
                                                        size={16}
                                                    />
                                                </ActionIcon>
                                                <ActionIcon
                                                    aria-describedby={
                                                        category.subscriptionCount >
                                                        0
                                                            ? explanationId
                                                            : undefined
                                                    }
                                                    aria-label={`Delete ${category.name}`}
                                                    color="red"
                                                    disabled={
                                                        category.subscriptionCount >
                                                        0
                                                    }
                                                    onClick={() => {
                                                        deleteMutation.reset();
                                                        setCategoryToDelete(
                                                            category,
                                                        );
                                                    }}
                                                    variant="light"
                                                >
                                                    <IconTrash
                                                        aria-hidden="true"
                                                        size={16}
                                                    />
                                                </ActionIcon>
                                            </Group>
                                        </div>
                                    )}
                                </Paper>
                            );
                        })}
                    </Stack>
                )}
            </Stack>
        </Paper>
    );
}

function PatternEditor({
    label,
    description,
    values,
    disabled,
    onChange,
}: {
    readonly label: string;
    readonly description: string;
    readonly values: readonly string[];
    readonly disabled: boolean;
    readonly onChange: (values: string[]) => void;
}) {
    return (
        <Stack gap="xs">
            <Stack gap={2}>
                <Text fw={500} size="sm">
                    {label}
                </Text>
                <Text c="dimmed" size="xs">
                    {description}
                </Text>
            </Stack>
            {values.map((value, index) => (
                <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: filter drafts have no stable identifiers
                    key={index}
                    className={classes.patternRow}
                >
                    <TextInput
                        aria-label={`${label} pattern ${index + 1}`}
                        disabled={disabled}
                        error={
                            value.trim().length > 200
                                ? 'Use 200 characters or fewer.'
                                : undefined
                        }
                        maxLength={201}
                        onChange={(event) => {
                            const next = [...values];
                            next[index] = event.currentTarget.value;
                            onChange(next);
                        }}
                        placeholder="sponsored|advertisement"
                        value={value}
                    />
                    <ActionIcon
                        aria-label={`Remove ${label.toLowerCase()} pattern ${index + 1}`}
                        color="red"
                        disabled={disabled}
                        onClick={() =>
                            onChange(values.filter((_, item) => item !== index))
                        }
                        size="lg"
                        variant="subtle"
                    >
                        <IconTrash aria-hidden="true" size={16} />
                    </ActionIcon>
                </div>
            ))}
            <Button
                disabled={disabled || values.length >= 20}
                leftSection={<IconPlus aria-hidden="true" size={15} />}
                onClick={() => onChange([...values, ''])}
                size="xs"
                variant="light"
            >
                Add pattern
            </Button>
            {values.length >= 20 && (
                <Text c="dimmed" size="xs">
                    Maximum of 20 patterns reached.
                </Text>
            )}
        </Stack>
    );
}

function SubscriptionDetails({
    subscription,
    categories,
    onClose,
}: {
    readonly subscription: ManagedSubscription;
    readonly categories: readonly ManagedCategory[];
    readonly onClose: () => void;
}) {
    const queryClient = useQueryClient();
    const updateMutation = useMutation(
        updateSubscriptionMutationOptions(queryClient),
    );
    const refreshMutation = useMutation(
        refreshSubscriptionMutationOptions(queryClient),
    );
    const unsubscribeMutation = useMutation(
        unsubscribeMutationOptions(queryClient),
    );
    const [customName, setCustomName] = useState(
        subscription.customFeedName ?? '',
    );
    const [categoryId, setCategoryId] = useState(
        String(subscription.categoryId),
    );
    const [filterRules, setFilterRules] = useState<SubscriptionFilterRules>({
        excludeTitle: [...subscription.filterRules.excludeTitle],
        excludeContent: [...subscription.filterRules.excludeContent],
        excludeAuthor: [...subscription.filterRules.excludeAuthor],
    });
    const [confirmUnsubscribe, setConfirmUnsubscribe] = useState(false);

    const normalizedCustomName = customName.trim();
    const customNameError =
        normalizedCustomName.length > 255
            ? 'Use 255 characters or fewer.'
            : undefined;
    const patternError = Object.values(filterRules)
        .flat()
        .some((pattern) => pattern.trim().length > 200);

    const updateField = (field: FilterField, values: string[]) => {
        setFilterRules((current) => ({ ...current, [field]: values }));
        updateMutation.reset();
    };

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const parsedCategoryId = Number(categoryId);
        if (
            customNameError !== undefined ||
            patternError ||
            !Number.isSafeInteger(parsedCategoryId) ||
            parsedCategoryId < 1
        ) {
            return;
        }
        const clean = (values: readonly string[]) =>
            values
                .map((value) => value.trim())
                .filter((value) => value.length > 0);
        updateMutation.mutate({
            feedId: subscription.feedId,
            categoryId: parsedCategoryId,
            customFeedName:
                normalizedCustomName.length === 0 ? null : normalizedCustomName,
            filterRules: {
                excludeTitle: clean(filterRules.excludeTitle),
                excludeContent: clean(filterRules.excludeContent),
                excludeAuthor: clean(filterRules.excludeAuthor),
            },
        });
    };

    const unsubscribeFeed = () => {
        unsubscribeMutation.mutate(
            { feedId: subscription.feedId },
            { onSuccess: onClose },
        );
    };

    return (
        <>
            <Modal
                centered
                closeOnClickOutside={!unsubscribeMutation.isPending}
                closeOnEscape={!unsubscribeMutation.isPending}
                onClose={() => {
                    if (!unsubscribeMutation.isPending) {
                        setConfirmUnsubscribe(false);
                        unsubscribeMutation.reset();
                    }
                }}
                opened={confirmUnsubscribe}
                title="Unsubscribe from feed?"
            >
                <Stack gap="md">
                    <Text size="sm">
                        Remove{' '}
                        <strong>
                            {subscription.customFeedName ??
                                subscription.feedName}
                        </strong>{' '}
                        from your reader? Your private read and star state for
                        this subscription will be removed.
                    </Text>
                    <MutationError
                        error={unsubscribeMutation.error}
                        title="Feed was not removed"
                    />
                    <Group justify="flex-end">
                        <Button
                            disabled={unsubscribeMutation.isPending}
                            onClick={() => setConfirmUnsubscribe(false)}
                            variant="default"
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            loading={unsubscribeMutation.isPending}
                            onClick={unsubscribeFeed}
                        >
                            Unsubscribe
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Stack gap="xl">
                <Stack gap="sm">
                    <Group
                        justify="space-between"
                        align="flex-start"
                        wrap="wrap"
                    >
                        <Group align="flex-start" wrap="nowrap">
                            <FeedFavicon
                                src={subscription.faviconUrl}
                                isDark={subscription.faviconIsDark}
                                size={24}
                            />
                            <Stack gap={2} className={classes.subscriptionCopy}>
                                <Title order={2} size="h3">
                                    {subscription.customFeedName ??
                                        subscription.feedName}
                                </Title>
                                {subscription.customFeedName !== null && (
                                    <Text c="dimmed" size="sm">
                                        Original name: {subscription.feedName}
                                    </Text>
                                )}
                            </Stack>
                        </Group>
                        <StatusBadge subscription={subscription} />
                    </Group>
                    <Group gap="xs" wrap="wrap">
                        <Badge color="gray" variant="light">
                            {numberFormatter.format(subscription.entryCount)}{' '}
                            entries
                        </Badge>
                        <Badge color="blue" variant="light">
                            {numberFormatter.format(subscription.unreadCount)}{' '}
                            unread
                        </Badge>
                        <Badge variant="light">
                            {subscription.categoryName}
                        </Badge>
                    </Group>
                    <Stack gap={3}>
                        {subscription.siteUrl !== null && (
                            <Anchor
                                className={classes.breakAnywhere}
                                href={subscription.siteUrl}
                                rel="noreferrer"
                                target="_blank"
                            >
                                Website{' '}
                                <IconExternalLink
                                    aria-hidden="true"
                                    size={13}
                                />
                            </Anchor>
                        )}
                        <Anchor
                            className={classes.breakAnywhere}
                            href={subscription.feedUrl}
                            rel="noreferrer"
                            target="_blank"
                        >
                            {subscription.feedUrl}{' '}
                            <IconExternalLink aria-hidden="true" size={13} />
                        </Anchor>
                    </Stack>
                    {subscription.lastErrorMessage !== null && (
                        <Alert
                            color="red"
                            icon={
                                <IconAlertTriangle
                                    aria-hidden="true"
                                    size={18}
                                />
                            }
                            title={
                                subscription.lastErrorClass ??
                                'Latest refresh error'
                            }
                        >
                            {subscription.lastErrorMessage}
                        </Alert>
                    )}
                    <Group>
                        <Button
                            leftSection={
                                <IconRefresh aria-hidden="true" size={16} />
                            }
                            loading={refreshMutation.isPending}
                            onClick={() =>
                                refreshMutation.mutate({
                                    feedId: subscription.feedId,
                                })
                            }
                            variant="light"
                        >
                            Refresh now
                        </Button>
                        <Text c="dimmed" size="sm">
                            Last successful refresh:{' '}
                            {formatTimestamp(
                                subscription.lastSuccessfulRefreshAt,
                            )}
                        </Text>
                    </Group>
                    <MutationError
                        error={refreshMutation.error}
                        title="Refresh could not be queued"
                    />
                    {refreshMutation.isSuccess && (
                        <Alert
                            color="green"
                            role="status"
                            title="Refresh queued"
                        >
                            The feed will update in the background.
                        </Alert>
                    )}
                </Stack>

                <Divider />

                <form onSubmit={submit}>
                    <Stack gap="lg">
                        <Stack gap={4}>
                            <Title order={3} size="h4">
                                Subscription settings
                            </Title>
                            <Text c="dimmed" size="sm">
                                Rename or move this feed and hide entries with
                                case-insensitive regular expressions.
                            </Text>
                        </Stack>
                        <TextInput
                            description="Leave empty to use the feed's original name."
                            disabled={updateMutation.isPending}
                            error={customNameError}
                            label="Custom feed name"
                            maxLength={255}
                            onChange={(event) => {
                                setCustomName(event.currentTarget.value);
                                updateMutation.reset();
                            }}
                            placeholder={subscription.feedName}
                            value={customName}
                        />
                        <Select
                            allowDeselect={false}
                            data={categories.map((category) => ({
                                value: String(category.id),
                                label: category.name,
                            }))}
                            disabled={updateMutation.isPending}
                            label="Category"
                            onChange={(value) => {
                                if (value !== null) {
                                    setCategoryId(value);
                                    updateMutation.reset();
                                }
                            }}
                            searchable
                            value={categoryId}
                        />
                        <PatternEditor
                            description="Hide entries when their title matches."
                            disabled={updateMutation.isPending}
                            label="Title exclusions"
                            onChange={(values) =>
                                updateField('excludeTitle', values)
                            }
                            values={filterRules.excludeTitle}
                        />
                        <PatternEditor
                            description="Hide entries when their body or summary matches."
                            disabled={updateMutation.isPending}
                            label="Content exclusions"
                            onChange={(values) =>
                                updateField('excludeContent', values)
                            }
                            values={filterRules.excludeContent}
                        />
                        <PatternEditor
                            description="Hide entries when their author matches."
                            disabled={updateMutation.isPending}
                            label="Author exclusions"
                            onChange={(values) =>
                                updateField('excludeAuthor', values)
                            }
                            values={filterRules.excludeAuthor}
                        />
                        <MutationError
                            error={updateMutation.error}
                            title="Subscription was not updated"
                        />
                        {updateMutation.isSuccess && (
                            <Alert
                                color="green"
                                role="status"
                                title="Settings saved"
                            >
                                Reader filters and counts are being updated.
                            </Alert>
                        )}
                        <Group justify="flex-end">
                            <Button
                                disabled={
                                    customNameError !== undefined ||
                                    patternError
                                }
                                leftSection={
                                    <IconCheck aria-hidden="true" size={16} />
                                }
                                loading={updateMutation.isPending}
                                type="submit"
                            >
                                Save settings
                            </Button>
                        </Group>
                    </Stack>
                </form>

                <Divider />

                <Stack gap="sm">
                    <Group justify="space-between" align="baseline">
                        <Title order={3} size="h4">
                            Recent refreshes
                        </Title>
                        <Text c="dimmed" size="xs">
                            Latest {subscription.refreshes.length} of 10
                        </Text>
                    </Group>
                    <Table.ScrollContainer minWidth={620}>
                        <Table
                            striped
                            withRowBorders={false}
                            verticalSpacing="sm"
                        >
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Time</Table.Th>
                                    <Table.Th>Status</Table.Th>
                                    <Table.Th ta="right">New entries</Table.Th>
                                    <Table.Th>Result</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {subscription.refreshes.length === 0 ? (
                                    <Table.Tr>
                                        <Table.Td colSpan={4}>
                                            <Text c="dimmed" size="sm">
                                                No refresh attempts recorded
                                                yet.
                                            </Text>
                                        </Table.Td>
                                    </Table.Tr>
                                ) : (
                                    subscription.refreshes.map((refresh) => (
                                        <Table.Tr key={refresh.id}>
                                            <Table.Td>
                                                {formatTimestamp(
                                                    refresh.refreshedAt,
                                                )}
                                            </Table.Td>
                                            <Table.Td>
                                                <Badge
                                                    color={
                                                        refresh.successful
                                                            ? 'green'
                                                            : 'red'
                                                    }
                                                    variant="light"
                                                >
                                                    {refresh.successful
                                                        ? refresh.notModified
                                                            ? 'Not modified'
                                                            : 'Success'
                                                        : 'Failed'}
                                                </Badge>
                                            </Table.Td>
                                            <Table.Td ta="right">
                                                {numberFormatter.format(
                                                    refresh.entriesCreated,
                                                )}
                                            </Table.Td>
                                            <Table.Td>
                                                {refresh.errorMessage ??
                                                    (refresh.httpStatus === null
                                                        ? '—'
                                                        : `HTTP ${refresh.httpStatus}`)}
                                            </Table.Td>
                                        </Table.Tr>
                                    ))
                                )}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                </Stack>

                <Divider />
                <Stack gap="xs">
                    <Title c="red" order={3} size="h4">
                        Remove subscription
                    </Title>
                    <Text c="dimmed" size="sm">
                        This removes the feed from your reader. The shared feed
                        is retained when another user still subscribes to it.
                    </Text>
                    <Group justify="flex-end">
                        <Button
                            color="red"
                            leftSection={
                                <IconTrash aria-hidden="true" size={16} />
                            }
                            onClick={() => {
                                unsubscribeMutation.reset();
                                setConfirmUnsubscribe(true);
                            }}
                            variant="light"
                        >
                            Unsubscribe
                        </Button>
                    </Group>
                </Stack>
            </Stack>
        </>
    );
}

function SubscriptionList({
    subscriptions,
    categories,
}: {
    readonly subscriptions: readonly ManagedSubscription[];
    readonly categories: readonly ManagedCategory[];
}) {
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [sortOrder, setSortOrder] = useState<SortOrder>('name');
    const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);

    const filtered = useMemo(() => {
        const normalizedSearch = search.trim().toLocaleLowerCase();
        return subscriptions
            .filter((subscription) => {
                const name =
                    subscription.customFeedName ?? subscription.feedName;
                const matchesSearch =
                    normalizedSearch.length === 0 ||
                    `${name} ${subscription.feedName} ${subscription.feedUrl} ${subscription.siteUrl ?? ''}`
                        .toLocaleLowerCase()
                        .includes(normalizedSearch);
                const matchesCategory =
                    categoryFilter === 'all' ||
                    String(subscription.categoryId) === categoryFilter;
                const matchesStatus =
                    statusFilter === 'all' ||
                    getSubscriptionStatus(subscription) === statusFilter;
                return matchesSearch && matchesCategory && matchesStatus;
            })
            .toSorted((left, right) => {
                if (sortOrder === 'entries') {
                    return right.entryCount - left.entryCount;
                }
                if (sortOrder === 'recent') {
                    return (
                        (right.lastAttemptAt ?? 0) - (left.lastAttemptAt ?? 0)
                    );
                }
                const leftName = left.customFeedName ?? left.feedName;
                const rightName = right.customFeedName ?? right.feedName;
                return leftName.localeCompare(rightName);
            });
    }, [categoryFilter, search, sortOrder, statusFilter, subscriptions]);

    const selected = subscriptions.find(
        (subscription) => subscription.feedId === selectedFeedId,
    );

    return (
        <Stack
            component="section"
            gap="md"
            aria-labelledby="subscriptions-heading"
        >
            <Drawer
                closeOnClickOutside
                onClose={() => setSelectedFeedId(null)}
                opened={selected !== undefined}
                position="right"
                size="min(40rem, 100vw)"
                title="Manage subscription"
            >
                {selected !== undefined && (
                    <SubscriptionDetails
                        key={selected.feedId}
                        categories={categories}
                        onClose={() => setSelectedFeedId(null)}
                        subscription={selected}
                    />
                )}
            </Drawer>

            <Group justify="space-between" align="baseline">
                <Stack gap={2}>
                    <Title id="subscriptions-heading" order={2}>
                        Your subscriptions
                    </Title>
                    <Text c="dimmed" size="sm">
                        {subscriptions.length} total
                    </Text>
                </Stack>
            </Group>

            <Paper withBorder p={{ base: 'md', sm: 'lg' }}>
                <div className={classes.filterGrid}>
                    <TextInput
                        aria-label="Search subscriptions"
                        leftSection={
                            <IconSearch aria-hidden="true" size={16} />
                        }
                        onChange={(event) =>
                            setSearch(event.currentTarget.value)
                        }
                        placeholder="Name or URL"
                        value={search}
                    />
                    <Select
                        allowDeselect={false}
                        aria-label="Filter by category"
                        data={[
                            { value: 'all', label: 'All categories' },
                            ...categories.map((category) => ({
                                value: String(category.id),
                                label: category.name,
                            })),
                        ]}
                        onChange={(value) => setCategoryFilter(value ?? 'all')}
                        value={categoryFilter}
                    />
                    <Select
                        allowDeselect={false}
                        aria-label="Filter by refresh status"
                        data={[
                            { value: 'all', label: 'All statuses' },
                            ...Object.entries(statusPresentation).map(
                                ([value, presentation]) => ({
                                    value,
                                    label: presentation.label,
                                }),
                            ),
                        ]}
                        onChange={(value) =>
                            setStatusFilter((value ?? 'all') as StatusFilter)
                        }
                        value={statusFilter}
                    />
                    <Select
                        allowDeselect={false}
                        aria-label="Sort subscriptions"
                        data={[
                            { value: 'name', label: 'Name' },
                            { value: 'recent', label: 'Recent attempt' },
                            { value: 'entries', label: 'Most entries' },
                        ]}
                        onChange={(value) =>
                            setSortOrder((value ?? 'name') as SortOrder)
                        }
                        value={sortOrder}
                    />
                </div>
            </Paper>

            {subscriptions.length === 0 ? (
                <Paper withBorder p="xl">
                    <Stack align="center" gap="xs" ta="center">
                        <IconRss aria-hidden="true" size={28} />
                        <Text fw={600}>No subscriptions yet</Text>
                        <Text c="dimmed" maw={500} size="sm">
                            Add a feed above to start building your private
                            reader.
                        </Text>
                    </Stack>
                </Paper>
            ) : filtered.length === 0 ? (
                <Paper withBorder p="xl">
                    <Stack align="center" gap="xs" ta="center">
                        <IconSearch aria-hidden="true" size={28} />
                        <Text fw={600}>No matching subscriptions</Text>
                        <Text c="dimmed" size="sm">
                            Change or clear the search and filters.
                        </Text>
                        <Button
                            onClick={() => {
                                setSearch('');
                                setCategoryFilter('all');
                                setStatusFilter('all');
                            }}
                            size="xs"
                            variant="light"
                        >
                            Clear filters
                        </Button>
                    </Stack>
                </Paper>
            ) : (
                <Stack component="ul" gap="sm" m={0} p={0}>
                    {filtered.map((subscription) => {
                        const name =
                            subscription.customFeedName ??
                            subscription.feedName;
                        return (
                            <Paper
                                component="li"
                                key={subscription.feedId}
                                p={{ base: 'md', sm: 'lg' }}
                                style={{ listStyle: 'none' }}
                                withBorder
                            >
                                <div className={classes.subscriptionCard}>
                                    <Stack
                                        gap="xs"
                                        className={classes.subscriptionCopy}
                                    >
                                        <Group align="flex-start" wrap="nowrap">
                                            <FeedFavicon
                                                src={subscription.faviconUrl}
                                                isDark={
                                                    subscription.faviconIsDark
                                                }
                                                size={22}
                                            />
                                            <Stack
                                                gap={1}
                                                className={
                                                    classes.subscriptionCopy
                                                }
                                            >
                                                <Text fw={650}>{name}</Text>
                                                <Text
                                                    c="dimmed"
                                                    className={
                                                        classes.breakAnywhere
                                                    }
                                                    lineClamp={1}
                                                    size="xs"
                                                >
                                                    {subscription.feedUrl}
                                                </Text>
                                            </Stack>
                                        </Group>
                                        <div
                                            className={classes.subscriptionMeta}
                                        >
                                            <StatusBadge
                                                subscription={subscription}
                                            />
                                            <Badge variant="light">
                                                {subscription.categoryName}
                                            </Badge>
                                            <Text c="dimmed" size="sm">
                                                {numberFormatter.format(
                                                    subscription.unreadCount,
                                                )}{' '}
                                                unread ·{' '}
                                                {numberFormatter.format(
                                                    subscription.entryCount,
                                                )}{' '}
                                                entries
                                            </Text>
                                            <Text c="dimmed" size="sm">
                                                Last attempt:{' '}
                                                {formatTimestamp(
                                                    subscription.lastAttemptAt,
                                                )}
                                            </Text>
                                        </div>
                                    </Stack>
                                    <Button
                                        leftSection={
                                            <IconSettings
                                                aria-hidden="true"
                                                size={16}
                                            />
                                        }
                                        onClick={() =>
                                            setSelectedFeedId(
                                                subscription.feedId,
                                            )
                                        }
                                        variant="light"
                                    >
                                        Manage
                                    </Button>
                                </div>
                            </Paper>
                        );
                    })}
                </Stack>
            )}
        </Stack>
    );
}

function PageState({ children }: { readonly children: ReactNode }) {
    return (
        <Group justify="center" py="xl" role="status" aria-live="polite">
            {children}
        </Group>
    );
}

export function SubscriptionsPage() {
    const managementQuery = useQuery(subscriptionManagementQueryOptions);
    const data = managementQuery.data;
    const categories = useMemo(
        () =>
            [...(data?.categories ?? [])].sort((left, right) =>
                left.name.localeCompare(right.name),
            ),
        [data?.categories],
    );

    return (
        <Container component="main" size="lg" py={{ base: 'lg', sm: 'xl' }}>
            <Stack gap="xl">
                <Stack gap={4}>
                    <Button
                        component={Link}
                        leftSection={
                            <IconArrowLeft aria-hidden="true" size={16} />
                        }
                        size="compact-sm"
                        to="/feeds"
                        variant="subtle"
                    >
                        Back to reader
                    </Button>
                    <Group
                        justify="space-between"
                        align="flex-start"
                        wrap="wrap"
                    >
                        <Stack gap={4}>
                            <Title order={1}>Subscriptions</Title>
                            <Text c="dimmed" maw={680}>
                                Add feeds, organize categories, inspect
                                refreshes, and control which entries appear in
                                your reader.
                            </Text>
                        </Stack>
                        {managementQuery.isFetching &&
                            !managementQuery.isPending && (
                                <Group
                                    gap="xs"
                                    role="status"
                                    aria-live="polite"
                                >
                                    <Loader size="xs" />
                                    <Text c="dimmed" size="xs">
                                        Updating…
                                    </Text>
                                </Group>
                            )}
                    </Group>
                </Stack>

                {managementQuery.isPending && (
                    <PageState>
                        <Loader size="sm" />
                        <Text size="sm">Loading subscriptions…</Text>
                    </PageState>
                )}

                {managementQuery.isError && data === undefined && (
                    <Alert
                        color="red"
                        role="alert"
                        title="Subscriptions are unavailable"
                    >
                        <Stack align="flex-start" gap="sm">
                            <Text size="sm">
                                {managementQuery.error.message}
                            </Text>
                            <Button
                                leftSection={
                                    <IconRefresh aria-hidden="true" size={16} />
                                }
                                onClick={() => void managementQuery.refetch()}
                                size="xs"
                                variant="light"
                            >
                                Try again
                            </Button>
                        </Stack>
                    </Alert>
                )}

                {managementQuery.isError && data !== undefined && (
                    <Alert color="orange" title="Latest update failed">
                        Showing saved subscription data.{' '}
                        <Button
                            onClick={() => void managementQuery.refetch()}
                            size="compact-xs"
                            variant="subtle"
                        >
                            Try again
                        </Button>
                    </Alert>
                )}

                {data !== undefined && (
                    <>
                        <AddSubscriptionForm categories={categories} />
                        <CategoryManager categories={categories} />
                        <SubscriptionList
                            categories={categories}
                            subscriptions={data.subscriptions}
                        />
                    </>
                )}
            </Stack>
        </Container>
    );
}

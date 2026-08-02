import { Split } from '@gfazioli/mantine-split-pane';
import {
    ActionIcon,
    AppShell,
    Avatar,
    Burger,
    Button,
    Group,
    Select,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconKeyboard, IconLogout, IconRss } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Effect } from 'effect';
import { useEffect, useMemo, useRef } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { AuthClientError, logout, readCsrfToken } from '../api/auth';
import classes from '../components/reader/Reader.module.css';
import { ReaderEntryDetail } from '../components/reader/ReaderEntryDetail';
import { ReaderEntryList } from '../components/reader/ReaderEntryList';
import { ReaderShortcutHelp } from '../components/reader/ReaderShortcutHelp';
import { ReaderSidebar } from '../components/reader/ReaderSidebar';
import { isShortcutHelpKey } from '../components/reader/readerShortcuts';
import {
    authKeys,
    authSessionQueryOptions,
    clearAuthenticatedCache,
    isUnauthenticatedError,
} from '../queries/auth';
import {
    categoryListQueryOptions,
    entryDetailQueryOptions,
    entryListQueryOptions,
    readerCountsQueryOptions,
    subscriptionListQueryOptions,
} from '../queries/reader';
import {
    useEntryInteractionMutations,
    useReadThroughMutation,
} from '../queries/readerMutations';
import { parseReaderState, READER_PAGE_SIZE, readerHref } from '../readerState';

function firstError(...errors: Array<Error | null>): Error | null {
    return errors.find((error) => error !== null) ?? null;
}

function isEditableTarget(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
    );
}

export function ReaderPage() {
    const [searchParams] = useSearchParams();
    const state = useMemo(() => parseReaderState(searchParams), [searchParams]);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [navbarOpened, navbar] = useDisclosure(false);
    const [shortcutsOpened, shortcuts] = useDisclosure(false);

    const sessionQuery = useQuery(authSessionQueryOptions);
    const categoriesQuery = useQuery(categoryListQueryOptions);
    const subscriptionsQuery = useQuery(subscriptionListQueryOptions);
    const countsQuery = useQuery(readerCountsQueryOptions);
    const entryPageQuery = useQuery(
        entryListQueryOptions({
            feedId: state.feedId,
            categoryId: state.categoryId,
            filter: state.filter,
            orderBy: state.orderBy,
            page: state.page,
            pageSize: READER_PAGE_SIZE,
        }),
    );

    const selectedEntryId = state.entryId ?? 1;
    const entryDetailQuery = useQuery({
        ...entryDetailQueryOptions(selectedEntryId),
        enabled: state.entryId !== null,
    });
    const entryMutations = useEntryInteractionMutations(selectedEntryId);
    const readThroughMutation = useReadThroughMutation(state.feedId ?? 1);
    const openedReadAttempt = useRef<number | null>(null);

    useEffect(() => {
        const entry = entryDetailQuery.data;
        if (
            state.entryId === null ||
            entry === undefined ||
            entry.id !== state.entryId ||
            entry.read ||
            openedReadAttempt.current === entry.id
        ) {
            return;
        }

        openedReadAttempt.current = entry.id;
        entryMutations.read.mutate(true);
    }, [entryDetailQuery.data, entryMutations.read, state.entryId]);

    useEffect(() => {
        const pagination = entryPageQuery.data?.pagination;
        if (
            pagination === undefined ||
            entryPageQuery.isPlaceholderData ||
            state.page <= Math.max(1, pagination.totalPages)
        ) {
            return;
        }

        void navigate(
            readerHref(state, {
                page: Math.max(1, pagination.totalPages),
            }),
            { replace: true },
        );
    }, [
        entryPageQuery.data?.pagination,
        entryPageQuery.isPlaceholderData,
        navigate,
        state,
    ]);

    useEffect(() => {
        const navigateList = (event: KeyboardEvent) => {
            if (
                event.defaultPrevented ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                isEditableTarget(event.target)
            ) {
                return;
            }

            if (isShortcutHelpKey(event)) {
                event.preventDefault();
                shortcuts.open();
                return;
            }

            if (entryPageQuery.isPlaceholderData) {
                return;
            }

            const key = event.key.toLowerCase();
            if (key !== 'j' && key !== 'k') {
                return;
            }

            const entries = entryPageQuery.data?.entries ?? [];
            if (entries.length === 0) {
                return;
            }

            const currentIndex = entries.findIndex(
                (entry) => entry.id === state.entryId,
            );
            const nextIndex =
                currentIndex === -1 ? 0 : currentIndex + (key === 'j' ? 1 : -1);
            if (nextIndex < 0 || nextIndex >= entries.length) {
                return;
            }

            event.preventDefault();
            void navigate(
                readerHref(state, { entryId: entries[nextIndex].id }),
            );
        };

        window.addEventListener('keydown', navigateList);
        return () => window.removeEventListener('keydown', navigateList);
    }, [
        entryPageQuery.data?.entries,
        entryPageQuery.isPlaceholderData,
        navigate,
        shortcuts.open,
        state,
    ]);

    const logoutMutation = useMutation({
        mutationKey: [...authKeys.all, 'logout'],
        retry: false,
        mutationFn: () => {
            const csrfToken = readCsrfToken();
            if (csrfToken === undefined) {
                return Effect.runPromise(
                    Effect.fail(
                        new AuthClientError(
                            'status',
                            'Your session security token is missing. Sign in again.',
                            401,
                            'unauthenticated',
                        ),
                    ),
                );
            }
            return Effect.runPromise(logout(csrfToken));
        },
        onSuccess: () => {
            clearAuthenticatedCache(queryClient);
            void navigate('/login', { replace: true });
        },
        onError: (error) => {
            if (isUnauthenticatedError(error)) {
                void navigate('/login', { replace: true });
                return;
            }
            notifications.show({
                color: 'red',
                title: 'Sign-out failed',
                message: error.message,
            });
        },
    });

    if (sessionQuery.data !== undefined && !sessionQuery.data.authenticated) {
        return <Navigate to="/login" replace />;
    }

    const session = sessionQuery.data;
    const subscriptions = subscriptionsQuery.data?.subscriptions;
    const selectedSubscription = subscriptions?.find(
        (subscription) => subscription.feedId === state.feedId,
    );
    const selectedFeedName =
        selectedSubscription === undefined
            ? null
            : (selectedSubscription.customFeedName ??
              selectedSubscription.feedName);
    const sidebarError = firstError(
        categoriesQuery.error,
        subscriptionsQuery.error,
        countsQuery.error,
    );
    const mutationError = firstError(
        entryMutations.read.error,
        entryMutations.star.error,
        entryMutations.archive.error,
    );

    const backToList = () => {
        const previousEntryId = state.entryId;
        void navigate(readerHref(state, { entryId: null }));
        if (previousEntryId !== null) {
            window.setTimeout(() => {
                document
                    .getElementById(`reader-entry-${previousEntryId}`)
                    ?.focus();
            }, 0);
        }
    };

    return (
        <AppShell
            className={classes.shell}
            header={{ height: 56 }}
            navbar={{
                width: 280,
                breakpoint: 'md',
                collapsed: { mobile: !navbarOpened },
            }}
            padding={0}
        >
            <AppShell.Header className={classes.header}>
                <Group gap="sm" wrap="nowrap">
                    <Burger
                        aria-label="Toggle feed navigation"
                        hiddenFrom="md"
                        onClick={navbar.toggle}
                        opened={navbarOpened}
                        size="sm"
                    />
                    <IconRss aria-hidden="true" size={22} />
                    <Stack className={classes.brand} gap={0}>
                        <Title order={1} size="h4">
                            Larafeed
                        </Title>
                        <Text
                            c="dimmed"
                            className={classes.hideOnSmall}
                            size="xs"
                        >
                            Private feed reader
                        </Text>
                    </Stack>
                </Group>

                <Group gap="sm" wrap="nowrap">
                    <Select
                        aria-label="Order entries"
                        allowDeselect={false}
                        className={classes.hideOnSmall}
                        data={[
                            {
                                value: 'published_at',
                                label: 'Newest published',
                            },
                            { value: 'created_at', label: 'Recently added' },
                        ]}
                        onChange={(value) => {
                            if (
                                value === 'published_at' ||
                                value === 'created_at'
                            ) {
                                void navigate(
                                    readerHref(state, { orderBy: value }),
                                );
                            }
                        }}
                        size="xs"
                        value={state.orderBy}
                        w={160}
                    />
                    <ActionIcon
                        aria-label="Keyboard shortcuts"
                        onClick={shortcuts.open}
                        variant="subtle"
                    >
                        <IconKeyboard aria-hidden="true" size={17} />
                    </ActionIcon>
                    {session?.authenticated === true && (
                        <Avatar
                            aria-label={`Signed in as ${session.user.displayName}`}
                            color="blue"
                            name={session.user.displayName}
                            size="sm"
                        />
                    )}
                    <ActionIcon
                        aria-label="Sign out"
                        hiddenFrom="xs"
                        loading={logoutMutation.isPending}
                        onClick={() => logoutMutation.mutate()}
                        variant="subtle"
                    >
                        <IconLogout aria-hidden="true" size={16} />
                    </ActionIcon>
                    <Button
                        aria-label="Sign out"
                        leftSection={
                            <IconLogout aria-hidden="true" size={16} />
                        }
                        loading={logoutMutation.isPending}
                        onClick={() => logoutMutation.mutate()}
                        size="xs"
                        variant="subtle"
                        visibleFrom="xs"
                    >
                        Sign out
                    </Button>
                </Group>
            </AppShell.Header>

            <AppShell.Navbar aria-label="Feed navigation">
                <ReaderSidebar
                    categories={categoriesQuery.data?.categories}
                    counts={countsQuery.data}
                    error={sidebarError}
                    isPending={
                        categoriesQuery.isPending ||
                        subscriptionsQuery.isPending ||
                        countsQuery.isPending
                    }
                    onNavigate={navbar.close}
                    onRetry={() => {
                        void categoriesQuery.refetch();
                        void subscriptionsQuery.refetch();
                        void countsQuery.refetch();
                    }}
                    state={state}
                    subscriptions={subscriptions}
                />
            </AppShell.Navbar>

            <AppShell.Main className={classes.main}>
                <Split
                    className={classes.readerGrid}
                    data-detail={state.entryId !== null || undefined}
                    knobAlwaysOn
                    orientation="vertical"
                    shiftStep={60}
                    size={6}
                    step={12}
                    withKnob
                >
                    <Split.Pane
                        className={classes.listPaneContainer}
                        initialWidth="38%"
                        maxWidth={720}
                        minWidth={320}
                    >
                        <ReaderEntryList
                            error={entryPageQuery.error}
                            isFetching={entryPageQuery.isFetching}
                            isPending={entryPageQuery.isPending}
                            isPlaceholderData={entryPageQuery.isPlaceholderData}
                            markFeedReadError={readThroughMutation.error}
                            markFeedReadPending={readThroughMutation.isPending}
                            onMarkFeedRead={
                                state.feedId === null
                                    ? null
                                    : () => readThroughMutation.mutate()
                            }
                            onPageChange={(page) =>
                                void navigate(readerHref(state, { page }))
                            }
                            onPrefetchEntry={(entryId) => {
                                void queryClient.prefetchQuery(
                                    entryDetailQueryOptions(entryId),
                                );
                            }}
                            onRetry={() => void entryPageQuery.refetch()}
                            page={entryPageQuery.data}
                            selectedFeedName={selectedFeedName}
                            state={state}
                        />
                    </Split.Pane>
                    <Split.Pane className={classes.detailPaneContainer} grow>
                        <ReaderEntryDetail
                            archivePending={entryMutations.archive.isPending}
                            entry={entryDetailQuery.data}
                            error={entryDetailQuery.error}
                            isFetching={entryDetailQuery.isFetching}
                            isPending={entryDetailQuery.isPending}
                            mutationError={mutationError}
                            onBack={backToList}
                            onRetry={() => void entryDetailQuery.refetch()}
                            onSetArchived={(archived) =>
                                entryMutations.archive.mutate(archived)
                            }
                            onSetRead={(read) =>
                                entryMutations.read.mutate(read)
                            }
                            onSetStarred={(starred) =>
                                entryMutations.star.mutate(starred)
                            }
                            readPending={entryMutations.read.isPending}
                            selected={state.entryId !== null}
                            starPending={entryMutations.star.isPending}
                        />
                    </Split.Pane>
                </Split>
            </AppShell.Main>

            <ReaderShortcutHelp
                onClose={shortcuts.close}
                opened={shortcutsOpened}
            />
        </AppShell>
    );
}

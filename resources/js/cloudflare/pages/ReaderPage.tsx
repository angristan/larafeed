import { Split } from '@gfazioli/mantine-split-pane';
import {
    AppShell,
    useComputedColorScheme,
    useMantineTheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { ApplicationHeader } from '../components/ApplicationHeader';
import classes from '../components/reader/Reader.module.css';
import { ReaderEntryDetail } from '../components/reader/ReaderEntryDetail';
import { ReaderEntryList } from '../components/reader/ReaderEntryList';
import { ReaderSidebar } from '../components/reader/ReaderSidebar';
import { useDocumentTitle } from '../documentTitle';
import { authSessionQueryOptions } from '../queries/auth';
import {
    categoryListQueryOptions,
    entryDetailQueryOptions,
    entryListQueryOptions,
    readerCountsQueryOptions,
    subscriptionListQueryOptions,
} from '../queries/reader';
import { useEntryInteractionMutations } from '../queries/readerMutations';
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
    useDocumentTitle('Feeds');
    const [searchParams] = useSearchParams();
    const state = useMemo(() => parseReaderState(searchParams), [searchParams]);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [navbarOpened, navbar] = useDisclosure(false);
    const colorScheme = useComputedColorScheme('light');
    const theme = useMantineTheme();

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
        enabled:
            state.entryId !== null &&
            sessionQuery.data?.authenticated !== false,
    });
    const entryMutations = useEntryInteractionMutations(selectedEntryId);
    const openedReadAttempt = useRef<number | null>(null);
    const returnFocusEntryId = useRef<number | null>(null);

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
        entryMutations.read.mutate(true, {
            onError: (mutationError) =>
                notifications.show({
                    title: 'Failed to mark entry as read',
                    message: mutationError.message,
                    color: 'red',
                    withBorder: true,
                }),
        });
    }, [entryDetailQuery.data, entryMutations.read, state.entryId]);

    useEffect(() => {
        if (state.entryId !== null || returnFocusEntryId.current === null) {
            return;
        }

        const entryId = returnFocusEntryId.current;
        returnFocusEntryId.current = null;
        window.requestAnimationFrame(() => {
            document.getElementById(`reader-entry-${entryId}`)?.focus();
        });
    }, [state.entryId]);

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
                readerHref(state, {
                    entryId: entries[nextIndex].id,
                    summarize: state.summarize,
                }),
            );
        };

        window.addEventListener('keydown', navigateList);
        return () => window.removeEventListener('keydown', navigateList);
    }, [
        entryPageQuery.data?.entries,
        entryPageQuery.isPlaceholderData,
        navigate,
        state,
    ]);

    if (sessionQuery.data !== undefined && !sessionQuery.data.authenticated) {
        return <Navigate to="/login" replace />;
    }

    const subscriptions = subscriptionsQuery.data?.subscriptions;
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
        returnFocusEntryId.current = state.entryId;
        openedReadAttempt.current = null;
        void navigate(readerHref(state, { entryId: null }));
    };

    return (
        <AppShell
            className={classes.shell}
            header={{ height: 56 }}
            navbar={{
                width: 300,
                breakpoint: 'sm',
                collapsed: { mobile: !navbarOpened },
            }}
            padding="md"
        >
            <ApplicationHeader
                activePage="reader"
                hasSidebar
                navbarOpened={navbarOpened}
                onNavbarToggle={navbar.toggle}
            />

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
                    color={
                        colorScheme === 'dark'
                            ? theme.colors.dark[5]
                            : undefined
                    }
                    data-detail={state.entryId !== null || undefined}
                    radius="xs"
                    size="sm"
                    spacing="md"
                >
                    <Split.Pane
                        className={classes.listPaneContainer}
                        initialWidth="40%"
                        minWidth={300}
                    >
                        <ReaderEntryList
                            error={entryPageQuery.error}
                            isFetching={entryPageQuery.isFetching}
                            isPending={entryPageQuery.isPending}
                            isPlaceholderData={entryPageQuery.isPlaceholderData}
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
                                entryMutations.archive.mutate(archived, {
                                    onSuccess: () =>
                                        notifications.show({
                                            title: archived
                                                ? 'Entry archived'
                                                : 'Entry restored',
                                            message: archived
                                                ? 'Entry archived'
                                                : 'Entry restored',
                                            color: 'blue',
                                            withBorder: true,
                                        }),
                                    onError: (mutationError) =>
                                        notifications.show({
                                            title: archived
                                                ? 'Failed to archive entry'
                                                : 'Failed to restore entry',
                                            message: mutationError.message,
                                            color: 'red',
                                            withBorder: true,
                                        }),
                                })
                            }
                            onSetRead={(read) =>
                                entryMutations.read.mutate(read, {
                                    onSuccess: () =>
                                        notifications.show({
                                            title: read
                                                ? 'Marked as read'
                                                : 'Marked as unread',
                                            message: read
                                                ? 'Entry marked as read'
                                                : 'Entry marked as unread',
                                            color: 'blue',
                                            withBorder: true,
                                        }),
                                    onError: (mutationError) =>
                                        notifications.show({
                                            title: read
                                                ? 'Failed to mark entry as read'
                                                : 'Failed to mark entry as unread',
                                            message: mutationError.message,
                                            color: 'red',
                                            withBorder: true,
                                        }),
                                })
                            }
                            onSetStarred={(starred) =>
                                entryMutations.star.mutate(starred, {
                                    onSuccess: () =>
                                        notifications.show({
                                            title: starred
                                                ? 'Starred!'
                                                : 'Not that good...',
                                            message: starred
                                                ? 'Entry added to favorites'
                                                : 'Entry removed from favorites',
                                            color: 'blue',
                                            withBorder: true,
                                        }),
                                    onError: (mutationError) =>
                                        notifications.show({
                                            title: 'Failed to star entry',
                                            message: mutationError.message,
                                            color: 'red',
                                            withBorder: true,
                                        }),
                                })
                            }
                            onSetSummarize={(summarize) =>
                                void navigate(readerHref(state, { summarize }))
                            }
                            readPending={entryMutations.read.isPending}
                            selected={state.entryId !== null}
                            starPending={entryMutations.star.isPending}
                            summarize={state.summarize}
                        />
                    </Split.Pane>
                </Split>
            </AppShell.Main>
        </AppShell>
    );
}

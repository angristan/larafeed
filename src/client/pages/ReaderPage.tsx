import '@gfazioli/mantine-split-pane/styles.css';

import { Split } from '@gfazioli/mantine-split-pane';
import {
    AppShell,
    useComputedColorScheme,
    useMantineTheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
    useInfiniteQuery,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { Effect } from 'effect';
import {
    useCallback,
    useEffect,
    useEffectEvent,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import {
    listEntries as fetchEntryPage,
    type ReaderEntryPage,
} from '../api/reader';
import { ApplicationHeader } from '../components/ApplicationHeader';
import classes from '../components/reader/Reader.module.css';
import { ReaderEntryDetail } from '../components/reader/ReaderEntryDetail';
import { ReaderEntryList } from '../components/reader/ReaderEntryList';
import {
    notifyActionError,
    notifyDone,
    ReaderSidebar,
} from '../components/reader/ReaderSidebar';
import { useDocumentTitle } from '../documentTitle';
import { latestIngestion } from '../entryIngestion';
import { shouldPrefetchEntryDetails } from '../networkHints';
import { authSessionQueryOptions } from '../queries/auth';
import {
    categoryListQueryOptions,
    entryDetailQueryOptions,
    entryListInfiniteQueryOptions,
    readerCountsQueryOptions,
    subscriptionListQueryOptions,
} from '../queries/reader';
import { useEntryInteractionMutations } from '../queries/readerMutations';
import { useFeedListDensity } from '../readerPreferences';
import { parseReaderState, READER_PAGE_SIZE, readerHref } from '../readerState';

function firstError(...errors: Array<Error | null>): Error | null {
    return errors.find((error) => error !== null) ?? null;
}

function flattenEntries(
    pages: readonly { readonly entries: ReaderEntryPage['entries'] }[],
): ReaderEntryPage['entries'] {
    const seen = new Set<number>();
    const flat: ReaderEntryPage['entries'][number][] = [];
    for (const page of pages) {
        for (const entry of page.entries) {
            if (!seen.has(entry.id)) {
                seen.add(entry.id);
                flat.push(entry);
            }
        }
    }
    return flat;
}

const filterTitles = {
    all: 'All entries',
    unread: 'Unread entries',
    read: 'Read entries',
    favorites: 'Favorites',
} as const;

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
    const [addFeedOpened, addFeedModal] = useDisclosure(false);
    const [feedListDensity] = useFeedListDensity();
    const colorScheme = useComputedColorScheme('light');
    const theme = useMantineTheme();

    const sessionQuery = useQuery(authSessionQueryOptions);
    const categoriesQuery = useQuery(categoryListQueryOptions);
    const subscriptionsQuery = useQuery(subscriptionListQueryOptions);
    const countsQuery = useQuery(readerCountsQueryOptions);
    const entryListQuery = useInfiniteQuery(
        entryListInfiniteQueryOptions({
            feedId: state.feedId,
            categoryId: state.categoryId,
            filter: state.filter,
            orderBy: state.orderBy,
            pageSize: READER_PAGE_SIZE,
        }),
    );
    const listEntries = useMemo(
        () => flattenEntries(entryListQuery.data?.pages ?? []),
        [entryListQuery.data],
    );

    // The list skips the focus refetch (it would replay every loaded page),
    // so a refocus sends a one-entry probe instead. The probe asks only for
    // entries ingested after the newest cached one, so its total is the new
    // entry count and the server counts new rows instead of the whole scope.
    const [newEntryCount, setNewEntryCount] = useState(0);
    const lastProbeAt = useRef(0);
    const latestIngested = useMemo(
        () => latestIngestion(listEntries),
        [listEntries],
    );
    const listScope = useMemo(
        () => ({
            feedId: state.feedId,
            categoryId: state.categoryId,
            filter: state.filter,
            orderBy: state.orderBy,
            pageSize: READER_PAGE_SIZE,
        }),
        [state.feedId, state.categoryId, state.filter, state.orderBy],
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: the pending-refresh hint resets whenever the list scope changes
    useEffect(() => {
        setNewEntryCount(0);
        lastProbeAt.current = 0;
    }, [listScope]);

    useEffect(() => {
        const probe = () => {
            if (
                document.visibilityState !== 'visible' ||
                latestIngested === undefined ||
                Date.now() - lastProbeAt.current < 15_000
            ) {
                return;
            }
            lastProbeAt.current = Date.now();
            void Effect.runPromise(
                fetchEntryPage({
                    ...listScope,
                    orderBy: 'created_at',
                    cursor: null,
                    pageSize: 1,
                    // A refresh stores its completion time as the created_at
                    // of every entry it adds, so one millisecond later skips
                    // the newest cached refresh. A second refresh completing
                    // in that same millisecond is missed until a reload.
                    createdFrom: latestIngested.createdAt + 1,
                }),
            )
                .then((page) => {
                    const discovered = page.total ?? 0;
                    if (discovered > 0) {
                        setNewEntryCount((current) =>
                            Math.max(current, discovered),
                        );
                    }
                })
                .catch(() => undefined);
        };

        window.addEventListener('focus', probe);
        document.addEventListener('visibilitychange', probe);
        return () => {
            window.removeEventListener('focus', probe);
            document.removeEventListener('visibilitychange', probe);
        };
    }, [latestIngested, listScope]);

    // Refetching replays every loaded page sequentially with recomputed
    // cursors, so new entries land at their sorted position — including
    // mid-list backfills a top-of-list stitch could never place. Rows are
    // keyed by id and previous data is kept while fetching, so accepting
    // new entries never flashes skeletons or replays kept rows' animation.
    const refetchEntryList = entryListQuery.refetch;
    const showNewEntries = useCallback(() => {
        const pendingCount = newEntryCount;
        setNewEntryCount(0);
        void refetchEntryList().then((result) => {
            if (result.status === 'error') {
                setNewEntryCount((current) => Math.max(current, pendingCount));
            }
        });
    }, [newEntryCount, refetchEntryList]);

    const selectedEntryId = state.entryId ?? 1;
    const entryDetailQuery = useQuery({
        ...entryDetailQueryOptions(selectedEntryId),
        enabled:
            state.entryId !== null &&
            sessionQuery.data?.authenticated !== false,
    });
    const entryMutations = useEntryInteractionMutations(selectedEntryId);
    // mutate is stable for the life of the page, unlike the mutation results.
    const markEntryRead = entryMutations.read.mutate;
    const markEntryStarred = entryMutations.star.mutate;
    const markEntryArchived = entryMutations.archive.mutate;
    const openedReadAttempt = useRef<number | null>(null);
    const [returnFocusEntryId, setReturnFocusEntryId] = useState<number | null>(
        null,
    );

    const prefetchEntry = useCallback(
        (entryId: number) => {
            if (!shouldPrefetchEntryDetails()) {
                return;
            }

            void queryClient.prefetchQuery(entryDetailQueryOptions(entryId));
        },
        [queryClient],
    );

    // The list already holds the title, feed, and flags of the selected entry,
    // so the detail pane paints its header before the detail request lands.
    const previewEntry = useMemo(
        () =>
            state.entryId === null
                ? undefined
                : listEntries.find((entry) => entry.id === state.entryId),
        [listEntries, state.entryId],
    );

    // Hovering or focusing a row prefetches that row only. Keyboard and touch
    // navigation never hover, so the open entry's neighbours are fetched ahead
    // of the next J or K press. Cached entries are skipped by staleTime.
    useEffect(() => {
        if (state.entryId === null) {
            return;
        }
        const index = listEntries.findIndex(
            (entry) => entry.id === state.entryId,
        );
        if (index === -1) {
            return;
        }
        const neighbours = [listEntries[index - 1], listEntries[index + 1]];
        for (const neighbour of neighbours) {
            if (neighbour !== undefined) {
                prefetchEntry(neighbour.id);
            }
        }
    }, [listEntries, prefetchEntry, state.entryId]);

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
        markEntryRead(true, {
            onError: (mutationError) =>
                notifyActionError(
                    'Could not mark the entry as read',
                    mutationError,
                ),
        });
    }, [entryDetailQuery.data, markEntryRead, state.entryId]);

    // An effect event reads the latest list and query state, so the window
    // listener is added once instead of after every render.
    const navigateList = useEffectEvent((event: KeyboardEvent) => {
        if (
            event.defaultPrevented ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            isEditableTarget(event.target)
        ) {
            return;
        }

        const key = event.key.toLowerCase();
        if (key !== 'j' && key !== 'k') {
            return;
        }

        if (listEntries.length === 0) {
            return;
        }

        const currentIndex = listEntries.findIndex(
            (entry) => entry.id === state.entryId,
        );
        const nextIndex =
            currentIndex === -1 ? 0 : currentIndex + (key === 'j' ? 1 : -1);
        if (nextIndex < 0) {
            return;
        }
        if (nextIndex >= listEntries.length) {
            if (
                entryListQuery.hasNextPage &&
                !entryListQuery.isFetchingNextPage
            ) {
                event.preventDefault();
                void entryListQuery.fetchNextPage().then((result) => {
                    const next = flattenEntries(result.data?.pages ?? []).at(
                        nextIndex,
                    );
                    if (next !== undefined) {
                        void navigate(
                            readerHref(state, {
                                entryId: next.id,
                                summarize: state.summarize,
                            }),
                        );
                    }
                });
            }
            return;
        }

        event.preventDefault();
        void navigate(
            readerHref(state, {
                entryId: listEntries[nextIndex].id,
                summarize: state.summarize,
            }),
        );
    });

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => navigateList(event);
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    // Stable callbacks keep the memoized list, detail, and sidebar from
    // re-rendering when unrelated page state changes.
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = entryListQuery;
    const loadMoreEntries = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            void fetchNextPage();
        }
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
    const retryEntryList = useCallback(() => {
        void refetchEntryList();
    }, [refetchEntryList]);
    const restoreFocusHandled = useCallback(
        () => setReturnFocusEntryId(null),
        [],
    );
    const refetchEntryDetail = entryDetailQuery.refetch;
    const retryEntryDetail = useCallback(() => {
        void refetchEntryDetail();
    }, [refetchEntryDetail]);
    const refetchCategories = categoriesQuery.refetch;
    const refetchSubscriptions = subscriptionsQuery.refetch;
    const refetchCounts = countsQuery.refetch;
    const retrySidebar = useCallback(() => {
        void refetchCategories();
        void refetchSubscriptions();
        void refetchCounts();
    }, [refetchCategories, refetchCounts, refetchSubscriptions]);

    const backToList = useCallback(() => {
        setReturnFocusEntryId(state.entryId);
        openedReadAttempt.current = null;
        void navigate(readerHref(state, { entryId: null }));
    }, [navigate, state]);
    const setSummarize = useCallback(
        (summarize: boolean) => void navigate(readerHref(state, { summarize })),
        [navigate, state],
    );
    // Read and favorite changes show in the toolbar and list, so only
    // failures get a toast. Archive has no visible marker, so it is
    // confirmed.
    const setRead = useCallback(
        (read: boolean) =>
            markEntryRead(read, {
                onError: (mutationError) =>
                    notifyActionError(
                        read
                            ? 'Could not mark the entry as read'
                            : 'Could not mark the entry as unread',
                        mutationError,
                    ),
            }),
        [markEntryRead],
    );
    const setStarred = useCallback(
        (starred: boolean) =>
            markEntryStarred(starred, {
                onError: (mutationError) =>
                    notifyActionError(
                        starred
                            ? 'Could not add the entry to favorites'
                            : 'Could not remove the entry from favorites',
                        mutationError,
                    ),
            }),
        [markEntryStarred],
    );
    const setArchived = useCallback(
        (archived: boolean) =>
            markEntryArchived(archived, {
                onSuccess: () =>
                    notifyDone(archived ? 'Entry archived' : 'Entry restored'),
                onError: (mutationError) =>
                    notifyActionError(
                        archived
                            ? 'Could not archive the entry'
                            : 'Could not restore the entry',
                        mutationError,
                    ),
            }),
        [markEntryArchived],
    );

    if (sessionQuery.data !== undefined && !sessionQuery.data.authenticated) {
        return <Navigate to="/login" replace />;
    }

    const subscriptions = subscriptionsQuery.data?.subscriptions;
    const sidebarError = firstError(
        categoriesQuery.error,
        subscriptionsQuery.error,
        countsQuery.error,
    );
    const selectedSubscription = subscriptions?.find(
        (subscription) => subscription.feedId === state.feedId,
    );
    const baseScopeTitle =
        state.feedId !== null
            ? (selectedSubscription?.customFeedName ??
              selectedSubscription?.feedName ??
              'Feed entries')
            : state.categoryId !== null
              ? (categoriesQuery.data?.categories.find(
                    (category) => category.id === state.categoryId,
                )?.name ?? 'Category entries')
              : filterTitles[state.filter];
    const entryListTitle =
        (state.feedId !== null || state.categoryId !== null) &&
        state.filter !== 'all'
            ? `${baseScopeTitle}: ${filterTitles[state.filter]}`
            : baseScopeTitle;

    return (
        <AppShell
            className={classes.shell}
            header={{ height: { base: 72, sm: 0 } }}
            navbar={{
                width: { base: 'min(88vw, 320px)', sm: 364 },
                breakpoint: 'sm',
                collapsed: { mobile: !navbarOpened },
            }}
            padding={0}
        >
            <ApplicationHeader
                activePage="reader"
                hasSidebar
                navbarOpened={navbarOpened}
                onNavbarToggle={navbar.toggle}
                sidebar={
                    <ReaderSidebar
                        addFeedOpened={addFeedOpened}
                        categories={categoriesQuery.data?.categories}
                        counts={countsQuery.data}
                        error={sidebarError}
                        isPending={
                            categoriesQuery.isPending ||
                            subscriptionsQuery.isPending ||
                            countsQuery.isPending
                        }
                        onCloseAddFeed={addFeedModal.close}
                        onNavigate={navbar.close}
                        onOpenAddFeed={addFeedModal.open}
                        onRetry={retrySidebar}
                        state={state}
                        subscriptions={subscriptions}
                    />
                }
                sidebarLabel="Feed library"
            />

            <AppShell.Main className={classes.main}>
                <Split
                    /* Since v4, resizers between panes are opt-in. */
                    autoResizers
                    className={classes.readerGrid}
                    color={
                        colorScheme === 'dark'
                            ? theme.colors.dark[5]
                            : undefined
                    }
                    data-detail={state.entryId !== null || undefined}
                    radius="xs"
                    size="sm"
                    spacing={0}
                >
                    <Split.Pane
                        className={classes.listPaneContainer}
                        initialWidth="40%"
                        minWidth={300}
                    >
                        <ReaderEntryList
                            density={feedListDensity}
                            entries={listEntries}
                            newEntryCount={newEntryCount}
                            scopeTitle={entryListTitle}
                            error={entryListQuery.error}
                            hasNextPage={entryListQuery.hasNextPage}
                            isFetching={entryListQuery.isFetching}
                            isFetchingNextPage={
                                entryListQuery.isFetchingNextPage
                            }
                            isPending={entryListQuery.isPending}
                            onAddFirstFeed={
                                subscriptions?.length === 0
                                    ? addFeedModal.open
                                    : undefined
                            }
                            onLoadMore={loadMoreEntries}
                            onShowNewEntries={showNewEntries}
                            onPrefetchEntry={prefetchEntry}
                            onRestoreFocusHandled={restoreFocusHandled}
                            onRetry={retryEntryList}
                            restoreFocusEntryId={returnFocusEntryId}
                            state={state}
                            total={
                                entryListQuery.data?.pages[0]?.total ??
                                undefined
                            }
                        />
                    </Split.Pane>
                    <Split.Pane className={classes.detailPaneContainer} grow>
                        <ReaderEntryDetail
                            archivePending={entryMutations.archive.isPending}
                            entry={entryDetailQuery.data}
                            error={entryDetailQuery.error}
                            isFetching={entryDetailQuery.isFetching}
                            isPending={entryDetailQuery.isPending}
                            onBack={backToList}
                            onRetry={retryEntryDetail}
                            onSetArchived={setArchived}
                            onSetRead={setRead}
                            onSetStarred={setStarred}
                            onSetSummarize={setSummarize}
                            previewEntry={previewEntry}
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

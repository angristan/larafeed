import {
    ReaderCategoryListResponse,
    type ReaderEntry,
    ReaderSubscriptionListResponse,
} from '@shared/schemas/reader';
import { Effect } from 'effect';

import { rewriteArticleImageUrls } from '../images/article';
import { ReaderInvariantError, type ReaderStorageError } from './errors';
import type {
    ReaderEntryCursor,
    ReaderEntryQuery,
    ReaderRepository,
    ReaderSearchQuery,
} from './repository';

export interface ReaderServiceDependencies {
    readonly repository: ReaderRepository;
    readonly now?: () => number;
    // When the image proxy is disabled, article images keep their source URLs.
    readonly proxyImages?: boolean;
}

export interface ReaderEntryListBody {
    readonly entries: readonly ReaderEntry[];
    readonly total: number | null;
    readonly nextCursor: string | null;
}

const formatCursor = (cursor: ReaderEntryCursor | null): string | null =>
    cursor === null ? null : `${cursor.orderValue}:${cursor.id}`;

export const makeReaderService = (dependencies: ReaderServiceDependencies) => {
    const { repository } = dependencies;
    const currentTime = dependencies.now ?? Date.now;
    const proxyImages = dependencies.proxyImages ?? true;

    return {
        listCategories: (userId: number) =>
            repository
                .listCategories(userId)
                .pipe(
                    Effect.map((categories) =>
                        ReaderCategoryListResponse.make({ categories }),
                    ),
                ),
        listSubscriptions: (userId: number) =>
            repository
                .listSubscriptions(userId)
                .pipe(
                    Effect.map((subscriptions) =>
                        ReaderSubscriptionListResponse.make({ subscriptions }),
                    ),
                ),
        getCounts: (userId: number) => repository.getCounts(userId),
        // Both return plain objects, so `total` keeps its exact type. The
        // route encodes them through ReaderEntryListResponse.
        listEntries: (userId: number, query: ReaderEntryQuery) =>
            repository.listEntries(userId, query).pipe(
                Effect.map(({ entries, total, nextCursor }) => ({
                    entries,
                    total,
                    nextCursor: formatCursor(nextCursor),
                })),
            ),
        /**
         * Counts the scope only for the first page. The reader keeps that
         * total while it loads more, and each count reads every entry.
         */
        listEntryPage: (
            userId: number,
            query: ReaderEntryQuery,
        ): Effect.Effect<
            ReaderEntryListBody,
            ReaderStorageError | ReaderInvariantError
        > =>
            query.cursor === null
                ? repository.listEntries(userId, query).pipe(
                      Effect.map(({ entries, total, nextCursor }) => ({
                          entries,
                          total,
                          nextCursor: formatCursor(nextCursor),
                      })),
                  )
                : repository.listEntriesUncounted(userId, query).pipe(
                      Effect.map(({ entries, nextCursor }) => ({
                          entries,
                          total: null,
                          nextCursor: formatCursor(nextCursor),
                      })),
                  ),
        searchEntries: (userId: number, query: ReaderSearchQuery) =>
            repository.searchEntries(userId, query),
        findEntry: (userId: number, entryId: number) =>
            repository.findEntry(userId, entryId).pipe(
                Effect.flatMap((entry) =>
                    entry.contentHtml === null || !proxyImages
                        ? Effect.succeed(entry)
                        : Effect.tryPromise({
                              try: async () => ({
                                  ...entry,
                                  contentHtml: await rewriteArticleImageUrls(
                                      entry.id,
                                      entry.contentHtml ?? '',
                                      entry.url,
                                  ),
                              }),
                              catch: () =>
                                  new ReaderInvariantError({
                                      operation: 'reader.entry.images',
                                  }),
                          }),
                ),
            ),
        setRead: (userId: number, entryId: number, desired: boolean) =>
            repository.setRead(userId, entryId, desired, currentTime()),
        setStarred: (userId: number, entryId: number, desired: boolean) =>
            repository.setStarred(userId, entryId, desired, currentTime()),
        setArchived: (userId: number, entryId: number, desired: boolean) =>
            repository.setArchived(userId, entryId, desired, currentTime()),
        advanceReadThrough: (userId: number, feedId: number) =>
            repository.advanceReadThrough(userId, feedId, currentTime()),
    };
};

export type ReaderService = ReturnType<typeof makeReaderService>;

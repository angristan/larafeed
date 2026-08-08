import {
    ReaderCategoryListResponse,
    ReaderEntryListResponse,
    ReaderSubscriptionListResponse,
} from '@shared/schemas/reader';
import { Effect } from 'effect';

import { rewriteArticleImageUrls } from '../images/article';
import { ReaderInvariantError } from './errors';
import type { ReaderEntryQuery, ReaderRepository } from './repository';

export interface ReaderServiceDependencies {
    readonly repository: ReaderRepository;
    readonly now?: () => number;
    // When the image proxy is disabled, article images keep their source URLs.
    readonly proxyImages?: boolean;
}

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
        listEntries: (userId: number, query: ReaderEntryQuery) =>
            repository.listEntries(userId, query).pipe(
                Effect.map(({ entries, total, nextCursor }) =>
                    ReaderEntryListResponse.make({
                        entries,
                        total,
                        nextCursor:
                            nextCursor === null
                                ? null
                                : `${nextCursor.orderValue}:${nextCursor.id}`,
                    }),
                ),
            ),
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

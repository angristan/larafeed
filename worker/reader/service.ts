import {
    ReaderCategoryListResponse,
    ReaderEntryListResponse,
    ReaderSubscriptionListResponse,
} from '@shared/schemas/reader';
import { Effect } from 'effect';

import type { ReaderEntryQuery, ReaderRepository } from './repository';

export interface ReaderServiceDependencies {
    readonly repository: ReaderRepository;
    readonly now?: () => number;
}

export const makeReaderService = (dependencies: ReaderServiceDependencies) => {
    const { repository } = dependencies;
    const currentTime = dependencies.now ?? Date.now;

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
                Effect.map(({ entries, total }) =>
                    ReaderEntryListResponse.make({
                        entries,
                        pagination: {
                            page: query.page,
                            pageSize: query.pageSize,
                            total,
                            totalPages:
                                total === 0
                                    ? 0
                                    : Math.ceil(total / query.pageSize),
                        },
                    }),
                ),
            ),
        findEntry: (userId: number, entryId: number) =>
            repository.findEntry(userId, entryId),
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

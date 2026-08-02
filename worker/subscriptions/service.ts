import {
    CategoryMutationResponse,
    CreateSubscriptionResponse,
    type SubscriptionFilterRules,
    SubscriptionManagementResponse,
    SubscriptionMutationResponse,
} from '@shared/schemas/subscriptions';
import { Effect } from 'effect';

import { generateSafeId } from '../auth/crypto';
import { validateFeedUrl } from '../feeds/policy';
import type { FeedUpdatedResult } from '../feeds/service';
import {
    SubscriptionConflict,
    SubscriptionFeedError,
    SubscriptionInvariantError,
    type SubscriptionStorageError,
    SubscriptionValidationError,
} from './errors';
import {
    compileFilterRules,
    matchesSubscriptionFilter,
    validateFilterRules,
} from './filter';
import type { SubscriptionRepository } from './repository';

export const MAX_FILTER_REAPPLY_ENTRIES = 10_000;
const FILTER_PAGE_SIZE_WITH_CONTENT = 10;
const FILTER_PAGE_SIZE_WITHOUT_CONTENT = 100;

export interface SubscriptionServiceDependencies {
    readonly repository: SubscriptionRepository;
    readonly discoverFeed: (
        url: string,
    ) => Effect.Effect<FeedUpdatedResult, { readonly retryable: boolean }>;
    readonly scheduleRefresh: (
        feedId: number,
    ) => Effect.Effect<
        { readonly operationId: string },
        SubscriptionStorageError
    >;
    readonly generateId?: () => Effect.Effect<number, unknown>;
    readonly now?: () => number;
}

const sameRules = (
    left: SubscriptionFilterRules,
    right: SubscriptionFilterRules,
): boolean =>
    JSON.stringify(left.excludeTitle) === JSON.stringify(right.excludeTitle) &&
    JSON.stringify(left.excludeContent) ===
        JSON.stringify(right.excludeContent) &&
    JSON.stringify(left.excludeAuthor) === JSON.stringify(right.excludeAuthor);

export const makeSubscriptionService = (
    dependencies: SubscriptionServiceDependencies,
) => {
    const { repository } = dependencies;
    const now = dependencies.now ?? Date.now;
    const nextId =
        dependencies.generateId ??
        (() =>
            generateSafeId().pipe(
                Effect.mapError(
                    () =>
                        new SubscriptionInvariantError({
                            operation: 'subscriptions.generateId',
                        }),
                ),
            ));

    const rebuildFilters = (
        userId: number,
        feedId: number,
        rules: SubscriptionFilterRules,
    ) =>
        Effect.gen(function* () {
            const total = yield* repository.filterEntryCount(userId, feedId);
            if (total > MAX_FILTER_REAPPLY_ENTRIES) {
                return yield* Effect.fail(
                    new SubscriptionConflict({
                        reason: 'filter_rebuild_too_large',
                    }),
                );
            }
            const throughId = yield* repository.filterHighWatermark(
                userId,
                feedId,
            );
            if (throughId === null) return;

            const compiled = compileFilterRules(rules);
            const includeContent = rules.excludeContent.length > 0;
            const pageSize = includeContent
                ? FILTER_PAGE_SIZE_WITH_CONTENT
                : FILTER_PAGE_SIZE_WITHOUT_CONTENT;
            const matched: number[] = [];
            let cursor = 0;
            while (cursor < throughId) {
                const candidates = yield* repository.listFilterCandidates(
                    userId,
                    feedId,
                    cursor,
                    throughId,
                    pageSize,
                    includeContent,
                );
                if (candidates.length === 0) break;
                for (const candidate of candidates) {
                    if (matchesSubscriptionFilter(candidate, compiled)) {
                        matched.push(candidate.id);
                    }
                }
                cursor = candidates.at(-1)?.id ?? throughId;
            }
            yield* repository.replaceFilteredEntries(
                userId,
                feedId,
                throughId,
                matched,
                now(),
            );
        });

    return {
        list: (userId: number) =>
            repository.listManagement(userId).pipe(
                Effect.map(({ categories, subscriptions }) =>
                    SubscriptionManagementResponse.make({
                        categories,
                        subscriptions,
                    }),
                ),
            ),

        createCategory: (userId: number, name: string) =>
            Effect.gen(function* () {
                const category = yield* repository.createCategory(
                    yield* nextId(),
                    userId,
                    name,
                    now(),
                );
                return CategoryMutationResponse.make({ category });
            }),

        updateCategory: (userId: number, categoryId: number, name: string) =>
            repository
                .updateCategory(userId, categoryId, name, now())
                .pipe(
                    Effect.map((category) =>
                        CategoryMutationResponse.make({ category }),
                    ),
                ),

        deleteCategory: (userId: number, categoryId: number) =>
            repository.deleteCategory(userId, categoryId),

        createSubscription: (
            userId: number,
            input: {
                readonly feedUrl: string;
                readonly categoryId?: number;
                readonly categoryName?: string;
            },
        ) =>
            Effect.gen(function* () {
                const requestedUrl = /^[a-z][a-z\d+.-]*:\/\//iu.test(
                    input.feedUrl,
                )
                    ? input.feedUrl
                    : `https://${input.feedUrl}`;
                let canonicalRequestedUrl: string;
                try {
                    canonicalRequestedUrl = validateFeedUrl(requestedUrl).href;
                } catch {
                    return yield* Effect.fail(
                        new SubscriptionFeedError({ retryable: false }),
                    );
                }

                let categoryId: number;
                if (
                    input.categoryId !== undefined &&
                    input.categoryName === undefined
                ) {
                    categoryId = input.categoryId;
                } else if (
                    input.categoryId === undefined &&
                    input.categoryName !== undefined
                ) {
                    const category = yield* repository.findOrCreateCategory(
                        yield* nextId(),
                        userId,
                        input.categoryName,
                        now(),
                    );
                    categoryId = category.id;
                } else {
                    return yield* Effect.fail(
                        new SubscriptionValidationError(),
                    );
                }

                const existingFeedId = yield* repository.findFeedByUrl(
                    canonicalRequestedUrl,
                );
                const outcome =
                    existingFeedId === null
                        ? yield* Effect.gen(function* () {
                              const discovered = yield* dependencies
                                  .discoverFeed(canonicalRequestedUrl)
                                  .pipe(
                                      Effect.mapError(
                                          (cause) =>
                                              new SubscriptionFeedError({
                                                  retryable: cause.retryable,
                                              }),
                                      ),
                                  );
                              const feedUrl = discovered.finalUrl;
                              return yield* repository.subscribeDiscovered({
                                  proposedId: yield* nextId(),
                                  feedUrl,
                                  name: discovered.feed.title || feedUrl,
                                  siteUrl: discovered.feed.siteUrl,
                                  faviconUrl: discovered.feed.faviconUrl,
                                  categoryId,
                                  userId,
                                  now: now(),
                              });
                          })
                        : {
                              feedId: existingFeedId,
                              createdFeed: false,
                              createdSubscription:
                                  yield* repository.subscribeExisting(
                                      userId,
                                      existingFeedId,
                                      categoryId,
                                      now(),
                                  ),
                          };
                const refresh = yield* dependencies.scheduleRefresh(
                    outcome.feedId,
                );
                const subscription = yield* repository.findSubscription(
                    userId,
                    outcome.feedId,
                );
                return CreateSubscriptionResponse.make({
                    subscription,
                    createdFeed: outcome.createdFeed,
                    createdSubscription: outcome.createdSubscription,
                    refreshOperationId: refresh.operationId,
                });
            }),

        updateSubscription: (
            userId: number,
            feedId: number,
            input: {
                readonly categoryId: number;
                readonly customFeedName: string | null;
                readonly filterRules: SubscriptionFilterRules;
            },
        ) =>
            Effect.gen(function* () {
                if (!validateFilterRules(input.filterRules)) {
                    return yield* Effect.fail(
                        new SubscriptionValidationError(),
                    );
                }
                const current = yield* repository.findSubscription(
                    userId,
                    feedId,
                );
                const rulesChanged = !sameRules(
                    current.filterRules,
                    input.filterRules,
                );
                if (rulesChanged) {
                    const total = yield* repository.filterEntryCount(
                        userId,
                        feedId,
                    );
                    if (total > MAX_FILTER_REAPPLY_ENTRIES) {
                        return yield* Effect.fail(
                            new SubscriptionConflict({
                                reason: 'filter_rebuild_too_large',
                            }),
                        );
                    }
                }
                yield* repository.updateSubscription(
                    userId,
                    feedId,
                    input.categoryId,
                    input.customFeedName?.trim() || null,
                    input.filterRules,
                    now(),
                );
                if (rulesChanged) {
                    yield* rebuildFilters(userId, feedId, input.filterRules);
                }
                const subscription = yield* repository.findSubscription(
                    userId,
                    feedId,
                );
                return SubscriptionMutationResponse.make({ subscription });
            }),

        unsubscribe: (userId: number, feedId: number) =>
            repository.unsubscribe(userId, feedId),
    };
};

export type SubscriptionService = ReturnType<typeof makeSubscriptionService>;

import {
    CategoryMutationResponse,
    CreateSubscriptionResponse,
    type SubscriptionFilterRules,
    SubscriptionManagementResponse,
    SubscriptionMutationResponse,
} from '@shared/schemas/subscriptions';
import { Effect } from 'effect';

import { generateSafeId } from '../auth/crypto';
import type { FeedRefreshError } from '../feeds/errors';
import { validateFeedUrl } from '../feeds/policy';
import type { FeedUpdatedResult } from '../feeds/service';
import {
    DEFAULT_REFRESH_INTERVAL_MS,
    UNCHANGED_REFRESH_INTERVALS_MS,
} from '../jobs';
import { prepareRefreshEntry } from '../refresh/entries';
import {
    SubscriptionConflict,
    SubscriptionFeedError,
    SubscriptionInvariantError,
    SubscriptionValidationError,
} from './errors';
import {
    compileFilterRules,
    matchesSubscriptionFilter,
    validateFilterRules,
} from './filter';
import type { SubscriptionRepository } from './repository';

export const MAX_FILTER_REAPPLY_ENTRIES = 15_000;
// A complete 15,000-entry content rebuild needs at most 750 candidate reads.
// Including the snapshot, two subscription reads, and four commit statements,
// the service uses at most 757 of D1's 1,000 paid-invocation query allowance.
const FILTER_PAGE_SIZE_WITH_CONTENT = 20;
const FILTER_PAGE_SIZE_WITHOUT_CONTENT = 100;

export interface SubscriptionServiceDependencies {
    readonly repository: SubscriptionRepository;
    readonly discoverFeed: (
        url: string,
    ) => Effect.Effect<FeedUpdatedResult, FeedRefreshError>;
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

const feedDiscoveryError = (cause: FeedRefreshError): SubscriptionFeedError => {
    switch (cause._tag) {
        case 'FeedPolicyError':
            return new SubscriptionFeedError({ reason: 'invalid_url' });
        case 'FeedParseError':
            return new SubscriptionFeedError({ reason: 'unsupported_feed' });
        case 'FeedSizeError':
            return new SubscriptionFeedError({ reason: 'feed_too_large' });
        case 'FeedTimeoutError':
        case 'FeedNetworkError':
            return new SubscriptionFeedError({
                reason: 'temporarily_unavailable',
            });
        case 'FeedHttpError':
            // Cloudflare uses HTTP 530 when it cannot resolve the origin host.
            if (cause.status === 530) {
                return new SubscriptionFeedError({
                    reason: 'unresolvable_host',
                });
            }
            if (cause.status === 429) {
                return new SubscriptionFeedError({
                    reason: 'upstream_rate_limited',
                });
            }
            return new SubscriptionFeedError({
                reason: cause.retryable
                    ? 'temporarily_unavailable'
                    : 'unsupported_feed',
            });
    }
};

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
        categoryId: number,
        customFeedName: string | null,
        rules: SubscriptionFilterRules,
    ) =>
        Effect.gen(function* () {
            const window = yield* repository.filterEntryWindow(userId, feedId);
            if (window.total > MAX_FILTER_REAPPLY_ENTRIES) {
                return yield* Effect.fail(
                    new SubscriptionConflict({
                        reason: 'filter_rebuild_too_large',
                    }),
                );
            }
            const throughId = window.throughId ?? 0;
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
            yield* repository.updateSubscriptionWithFilterRebuild(
                userId,
                feedId,
                categoryId,
                customFeedName,
                rules,
                window.filterRevision,
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
                        new SubscriptionFeedError({ reason: 'invalid_url' }),
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
                              const startedAt = now();
                              const discovered = yield* dependencies
                                  .discoverFeed(canonicalRequestedUrl)
                                  .pipe(Effect.mapError(feedDiscoveryError));
                              const entries = yield* Effect.forEach(
                                  discovered.entries,
                                  (entry) => prepareRefreshEntry(entry, []),
                              ).pipe(
                                  Effect.mapError(
                                      () =>
                                          new SubscriptionInvariantError({
                                              operation:
                                                  'subscriptions.prepareEntries',
                                          }),
                                  ),
                              );
                              const completedAt = now();
                              const feedUrl = discovered.finalUrl;
                              const baseInterval =
                                  entries.length === 0
                                      ? UNCHANGED_REFRESH_INTERVALS_MS[0]
                                      : DEFAULT_REFRESH_INTERVAL_MS;
                              const refreshInterval = Math.max(
                                  baseInterval,
                                  discovered.publisherRefreshIntervalMs ?? 0,
                              );
                              return yield* repository.subscribeDiscovered({
                                  feedUrl,
                                  name: discovered.feed.title || feedUrl,
                                  siteUrl: discovered.feed.siteUrl,
                                  faviconUrl: discovered.feed.faviconUrl,
                                  etag: discovered.etag,
                                  lastModified: discovered.lastModified,
                                  publisherRefreshIntervalMs:
                                      discovered.publisherRefreshIntervalMs ??
                                      null,
                                  httpStatus: discovered.httpStatus,
                                  durationMs: Math.max(
                                      0,
                                      completedAt - startedAt,
                                  ),
                                  entries,
                                  historyId: yield* nextId(),
                                  categoryId,
                                  userId,
                                  now: completedAt,
                                  nextRefreshAt: completedAt + refreshInterval,
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
                const subscription = yield* repository.findSubscription(
                    userId,
                    outcome.feedId,
                );
                return CreateSubscriptionResponse.make({
                    subscription,
                    createdFeed: outcome.createdFeed,
                    createdSubscription: outcome.createdSubscription,
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
                const customFeedName = input.customFeedName?.trim() || null;
                if (rulesChanged) {
                    yield* rebuildFilters(
                        userId,
                        feedId,
                        input.categoryId,
                        customFeedName,
                        input.filterRules,
                    );
                } else {
                    yield* repository.updateSubscription(
                        userId,
                        feedId,
                        input.categoryId,
                        customFeedName,
                        now(),
                    );
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

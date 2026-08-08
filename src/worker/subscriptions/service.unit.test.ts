import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
    FeedHttpError,
    FeedNetworkError,
    FeedParseError,
    FeedPolicyError,
    type FeedRefreshError,
    FeedSizeError,
    FeedTimeoutError,
} from '../feeds/errors';
import {
    SubscriptionConflict,
    SubscriptionFeedError,
    SubscriptionInvariantError,
    SubscriptionValidationError,
} from './errors';
import type { SubscriptionRepository } from './repository';
import { MAX_FILTER_REAPPLY_ENTRIES, makeSubscriptionService } from './service';

const baseSubscription = {
    feedId: 21,
    categoryId: 11,
    categoryName: 'Tech',
    feedName: 'Feed',
    customFeedName: null,
    feedUrl: 'https://example.test/feed.xml',
    siteUrl: 'https://example.test/',
    faviconUrl: '/api/images/feeds/21/small',
    faviconIsDark: null,
    entryCount: 2,
    unreadCount: 2,
    isGone: false,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    lastSuccessfulRefreshAt: null,
    lastFailedRefreshAt: null,
    lastErrorClass: null,
    lastErrorMessage: null,
    filterRules: {
        excludeTitle: [],
        excludeContent: [],
        excludeAuthor: [],
    },
    refreshes: [],
};

const repository = (
    overrides: Partial<SubscriptionRepository> = {},
): SubscriptionRepository =>
    ({
        listManagement: () =>
            Effect.succeed({ categories: [], subscriptions: [] }),
        findSubscription: () => Effect.succeed(baseSubscription),
        createCategory: () => Effect.die('unused'),
        findOrCreateCategory: () => Effect.die('unused'),
        updateCategory: () => Effect.die('unused'),
        deleteCategory: () => Effect.die('unused'),
        findFeedByUrl: () => Effect.succeed(null),
        subscribeExisting: () => Effect.succeed(true),
        subscribeDiscovered: () =>
            Effect.succeed({
                feedId: 21,
                createdFeed: true,
                createdSubscription: true,
            }),
        updateSubscription: () => Effect.void,
        unsubscribe: () => Effect.void,
        filterEntryWindow: () =>
            Effect.succeed({
                total: 2,
                throughId: 32,
                filterRevision: 4,
            }),
        listFilterCandidates: () =>
            Effect.succeed([
                {
                    id: 31,
                    title: 'Sponsored post',
                    author: null,
                    contentHtml: null,
                },
                {
                    id: 32,
                    title: 'Ordinary post',
                    author: null,
                    contentHtml: null,
                },
            ]),
        updateSubscriptionWithFilterRebuild: () => Effect.void,
        ...overrides,
    }) as SubscriptionRepository;

describe('subscription management service', () => {
    it('discovers and persists a new feed before returning', async () => {
        const subscribeDiscovered = vi.fn(() =>
            Effect.succeed({
                feedId: 21,
                createdFeed: true,
                createdSubscription: true,
            }),
        );
        const service = makeSubscriptionService({
            repository: repository({ subscribeDiscovered }),
            discoverFeed: () =>
                Effect.succeed({
                    kind: 'updated' as const,
                    finalUrl: 'https://example.test/discovered.xml',
                    etag: '"first"',
                    lastModified: 'Sat, 18 Jul 2026 10:00:00 GMT',
                    httpStatus: 200,
                    feed: {
                        title: 'Discovered feed',
                        description: null,
                        siteUrl: 'https://example.test/',
                        faviconUrl: null,
                        sourceUpdatedAt: null,
                    },
                    entries: [
                        {
                            sourceIdentity: 'entry-1',
                            deduplicationKey: new Uint8Array(32).fill(1),
                            sourceId: 'entry-1',
                            title: 'First post',
                            url: 'https://example.test/posts/1',
                            author: 'Author',
                            publishedAt: 900,
                            sourceUpdatedAt: null,
                            contentHtml: '<p>First post</p>',
                            contentEncodedSize: 17,
                            contentStatus: 'stored' as const,
                            updateMask: {
                                title: true,
                                url: true,
                                author: true,
                                publishedAt: true,
                                sourceUpdatedAt: true,
                                content: true,
                            },
                        },
                    ],
                }),
            generateId: () => Effect.succeed(101),
            now: () => 1_000,
        });

        await expect(
            Effect.runPromise(
                service.createSubscription(7, {
                    feedUrl: 'https://example.test/',
                    categoryId: 11,
                }),
            ),
        ).resolves.toMatchObject({
            subscription: { feedId: 21 },
            createdFeed: true,
        });
        expect(subscribeDiscovered).toHaveBeenCalledWith(
            expect.objectContaining({
                feedUrl: 'https://example.test/discovered.xml',
                name: 'Discovered feed',
                siteUrl: 'https://example.test/',
                faviconUrl: null,
                etag: '"first"',
                lastModified: 'Sat, 18 Jul 2026 10:00:00 GMT',
                httpStatus: 200,
                durationMs: 0,
                historyId: 101,
                categoryId: 11,
                userId: 7,
                now: 1_000,
                nextRefreshAt: 901_000,
                entries: [
                    expect.objectContaining({
                        sourceId: 'entry-1',
                        title: 'First post',
                        content: expect.objectContaining({
                            type: 'stored',
                            html: '<p>First post</p>',
                            hash: expect.any(Uint8Array),
                        }),
                        filteredUserIds: [],
                    }),
                ],
            }),
        );
    });

    it('creates or reuses a category while adding the first feed', async () => {
        const findOrCreateCategory = vi.fn(() =>
            Effect.succeed({
                id: 11,
                name: 'Tech',
                subscriptionCount: 0,
            }),
        );
        const subscribeDiscovered = vi.fn(() =>
            Effect.succeed({
                feedId: 21,
                createdFeed: true,
                createdSubscription: true,
            }),
        );
        const generatedIds = [10, 12];
        const service = makeSubscriptionService({
            repository: repository({
                findOrCreateCategory,
                subscribeDiscovered,
            }),
            discoverFeed: () =>
                Effect.succeed({
                    kind: 'updated' as const,
                    finalUrl: 'https://example.test/feed.xml',
                    etag: null,
                    lastModified: null,
                    httpStatus: 200,
                    feed: {
                        title: 'Feed',
                        description: null,
                        siteUrl: 'https://example.test/',
                        faviconUrl: null,
                        sourceUpdatedAt: null,
                    },
                    entries: [],
                }),
            generateId: () =>
                Effect.succeed(generatedIds.shift() ?? Number.NaN),
            now: () => 1_000,
        });

        await expect(
            Effect.runPromise(
                service.createSubscription(7, {
                    feedUrl: 'https://example.test/feed.xml',
                    categoryName: 'Tech',
                }),
            ),
        ).resolves.toMatchObject({ subscription: { categoryId: 11 } });
        expect(findOrCreateCategory).toHaveBeenCalledWith(10, 7, 'Tech', 1_000);
        expect(subscribeDiscovered).toHaveBeenCalledWith(
            expect.objectContaining({ categoryId: 11 }),
        );
    });

    it.each([
        [
            'invalid URL policy',
            new FeedPolicyError({ reason: 'invalid_url' }),
            'invalid_url',
        ],
        [
            'unsupported document',
            new FeedParseError({ reason: 'unsupported_feed' }),
            'unsupported_feed',
        ],
        [
            'oversized document',
            new FeedSizeError({ limitBytes: 1024 }),
            'feed_too_large',
        ],
        ['network failure', new FeedNetworkError(), 'temporarily_unavailable'],
        [
            'timeout',
            new FeedTimeoutError({ timeoutMs: 15_000 }),
            'temporarily_unavailable',
        ],
        [
            'unresolvable hostname',
            new FeedHttpError({ status: 530, retryable: true }),
            'unresolvable_host',
        ],
        [
            'upstream rate limit',
            new FeedHttpError({ status: 429, retryable: true }),
            'upstream_rate_limited',
        ],
        [
            'upstream server failure',
            new FeedHttpError({ status: 503, retryable: true }),
            'temporarily_unavailable',
        ],
        [
            'missing upstream feed',
            new FeedHttpError({ status: 404, retryable: false }),
            'unsupported_feed',
        ],
    ] satisfies readonly (readonly [
        string,
        FeedRefreshError,
        SubscriptionFeedError['reason'],
    ])[])(
        'maps %s to an actionable subscription failure',
        async (_label, cause, reason) => {
            const service = makeSubscriptionService({
                repository: repository(),
                discoverFeed: () => Effect.fail(cause),
            });

            await expect(
                Effect.runPromise(
                    service.createSubscription(7, {
                        feedUrl: 'https://example.test/feed.xml',
                        categoryId: 11,
                    }),
                ),
            ).rejects.toEqual(new SubscriptionFeedError({ reason }));
        },
    );

    it('reports locally invalid feed URLs before discovery', async () => {
        const discoverFeed = vi.fn(() => Effect.die('unused'));
        const service = makeSubscriptionService({
            repository: repository(),
            discoverFeed,
        });

        await expect(
            Effect.runPromise(
                service.createSubscription(7, {
                    feedUrl: 'http://127.0.0.1/feed.xml',
                    categoryId: 11,
                }),
            ),
        ).rejects.toEqual(new SubscriptionFeedError({ reason: 'invalid_url' }));
        expect(discoverFeed).not.toHaveBeenCalled();
    });

    it('rejects ambiguous or missing category choices', async () => {
        const findFeedByUrl = vi.fn(() => Effect.succeed(null));
        const service = makeSubscriptionService({
            repository: repository({ findFeedByUrl }),
            discoverFeed: () => Effect.die('unused'),
        });

        await expect(
            Effect.runPromise(
                service.createSubscription(7, {
                    feedUrl: 'https://example.test/feed.xml',
                }),
            ),
        ).rejects.toBeInstanceOf(SubscriptionValidationError);
        await expect(
            Effect.runPromise(
                service.createSubscription(7, {
                    feedUrl: 'https://example.test/feed.xml',
                    categoryId: 11,
                    categoryName: 'Tech',
                }),
            ),
        ).rejects.toBeInstanceOf(SubscriptionValidationError);
        expect(findFeedByUrl).not.toHaveBeenCalled();
    });

    it('subscribes to a cached feed while its origin is unavailable', async () => {
        const discoverFeed = vi.fn(() => Effect.die('must not fetch'));
        const subscribeExisting = vi.fn(() => Effect.succeed(false));
        const service = makeSubscriptionService({
            repository: repository({
                findFeedByUrl: () => Effect.succeed(21),
                subscribeExisting,
            }),
            discoverFeed,
            now: () => 1_000,
        });

        await expect(
            Effect.runPromise(
                service.createSubscription(7, {
                    feedUrl: 'example.test/feed.xml',
                    categoryId: 11,
                }),
            ),
        ).resolves.toMatchObject({
            createdFeed: false,
            createdSubscription: false,
        });
        expect(discoverFeed).not.toHaveBeenCalled();
        expect(subscribeExisting).toHaveBeenCalledWith(7, 21, 11, 1_000);
    });

    it('stores an empty custom feed name as null', async () => {
        const updateSubscription = vi.fn(() => Effect.void);
        const service = makeSubscriptionService({
            repository: repository({ updateSubscription }),
            discoverFeed: () => Effect.die('unused'),
            now: () => 2_000,
        });

        await Effect.runPromise(
            service.updateSubscription(7, 21, {
                categoryId: 11,
                customFeedName: '',
                filterRules: baseSubscription.filterRules,
            }),
        );

        expect(updateSubscription).toHaveBeenCalledWith(7, 21, 11, null, 2_000);
    });

    it('atomically stores rules with rebuilt sparse interactions', async () => {
        const updateSubscription = vi.fn(() => Effect.void);
        const updateSubscriptionWithFilterRebuild = vi.fn(() => Effect.void);
        const service = makeSubscriptionService({
            repository: repository({
                updateSubscription,
                updateSubscriptionWithFilterRebuild,
                findSubscription: () =>
                    Effect.succeed({
                        ...baseSubscription,
                        filterRules: {
                            excludeTitle: [],
                            excludeContent: [],
                            excludeAuthor: [],
                        },
                    }),
            }),
            discoverFeed: () => Effect.die('unused'),
            now: () => 2_000,
        });
        const rules = {
            excludeTitle: ['sponsor'],
            excludeContent: [],
            excludeAuthor: [],
        };

        await Effect.runPromise(
            service.updateSubscription(7, 21, {
                categoryId: 11,
                customFeedName: 'My feed',
                filterRules: rules,
            }),
        );

        expect(updateSubscription).not.toHaveBeenCalled();
        expect(updateSubscriptionWithFilterRebuild).toHaveBeenCalledWith(
            7,
            21,
            11,
            'My feed',
            rules,
            4,
            32,
            [31],
            2_000,
        );
    });

    it('does not persist rules after an interrupted scan and rebuilds on retry', async () => {
        const updateSubscription = vi.fn(() => Effect.void);
        const updateSubscriptionWithFilterRebuild = vi.fn(() => Effect.void);
        const listFilterCandidates = vi
            .fn()
            .mockReturnValueOnce(
                Effect.fail(
                    new SubscriptionInvariantError({
                        operation: 'test.interrupted',
                    }),
                ),
            )
            .mockReturnValue(
                Effect.succeed([
                    {
                        id: 32,
                        title: 'Sponsored post',
                        author: null,
                        contentHtml: null,
                    },
                ]),
            );
        const service = makeSubscriptionService({
            repository: repository({
                updateSubscription,
                updateSubscriptionWithFilterRebuild,
                listFilterCandidates,
            }),
            discoverFeed: () => Effect.die('unused'),
            now: () => 2_000,
        });
        const input = {
            categoryId: 11,
            customFeedName: null,
            filterRules: {
                excludeTitle: ['sponsor'],
                excludeContent: [],
                excludeAuthor: [],
            },
        };

        await expect(
            Effect.runPromise(service.updateSubscription(7, 21, input)),
        ).rejects.toBeInstanceOf(SubscriptionInvariantError);
        expect(updateSubscription).not.toHaveBeenCalled();
        expect(updateSubscriptionWithFilterRebuild).not.toHaveBeenCalled();

        await expect(
            Effect.runPromise(service.updateSubscription(7, 21, input)),
        ).resolves.toMatchObject({ subscription: { feedId: 21 } });
        expect(listFilterCandidates).toHaveBeenCalledTimes(2);
        expect(updateSubscriptionWithFilterRebuild).toHaveBeenCalledTimes(1);
    });

    it('rebuilds the full supported maximum within 750 content queries', async () => {
        const listFilterCandidates = vi.fn(
            (
                _userId: number,
                _feedId: number,
                afterId: number,
                throughId: number,
                limit: number,
            ) =>
                Effect.succeed(
                    Array.from(
                        { length: Math.min(limit, throughId - afterId) },
                        (_, index) => ({
                            id: afterId + index + 1,
                            title: 'Ordinary post',
                            author: null,
                            contentHtml: 'Body',
                        }),
                    ),
                ),
        );
        const updateSubscriptionWithFilterRebuild = vi.fn(() => Effect.void);
        const service = makeSubscriptionService({
            repository: repository({
                filterEntryWindow: () =>
                    Effect.succeed({
                        total: MAX_FILTER_REAPPLY_ENTRIES,
                        throughId: MAX_FILTER_REAPPLY_ENTRIES,
                        filterRevision: 4,
                    }),
                listFilterCandidates,
                updateSubscriptionWithFilterRebuild,
            }),
            discoverFeed: () => Effect.die('unused'),
        });

        await Effect.runPromise(
            service.updateSubscription(7, 21, {
                categoryId: 11,
                customFeedName: null,
                filterRules: {
                    excludeTitle: [],
                    excludeContent: ['sponsor'],
                    excludeAuthor: [],
                },
            }),
        );

        expect(listFilterCandidates).toHaveBeenCalledTimes(750);
        expect(listFilterCandidates).toHaveBeenLastCalledWith(
            7,
            21,
            MAX_FILTER_REAPPLY_ENTRIES - 20,
            MAX_FILTER_REAPPLY_ENTRIES,
            20,
            true,
        );
        expect(updateSubscriptionWithFilterRebuild).toHaveBeenCalledTimes(1);
    });

    it('rejects one entry above the supported rebuild maximum before scanning', async () => {
        const listFilterCandidates = vi.fn(() => Effect.die('unused'));
        const updateSubscriptionWithFilterRebuild = vi.fn(() => Effect.void);
        const service = makeSubscriptionService({
            repository: repository({
                filterEntryWindow: () =>
                    Effect.succeed({
                        total: MAX_FILTER_REAPPLY_ENTRIES + 1,
                        throughId: MAX_FILTER_REAPPLY_ENTRIES + 1,
                        filterRevision: 4,
                    }),
                listFilterCandidates,
                updateSubscriptionWithFilterRebuild,
            }),
            discoverFeed: () => Effect.die('unused'),
        });

        await expect(
            Effect.runPromise(
                service.updateSubscription(7, 21, {
                    categoryId: 11,
                    customFeedName: null,
                    filterRules: {
                        excludeTitle: ['sponsor'],
                        excludeContent: [],
                        excludeAuthor: [],
                    },
                }),
            ),
        ).rejects.toEqual(
            new SubscriptionConflict({ reason: 'filter_rebuild_too_large' }),
        );
        expect(listFilterCandidates).not.toHaveBeenCalled();
        expect(updateSubscriptionWithFilterRebuild).not.toHaveBeenCalled();
    });

    it('rejects out-of-bounds filters before changing subscription state', async () => {
        const updateSubscription = vi.fn(() => Effect.void);
        const service = makeSubscriptionService({
            repository: repository({ updateSubscription }),
            discoverFeed: () => Effect.die('unused'),
        });

        await expect(
            Effect.runPromise(
                service.updateSubscription(7, 21, {
                    categoryId: 11,
                    customFeedName: null,
                    filterRules: {
                        excludeTitle: ['a'.repeat(201)],
                        excludeContent: [],
                        excludeAuthor: [],
                    },
                }),
            ),
        ).rejects.toBeInstanceOf(SubscriptionValidationError);
        expect(updateSubscription).not.toHaveBeenCalled();
    });
});

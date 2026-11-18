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
import type { FeedUpdatedResult } from '../feeds/service';
import {
    SubscriptionConflict,
    SubscriptionFeedError,
    SubscriptionInvariantError,
    SubscriptionNotFound,
    SubscriptionValidationError,
} from './errors';
import type { SubscriptionRepository } from './repository';
import {
    MAX_FILTER_REAPPLY_ENTRIES,
    makeSubscriptionService,
    type SubscriptionServiceDependencies,
} from './service';

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
        findSubscriptionSummary: () => Effect.succeed(null),
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

const discoverSingle =
    (
        kind: 'direct' | 'website',
        operation: () => Effect.Effect<FeedUpdatedResult, FeedRefreshError>,
    ): SubscriptionServiceDependencies['discoverFeeds'] =>
    () =>
        operation().pipe(
            Effect.map((result) => ({
                kind,
                candidates: [{ result, identicalFeedUrls: [] }],
            })),
        );
const discoverDirect = (
    operation: () => Effect.Effect<FeedUpdatedResult, FeedRefreshError>,
) => discoverSingle('direct', operation);

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
            discoverFeeds: discoverSingle('website', () =>
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
            ),
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
            discoverFeeds: discoverDirect(() =>
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
            ),
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

    it('returns ambiguous candidates before creating a category or subscription', async () => {
        const findOrCreateCategory = vi.fn(() => Effect.die('must not write'));
        const subscribeDiscovered = vi.fn(() => Effect.die('must not write'));
        const rootUrl = 'https://example.test/feed.xml';
        const sectionUrl = 'https://example.test/news/feed.xml';
        const feedResult = (finalUrl: string, title: string) => ({
            kind: 'updated' as const,
            finalUrl,
            etag: null,
            lastModified: null,
            httpStatus: 200,
            feed: {
                title,
                description: null,
                siteUrl: finalUrl.replace(/feed\.xml$/u, ''),
                faviconUrl: null,
                sourceUpdatedAt: null,
            },
            entries: [],
        });
        const service = makeSubscriptionService({
            repository: repository({
                findOrCreateCategory,
                subscribeDiscovered,
            }),
            discoverFeeds: () =>
                Effect.succeed({
                    kind: 'website' as const,
                    candidates: [
                        {
                            result: feedResult(rootUrl, 'Example'),
                            identicalFeedUrls: [sectionUrl],
                        },
                        {
                            result: feedResult(sectionUrl, 'Example News'),
                            identicalFeedUrls: [rootUrl],
                        },
                    ],
                }),
        });

        await expect(
            Effect.runPromise(
                service.createSubscription(7, {
                    feedUrl: 'https://example.test/news/',
                    categoryName: 'Tech',
                }),
            ),
        ).resolves.toEqual({
            kind: 'selection_required',
            candidates: [
                {
                    title: 'Example',
                    feedUrl: rootUrl,
                    siteUrl: 'https://example.test/',
                    identicalTo: [sectionUrl],
                },
                {
                    title: 'Example News',
                    feedUrl: sectionUrl,
                    siteUrl: 'https://example.test/news/',
                    identicalTo: [rootUrl],
                },
            ],
        });
        expect(findOrCreateCategory).not.toHaveBeenCalled();
        expect(subscribeDiscovered).not.toHaveBeenCalled();
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
                discoverFeeds: discoverDirect(() => Effect.fail(cause)),
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
            discoverFeeds: discoverDirect(discoverFeed),
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
            discoverFeeds: discoverDirect(() => Effect.die('unused')),
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

    it('rejects an already subscribed cached feed without fetching it', async () => {
        const discoverFeed = vi.fn(() => Effect.die('must not fetch'));
        const subscribeExisting = vi.fn(() => Effect.succeed(false));
        const service = makeSubscriptionService({
            repository: repository({
                findFeedByUrl: () => Effect.succeed(21),
                subscribeExisting,
            }),
            discoverFeeds: discoverDirect(discoverFeed),
            now: () => 1_000,
        });

        await expect(
            Effect.runPromise(
                service.createSubscription(7, {
                    feedUrl: 'example.test/feed.xml',
                    categoryId: 11,
                }),
            ),
        ).rejects.toEqual(
            new SubscriptionConflict({ reason: 'already_subscribed' }),
        );
        expect(discoverFeed).not.toHaveBeenCalled();
        expect(subscribeExisting).toHaveBeenCalledWith(7, 21, 11, 1_000);
    });

    it('rejects an existing subscription found after discovery', async () => {
        const subscribeDiscovered = vi.fn(() =>
            Effect.succeed({
                feedId: 21,
                createdFeed: false,
                createdSubscription: false,
            }),
        );
        const service = makeSubscriptionService({
            repository: repository({ subscribeDiscovered }),
            discoverFeeds: discoverDirect(() =>
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
            ),
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
        ).rejects.toEqual(
            new SubscriptionConflict({ reason: 'already_subscribed' }),
        );
        expect(subscribeDiscovered).toHaveBeenCalledWith(
            expect.objectContaining({
                feedUrl: 'https://example.test/feed.xml',
                categoryId: 11,
                userId: 7,
            }),
        );
    });

    it('stores an empty custom feed name as null', async () => {
        const updateSubscription = vi.fn(() => Effect.void);
        const service = makeSubscriptionService({
            repository: repository({ updateSubscription }),
            discoverFeeds: discoverDirect(() => Effect.die('unused')),
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
            discoverFeeds: discoverDirect(() => Effect.die('unused')),
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
            discoverFeeds: discoverDirect(() => Effect.die('unused')),
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
            discoverFeeds: discoverDirect(() => Effect.die('unused')),
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
            discoverFeeds: discoverDirect(() => Effect.die('unused')),
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
            discoverFeeds: discoverDirect(() => Effect.die('unused')),
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

describe('favicon scheduling on subscribe', () => {
    const discoveredFeed = discoverDirect(() =>
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
    );
    const subscribe = (
        dependencies: Partial<SubscriptionServiceDependencies>,
        feedUrl = 'https://example.test/feed.xml',
    ) =>
        Effect.runPromise(
            makeSubscriptionService({
                repository: repository(),
                discoverFeeds: discoveredFeed,
                generateId: () => Effect.succeed(101),
                now: () => 1_000,
                ...dependencies,
            }).createSubscription(7, { feedUrl, categoryId: 11 }),
        );

    it('schedules favicon discovery for a newly created feed', async () => {
        const scheduleFavicon = vi.fn(() => Promise.resolve(true));

        await subscribe({ scheduleFavicon });

        expect(scheduleFavicon).toHaveBeenCalledExactlyOnceWith(21);
    });

    it('does not schedule favicon discovery for an existing feed', async () => {
        const scheduleFavicon = vi.fn(() => Promise.resolve(true));

        // Another request inserted the same feed between lookup and commit.
        await subscribe({
            scheduleFavicon,
            repository: repository({
                subscribeDiscovered: () =>
                    Effect.succeed({
                        feedId: 21,
                        createdFeed: false,
                        createdSubscription: true,
                    }),
            }),
        });
        // The feed was already known before discovery.
        await subscribe({
            scheduleFavicon,
            repository: repository({ findFeedByUrl: () => Effect.succeed(21) }),
        });

        expect(scheduleFavicon).not.toHaveBeenCalled();
    });

    it('keeps the committed subscription when scheduling fails', async () => {
        const scheduleFavicon = vi.fn(() =>
            Promise.reject(new Error('queue unavailable')),
        );

        await expect(subscribe({ scheduleFavicon })).resolves.toMatchObject({
            kind: 'created',
            subscription: { feedId: 21 },
            createdFeed: true,
        });
        expect(scheduleFavicon).toHaveBeenCalledOnce();
    });
});

describe('protocol subscription helpers', () => {
    const feedResult = (finalUrl: string, title: string) => ({
        kind: 'updated' as const,
        finalUrl,
        etag: null,
        lastModified: null,
        httpStatus: 200,
        feed: {
            title,
            description: null,
            siteUrl: null,
            faviconUrl: null,
            sourceUpdatedAt: null,
        },
        entries: [],
    });

    it('subscribes to the first advertised feed instead of asking', async () => {
        const subscribeDiscovered = vi.fn(() =>
            Effect.succeed({
                feedId: 21,
                createdFeed: true,
                createdSubscription: true,
            }),
        );
        const findOrCreateCategory = vi.fn(() =>
            Effect.succeed({
                id: 12,
                name: 'Newsletters',
                subscriptionCount: 0,
            }),
        );
        const service = makeSubscriptionService({
            repository: repository({
                findOrCreateCategory,
                subscribeDiscovered,
            }),
            discoverFeeds: () =>
                Effect.succeed({
                    kind: 'website' as const,
                    candidates: [
                        {
                            result: feedResult(
                                'https://example.test/feed.xml',
                                'Example',
                            ),
                            identicalFeedUrls: [],
                        },
                        {
                            result: feedResult(
                                'https://example.test/comments.xml',
                                'Comments',
                            ),
                            identicalFeedUrls: [],
                        },
                    ],
                }),
            generateId: () => Effect.succeed(12),
            now: () => 1_000,
        });

        await expect(
            Effect.runPromise(
                service.subscribeFirstCandidate(7, {
                    feedUrl: 'https://example.test/',
                    categoryName: 'Newsletters',
                }),
            ),
        ).resolves.toEqual({
            feedId: 21,
            createdFeed: true,
            createdSubscription: true,
        });
        expect(findOrCreateCategory).toHaveBeenCalledWith(
            12,
            7,
            'Newsletters',
            1_000,
        );
        expect(subscribeDiscovered).toHaveBeenCalledWith(
            expect.objectContaining({
                feedUrl: 'https://example.test/feed.xml',
                categoryId: 12,
            }),
        );
    });

    const summary = {
        feedId: 21,
        categoryId: 11,
        categoryName: 'Tech',
        feedName: 'Feed',
        customFeedName: null,
    };

    it('reports an existing subscription without creating its category', async () => {
        const findOrCreateCategory = vi.fn(() => Effect.die('must not create'));
        const subscribeExisting = vi.fn(() => Effect.die('must not write'));
        const service = makeSubscriptionService({
            repository: repository({
                findFeedByUrl: () => Effect.succeed(21),
                findSubscriptionSummary: () => Effect.succeed(summary),
                findOrCreateCategory,
                subscribeExisting,
            }),
            discoverFeeds: () => Effect.die('must not fetch'),
        });

        await expect(
            Effect.runPromise(
                service.subscribeFirstCandidate(7, {
                    feedUrl: 'https://example.test/feed.xml',
                    categoryName: 'Uncategorized',
                }),
            ),
        ).resolves.toEqual({
            feedId: 21,
            createdFeed: false,
            createdSubscription: false,
        });
        expect(findOrCreateCategory).not.toHaveBeenCalled();
        expect(subscribeExisting).not.toHaveBeenCalled();
    });

    it('stops before persisting when a redirect lands on a followed feed', async () => {
        const findOrCreateCategory = vi.fn(() => Effect.die('must not create'));
        const subscribeDiscovered = vi.fn(() => Effect.die('must not write'));
        const findFeedByUrl = vi.fn((url: string) =>
            Effect.succeed(url === 'https://example.test/feed.xml' ? 21 : null),
        );
        const service = makeSubscriptionService({
            repository: repository({
                findFeedByUrl,
                findSubscriptionSummary: () => Effect.succeed(summary),
                findOrCreateCategory,
                subscribeDiscovered,
            }),
            discoverFeeds: discoverDirect(() =>
                Effect.succeed(
                    feedResult('https://example.test/feed.xml', 'Feed'),
                ),
            ),
        });

        await expect(
            Effect.runPromise(
                service.subscribeFirstCandidate(7, {
                    feedUrl: 'http://example.test/rss',
                    categoryName: 'Uncategorized',
                }),
            ),
        ).resolves.toEqual({
            feedId: 21,
            createdFeed: false,
            createdSubscription: false,
        });
        expect(findOrCreateCategory).not.toHaveBeenCalled();
        expect(subscribeDiscovered).not.toHaveBeenCalled();
    });

    it('finds a subscription by id or by normalized feed URL', async () => {
        const findFeedByUrl = vi.fn((url: string) =>
            Effect.succeed(url === 'https://example.test/feed.xml' ? 21 : null),
        );
        const service = makeSubscriptionService({
            repository: repository({
                findFeedByUrl,
                findSubscriptionSummary: (_userId, feedId) =>
                    Effect.succeed(feedId === 21 ? summary : null),
            }),
            discoverFeeds: () => Effect.die('unused'),
        });
        const find = (target: { feedId: number } | { feedUrl: string }) =>
            Effect.runPromise(service.findSubscribedFeed(7, target));

        await expect(find({ feedId: 21 })).resolves.toEqual(summary);
        await expect(find({ feedId: 22 })).resolves.toBeNull();
        await expect(
            find({ feedUrl: 'example.test/feed.xml' }),
        ).resolves.toEqual(summary);
        await expect(find({ feedUrl: 'not a url' })).resolves.toBeNull();
    });

    it('renames and moves a subscription into a created folder, keeping filters', async () => {
        const findOrCreateCategory = vi.fn(() =>
            Effect.succeed({
                id: 12,
                name: 'Newsletters',
                subscriptionCount: 0,
            }),
        );
        const updateSubscription = vi.fn(() => Effect.void);
        const updateSubscriptionWithFilterRebuild = vi.fn(() =>
            Effect.die('must not rebuild'),
        );
        const service = makeSubscriptionService({
            repository: repository({
                findSubscriptionSummary: () => Effect.succeed(summary),
                findOrCreateCategory,
                updateSubscription,
                updateSubscriptionWithFilterRebuild,
            }),
            discoverFeeds: () => Effect.die('unused'),
            generateId: () => Effect.succeed(12),
            now: () => 2_000,
        });

        await Effect.runPromise(
            service.editSubscription(7, 21, {
                categoryName: 'Newsletters',
                customFeedName: ' Acme Weekly ',
            }),
        );
        expect(findOrCreateCategory).toHaveBeenCalledWith(
            12,
            7,
            'Newsletters',
            2_000,
        );
        expect(updateSubscription).toHaveBeenCalledWith(
            7,
            21,
            12,
            'Acme Weekly',
            2_000,
        );

        updateSubscription.mockClear();
        await Effect.runPromise(service.editSubscription(7, 21, {}));
        expect(updateSubscription).not.toHaveBeenCalled();
    });

    it("does not pin a custom name equal to the feed's own title", async () => {
        const updateSubscription = vi.fn(() => Effect.void);
        const service = makeSubscriptionService({
            repository: repository({
                findSubscriptionSummary: () =>
                    Effect.succeed({ ...summary, customFeedName: 'Old' }),
                updateSubscription,
            }),
            discoverFeeds: () => Effect.die('unused'),
            now: () => 3_000,
        });

        await Effect.runPromise(
            service.editSubscription(7, 21, { customFeedName: 'Feed' }),
        );
        expect(updateSubscription).toHaveBeenCalledWith(7, 21, 11, null, 3_000);
    });

    it('fails to edit a feed the user does not follow', async () => {
        const service = makeSubscriptionService({
            repository: repository(),
            discoverFeeds: () => Effect.die('unused'),
        });
        await expect(
            Effect.runPromise(service.editSubscription(7, 21, {})),
        ).rejects.toEqual(new SubscriptionNotFound());
    });
});

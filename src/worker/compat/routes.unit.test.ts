import { Effect } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import { AuthenticationFailed } from '../auth/errors';
import type { AuthService } from '../auth/service';
import { SubscriptionRateLimited } from '../subscriptions/errors';
import type { SubscriptionService } from '../subscriptions/service';
import { CompatibilityRateLimited } from './errors';
import {
    type CompatibilityRepository,
    MAX_GOOGLE_CONTENT_ITEMS,
} from './repository';
import {
    type CompatibilityRouteDependencies,
    type CompatibilityRuntime,
    registerCompatibilityRoutes,
} from './routes';

const authentication = {
    tokenId: 91,
    user: {
        id: 72,
        username: 'owner',
        displayName: 'Owner',
        isAdmin: false,
    },
    scopes: ['google-reader', 'fever'] as const,
};

const makeHarness = (overrides: {
    readonly service?: Partial<AuthService>;
    readonly repository?: Partial<CompatibilityRepository>;
    readonly subscriptions?: Partial<CompatibilityRuntime['subscriptions']>;
    readonly loginRateLimit?: CompatibilityRouteDependencies['loginRateLimit'];
    readonly syncRateLimit?: CompatibilityRouteDependencies['syncRateLimit'];
}) => {
    const authenticateAppToken = vi.fn(() => Effect.succeed(authentication));
    const authenticateAppTokenCredential = vi.fn((input) =>
        input.plaintextToken === 'bad'
            ? Effect.fail(new AuthenticationFailed())
            : Effect.succeed(authentication),
    );
    const authenticateFeverApiKey = vi.fn((apiKey) =>
        apiKey === '00000000000000000000000000000000'
            ? Effect.succeed(authentication)
            : Effect.fail(new AuthenticationFailed()),
    );
    const repository: CompatibilityRepository = {
        getProfile: () =>
            Effect.succeed({
                id: 72,
                username: 'owner',
                email: 'owner@example.test',
                displayName: 'Owner',
            }),
        listCategories: () => Effect.succeed([{ id: 7, name: 'News' }]),
        listSubscriptions: () =>
            Effect.succeed([
                {
                    feedId: 8,
                    categoryId: 7,
                    categoryName: 'News',
                    title: 'Feed',
                    feedUrl: 'https://example.test/feed.xml',
                    siteUrl: 'https://example.test',
                    faviconUrl: 'https://upstream.example/private-icon.png',
                    lastSuccessfulRefreshAt: 1_700_000_000_000,
                },
            ]),
        listItemIds: (_userId, filter) =>
            Effect.succeed(filter === 'starred' ? [4_660] : [4_660, 4_661]),
        findEntries: () =>
            Effect.succeed([
                {
                    id: 4_660,
                    feedId: 8,
                    title: 'Item',
                    url: 'https://example.test/item',
                    author: 'Author',
                    publishedAt: 1_700_000_000_123,
                    updatedAt: 1_700_000_001_000,
                    feedName: 'Feed',
                    contentHtml: '<p>Item</p>',
                    read: false,
                    starredAt: null,
                },
            ]),
        listFeverItems: () =>
            Effect.succeed({
                total: 1,
                entries: [
                    {
                        id: 4_660,
                        feedId: 8,
                        title: 'Item',
                        url: 'https://example.test/item',
                        author: 'Author',
                        publishedAt: 1_700_000_000_123,
                        updatedAt: 1_700_000_001_000,
                        feedName: 'Feed',
                        contentHtml: '<p>Item</p>',
                        read: false,
                        starredAt: null,
                    },
                ],
            }),
        setRead: () =>
            Effect.succeed({
                entryId: 4_660,
                feedId: 8,
                read: true,
                readChangedAt: 1,
                starred: false,
                starredAt: null,
                archived: false,
                archivedAt: null,
            }),
        setStarred: () =>
            Effect.succeed({
                entryId: 4_660,
                feedId: 8,
                read: false,
                readChangedAt: null,
                starred: true,
                starredAt: 1,
                archived: false,
                archivedAt: null,
            }),
        ...overrides.repository,
    };
    const runtime: CompatibilityRuntime = {
        auth: {
            config: {} as AuthConfig,
            service: {
                authenticateAppToken,
                authenticateAppTokenCredential,
                authenticateFeverApiKey,
                ...overrides.service,
            } as AuthService,
        },
        repository,
        subscriptions: {
            service: {} as SubscriptionService,
            limitFeedAdd: () => Effect.void,
            ...overrides.subscriptions,
        },
        now: () => 1_800_000_000_000,
    };
    const rateKeys: string[] = [];
    const loginRateKeys: string[] = [];
    const syncRateKeys: string[] = [];
    const app = registerCompatibilityRoutes(new Hono<{ Bindings: Env }>(), {
        runtimeFactory: () => Effect.succeed(runtime),
        loginRateLimit: (env, key) => {
            rateKeys.push(key);
            loginRateKeys.push(key);
            return overrides.loginRateLimit?.(env, key) ?? Effect.void;
        },
        syncRateLimit: (env, key) => {
            rateKeys.push(key);
            syncRateKeys.push(key);
            return overrides.syncRateLimit?.(env, key) ?? Effect.void;
        },
    });
    return {
        app,
        authenticateAppToken,
        authenticateAppTokenCredential,
        authenticateFeverApiKey,
        rateKeys,
        loginRateKeys,
        syncRateKeys,
    };
};

const formRequest = (body: URLSearchParams): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
});

describe('compatibility protocol routes', () => {
    it('ClientLogin validates but never creates a Google credential', async () => {
        const harness = makeHarness({});
        const response = await harness.app.request(
            '/api/reader/accounts/ClientLogin',
            formRequest(
                new URLSearchParams({ Email: 'owner', Passwd: 'opaque-token' }),
            ),
            {} as Env,
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(
            'SID=opaque-token\nLSID=opaque-token\nAuth=opaque-token\n',
        );
        expect(harness.authenticateAppToken).toHaveBeenCalledWith({
            username: 'owner',
            plaintextToken: 'opaque-token',
            requiredScope: 'google-reader',
        });
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(harness.rateKeys).toEqual([
            'compat:google:pre-auth:local-development',
        ]);
        expect(harness.loginRateKeys).toEqual(harness.rateKeys);
        expect(harness.syncRateKeys).toEqual([]);
    });

    it('rejects oversized forms with a sanitized protocol response', async () => {
        const harness = makeHarness({});
        const response = await harness.app.request(
            '/api/reader/accounts/ClientLogin',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                },
                body: `Email=owner&Passwd=${'x'.repeat(64 * 1_024)}`,
            },
            {} as Env,
        );

        expect(response.status).toBe(413);
        expect(await response.text()).toBe('Error=BadRequest\n');
        expect(harness.authenticateAppToken).not.toHaveBeenCalled();
    });

    it('rate-limits invalid Google credentials by IP before verification', async () => {
        const harness = makeHarness({
            syncRateLimit: () => Effect.fail(new CompatibilityRateLimited()),
        });
        const response = await harness.app.request(
            '/api/reader/reader/api/0/user-info',
            {
                headers: {
                    Authorization: 'GoogleLogin auth=bad',
                    'CF-Connecting-IP': '203.0.113.20',
                },
            },
            {} as Env,
        );

        expect(response.status).toBe(429);
        expect(await response.text()).toBe('Error=RateLimited\n');
        expect(harness.rateKeys).toEqual([
            'compat:google:pre-auth:203.0.113.20',
        ]);
        expect(harness.authenticateAppTokenCredential).not.toHaveBeenCalled();
        expect(harness.loginRateKeys).toEqual([]);
        expect(harness.syncRateKeys).toEqual(harness.rateKeys);
    });

    it('rate-limits invalid Fever credentials by IP before verification', async () => {
        const harness = makeHarness({
            syncRateLimit: () => Effect.fail(new CompatibilityRateLimited()),
        });
        const response = await harness.app.request(
            '/api/fever/',
            {
                ...formRequest(
                    new URLSearchParams({
                        api_key: 'ffffffffffffffffffffffffffffffff',
                    }),
                ),
                headers: {
                    'CF-Connecting-IP': '203.0.113.21',
                    'content-type': 'application/x-www-form-urlencoded',
                },
            },
            {} as Env,
        );

        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ api_version: 3, auth: 1 });
        expect(harness.rateKeys).toEqual([
            'compat:fever:pre-auth:203.0.113.21',
        ]);
        expect(harness.authenticateFeverApiKey).not.toHaveBeenCalled();
        expect(harness.loginRateKeys).toEqual([]);
        expect(harness.syncRateKeys).toEqual(harness.rateKeys);
    });

    it('routes Reeder bursts around the strict login limiter', async () => {
        const harness = makeHarness({
            loginRateLimit: () => Effect.fail(new CompatibilityRateLimited()),
            syncRateLimit: () => Effect.void,
        });
        const request = () =>
            harness.app.request(
                '/api/reader/reader/api/0/stream/items/contents',
                {
                    ...formRequest(new URLSearchParams({ i: '4660' })),
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                        Authorization: 'GoogleLogin auth=opaque-token',
                    },
                },
                {} as Env,
            );

        const responses = await Promise.all(
            Array.from({ length: 25 }, () => request()),
        );

        expect(responses.map(({ status }) => status)).toEqual(
            Array.from({ length: 25 }, () => 200),
        );
        expect(harness.loginRateKeys).toEqual([]);
        expect(harness.syncRateKeys).toHaveLength(50);
    });

    it.each([
        {
            name: 'user info',
            path: '/api/reader/reader/api/0/user-info',
            body: undefined,
        },
        {
            name: 'token',
            path: '/api/reader/reader/api/0/token',
            body: undefined,
        },
        {
            name: 'subscription list',
            path: '/api/reader/reader/api/0/subscription/list',
            body: undefined,
        },
        {
            name: 'tag list',
            path: '/api/reader/reader/api/0/tag/list?output=json',
            body: undefined,
        },
        {
            name: 'item IDs',
            path: '/api/reader/reader/api/0/stream/items/ids',
            body: undefined,
        },
        {
            name: 'item contents',
            path: '/api/reader/reader/api/0/stream/items/contents',
            body: new URLSearchParams({ i: '4660' }),
        },
        {
            name: 'tag edits',
            path: '/api/reader/reader/api/0/edit-tag',
            body: new URLSearchParams({
                i: '4660',
                a: 'user/-/state/com.google/read',
            }),
        },
    ])(
        'applies IP then token limits to protected Google $name',
        async ({ path, body }) => {
            const harness = makeHarness({});
            const response = await harness.app.request(
                path,
                {
                    ...(body === undefined ? {} : { method: 'POST', body }),
                    headers: {
                        Authorization: 'GoogleLogin auth=opaque-token',
                        'CF-Connecting-IP': '203.0.113.22',
                        ...(body === undefined
                            ? {}
                            : {
                                  'content-type':
                                      'application/x-www-form-urlencoded',
                              }),
                    },
                },
                {} as Env,
            );

            expect(response.status).toBe(200);
            expect(harness.rateKeys).toEqual([
                'compat:google:pre-auth:203.0.113.22',
                'compat:google:token:91',
            ]);
            expect(harness.loginRateKeys).toEqual([]);
            expect(harness.syncRateKeys).toEqual(harness.rateKeys);
            expect(harness.authenticateAppTokenCredential).toHaveBeenCalledWith(
                {
                    plaintextToken: 'opaque-token',
                    requiredScope: 'google-reader',
                },
            );
        },
    );

    it('keeps Google subscription favicon URLs empty', async () => {
        const harness = makeHarness({});
        const response = await harness.app.request(
            '/api/reader/reader/api/0/subscription/list',
            {
                headers: {
                    Authorization: 'GoogleLogin auth=opaque-token',
                },
            },
            {} as Env,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            subscriptions: [{ id: 'feed/8', iconUrl: '' }],
        });
    });

    it('lists Google tags whose label IDs match subscription categories', async () => {
        const harness = makeHarness({});
        const request = (path: string) =>
            harness.app.request(
                path,
                {
                    headers: {
                        Authorization: 'GoogleLogin auth=opaque-token',
                    },
                },
                {} as Env,
            );

        const response = await request(
            '/api/reader/reader/api/0/tag/list?output=json',
        );
        const subscriptions = await request(
            '/api/reader/reader/api/0/subscription/list?output=json',
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toBe(
            'application/json; charset=UTF-8',
        );
        expect(await response.json()).toEqual({
            tags: [
                { id: 'user/72/state/com.google/starred' },
                { id: 'user/72/label/News', label: 'News', type: 'folder' },
            ],
        });
        expect(await subscriptions.json()).toMatchObject({
            subscriptions: [
                { categories: [{ id: 'user/72/label/News', label: 'News' }] },
            ],
        });

        const denied = await harness.app.request(
            '/api/reader/reader/api/0/tag/list',
            { headers: { Authorization: 'GoogleLogin auth=bad' } },
            {} as Env,
        );
        expect(denied.status).toBe(403);
        expect(await denied.text()).toBe('Error=InvalidAuthToken\n');
    });

    it('accepts NetNewsWire content batches up to the item cap', async () => {
        const findEntries = vi.fn(() => Effect.succeed([]));
        const harness = makeHarness({ repository: { findEntries } });
        const request = (count: number) => {
            const body = new URLSearchParams({
                T: 'opaque-token',
                output: 'json',
            });
            for (let id = 1; id <= count; id += 1) {
                body.append('i', String(id));
            }
            return harness.app.request(
                '/api/reader/reader/api/0/stream/items/contents',
                {
                    ...formRequest(body),
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                        Authorization: 'GoogleLogin auth=opaque-token',
                    },
                },
                {} as Env,
            );
        };

        expect((await request(MAX_GOOGLE_CONTENT_ITEMS)).status).toBe(200);
        expect(findEntries).toHaveBeenCalledTimes(1);
        const rejected = await request(MAX_GOOGLE_CONTENT_ITEMS + 1);
        expect(rejected.status).toBe(400);
        expect(findEntries).toHaveBeenCalledTimes(1);
    });

    it('serves Google JSON content and text authentication errors', async () => {
        const harness = makeHarness({});
        const response = await harness.app.request(
            '/api/reader/reader/api/0/stream/items/contents',
            {
                ...formRequest(new URLSearchParams({ i: '4660' })),
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    Authorization: 'GoogleLogin auth=opaque-token',
                },
            },
            {} as Env,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            id: 'user/72/state/com.google/reading-list',
            items: [
                {
                    id: 'tag:google.com,2005:reader/item/0000000000001234',
                    categories: ['user/72/state/com.google/reading-list'],
                    content: { content: '<p>Item</p>' },
                    summary: { content: '<p>Item</p>' },
                },
            ],
            updated: 1_800_000_000,
        });

        const denied = await harness.app.request(
            '/api/reader/reader/api/0/user-info',
            { headers: { Authorization: 'GoogleLogin auth=bad' } },
            {} as Env,
        );
        expect(denied.status).toBe(403);
        expect(await denied.text()).toBe('Error=InvalidAuthToken\n');
    });

    it('keeps Fever GET probes unauthenticated and rejects URL credentials', async () => {
        const harness = makeHarness({});
        const key = '00000000000000000000000000000000';

        for (const [path, request] of [
            ['/api/fever/?api', undefined],
            [`/api/fever/?api_key=${key}`, undefined],
            [
                `/api/fever/?api_key=${key}`,
                formRequest(new URLSearchParams({ api_key: key })),
            ],
        ] as const) {
            const response = await harness.app.request(
                path,
                request,
                {} as Env,
            );
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ api_version: 3, auth: 0 });
        }

        expect(harness.authenticateFeverApiKey).not.toHaveBeenCalled();
    });

    it('supports Fever v3 shapes, cursor conventions, and sparse marks', async () => {
        const setStarred = vi.fn(() =>
            Effect.succeed({
                entryId: 4_660,
                feedId: 8,
                read: false,
                readChangedAt: null,
                starred: true,
                starredAt: 1,
                archived: false,
                archivedAt: null,
            }),
        );
        const listFeverItems = vi.fn(() =>
            Effect.succeed({ total: 1, entries: [] }),
        );
        const harness = makeHarness({
            repository: { setStarred, listFeverItems },
        });
        const key = '00000000000000000000000000000000';
        const response = await harness.app.request(
            '/api/fever/?groups&feeds&items&since_id=10&unread_item_ids&saved_item_ids',
            formRequest(
                new URLSearchParams({
                    api_key: key,
                    mark: 'item',
                    id: '4660',
                    as: 'saved',
                }),
            ),
            {} as Env,
        );
        const body = await response.json<Record<string, unknown>>();

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
            api_version: 3,
            auth: 1,
            groups: [{ id: 7, title: 'News' }],
            feeds: [{ id: 8, title: 'Feed', is_spark: 0 }],
            feeds_groups: [{ group_id: 7, feed_ids: '8' }],
            items: [],
            total_items: 1,
            unread_item_ids: '4660,4661',
            saved_item_ids: '4660',
        });
        expect(listFeverItems).toHaveBeenCalledWith(72, { sinceId: 10 });
        expect(setStarred).toHaveBeenCalledWith(
            72,
            4_660,
            true,
            1_800_000_000_000,
        );
        expect(harness.rateKeys).toEqual([
            'compat:fever:pre-auth:local-development',
            'compat:fever:token:91',
        ]);

        const denied = await harness.app.request(
            '/api/fever/',
            formRequest(
                new URLSearchParams({
                    api_key: 'ffffffffffffffffffffffffffffffff',
                }),
            ),
            {} as Env,
        );
        expect(await denied.json()).toEqual({ api_version: 3, auth: 0 });
    });
});

describe('Google Reader subscription writes', () => {
    const googleForm = (
        path: string,
        body: Record<string, string>,
        token: string | null = 'opaque-token',
    ): [string, RequestInit, Env] => [
        `/api/reader/reader/api/0/subscription/${path}`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                ...(token === null
                    ? {}
                    : { Authorization: `GoogleLogin auth=${token}` }),
            },
            body: new URLSearchParams(body),
        },
        {} as Env,
    ];

    /** In-memory stand-in for the subscription service and its storage. */
    const makeSubscriptionFake = () => {
        const categories = new Map<number, string>([[7, 'News']]);
        const feeds = new Map<string, number>([
            ['https://example.test/feed.xml', 8],
        ]);
        const subscriptions = new Map<
            number,
            { categoryId: number; customFeedName: string | null }
        >([[8, { categoryId: 7, customFeedName: null }]]);
        let nextId = 100;
        const categoryId = (name: string) => {
            for (const [id, existing] of categories) {
                if (existing.toLowerCase() === name.toLowerCase()) return id;
            }
            const id = nextId++;
            categories.set(id, name);
            return id;
        };
        const subscribeFirstCandidate = vi.fn(
            (
                _userId: number,
                input: { feedUrl: string; categoryName?: string },
            ) => {
                let feedId = feeds.get(input.feedUrl);
                const createdFeed = feedId === undefined;
                if (feedId === undefined) {
                    feedId = nextId++;
                    feeds.set(input.feedUrl, feedId);
                }
                const createdSubscription = !subscriptions.has(feedId);
                if (createdSubscription) {
                    subscriptions.set(feedId, {
                        categoryId: categoryId(input.categoryName ?? ''),
                        customFeedName: null,
                    });
                }
                return Effect.succeed({
                    feedId,
                    createdFeed,
                    createdSubscription,
                });
            },
        );
        const editSubscription = vi.fn(
            (
                _userId: number,
                feedId: number,
                input: {
                    customFeedName?: string | null;
                    categoryName?: string;
                },
            ) =>
                Effect.sync(() => {
                    const current = subscriptions.get(feedId);
                    if (current === undefined) throw new Error('missing');
                    if (input.categoryName !== undefined) {
                        current.categoryId = categoryId(input.categoryName);
                    }
                    if (input.customFeedName !== undefined) {
                        current.customFeedName = input.customFeedName;
                    }
                }),
        );
        const unsubscribe = vi.fn((_userId: number, feedId: number) =>
            Effect.sync(() => {
                subscriptions.delete(feedId);
            }),
        );
        const limitFeedAdd = vi.fn(
            (): Effect.Effect<void, SubscriptionRateLimited> => Effect.void,
        );
        const listSubscriptions = () =>
            Effect.succeed(
                [...subscriptions].map(([feedId, subscription]) => {
                    const feedUrl =
                        [...feeds].find(([, id]) => id === feedId)?.[0] ?? '';
                    return {
                        feedId,
                        categoryId: subscription.categoryId,
                        categoryName:
                            categories.get(subscription.categoryId) ?? '',
                        title: subscription.customFeedName ?? 'Feed',
                        feedUrl,
                        siteUrl: '',
                        faviconUrl: '',
                        lastSuccessfulRefreshAt: null,
                    };
                }),
            );
        const harness = makeHarness({
            repository: { listSubscriptions },
            subscriptions: {
                service: {
                    subscribeFirstCandidate,
                    editSubscription,
                    unsubscribe,
                } as unknown as SubscriptionService,
                limitFeedAdd,
            },
        });
        return {
            ...harness,
            categories,
            subscriptions,
            subscribeFirstCandidate,
            editSubscription,
            unsubscribe,
            limitFeedAdd,
        };
    };

    it('quickadd subscribes to a feed URL and returns its stream id', async () => {
        const fake = makeSubscriptionFake();
        const response = await fake.app.request(
            ...googleForm('quickadd', {
                quickadd: 'https://news.example/atom.xml',
            }),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            numResults: 1,
            query: 'https://news.example/atom.xml',
            streamId: 'feed/100',
            streamName: 'Feed',
        });
        expect(fake.limitFeedAdd).toHaveBeenCalledWith(72);
        expect(fake.subscribeFirstCandidate).toHaveBeenCalledWith(72, {
            feedUrl: 'https://news.example/atom.xml',
            categoryName: 'Uncategorized',
        });
        expect(fake.authenticateAppTokenCredential).toHaveBeenCalledWith({
            plaintextToken: 'opaque-token',
            requiredScope: 'google-reader',
        });
        expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('subscribe files a new feed under a title in a newly created folder', async () => {
        const fake = makeSubscriptionFake();
        const response = await fake.app.request(
            ...googleForm('edit', {
                ac: 'subscribe',
                s: 'feed/https://newsletters.example/acme.xml',
                t: 'Acme Weekly',
                a: 'user/-/label/Newsletters',
            }),
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('OK');
        expect(fake.limitFeedAdd).toHaveBeenCalledWith(72);
        expect(fake.subscribeFirstCandidate).toHaveBeenCalledWith(72, {
            feedUrl: 'https://newsletters.example/acme.xml',
            categoryName: 'Newsletters',
        });
        const folderId = [...fake.categories].find(
            ([, name]) => name === 'Newsletters',
        )?.[0];
        expect(folderId).toBeDefined();
        expect([...fake.subscriptions.values()]).toContainEqual({
            categoryId: folderId,
            customFeedName: 'Acme Weekly',
        });
    });

    it('subscribe is idempotent for a feed URL that is already followed', async () => {
        const fake = makeSubscriptionFake();
        const request = () =>
            fake.app.request(
                ...googleForm('edit', {
                    ac: 'subscribe',
                    s: 'feed/https://example.test/feed.xml',
                    t: 'Renamed',
                    a: 'user/-/label/Newsletters',
                }),
            );

        expect(await (await request()).text()).toBe('OK');
        expect(await (await request()).text()).toBe('OK');

        expect(fake.subscribeFirstCandidate).not.toHaveBeenCalled();
        expect(fake.limitFeedAdd).not.toHaveBeenCalled();
        expect(fake.subscriptions.size).toBe(1);
        expect(fake.subscriptions.get(8)).toEqual({
            categoryId: [...fake.categories].find(
                ([, name]) => name === 'Newsletters',
            )?.[0],
            customFeedName: 'Renamed',
        });
    });

    it('unsubscribe removes a feed by URL or id and tolerates unknown feeds', async () => {
        const fake = makeSubscriptionFake();
        const byUrl = await fake.app.request(
            ...googleForm('edit', {
                ac: 'unsubscribe',
                s: 'feed/https://example.test/feed.xml',
            }),
        );
        expect(await byUrl.text()).toBe('OK');
        expect(fake.unsubscribe).toHaveBeenCalledWith(72, 8);
        expect(fake.subscriptions.size).toBe(0);

        const again = await fake.app.request(
            ...googleForm('edit', { ac: 'unsubscribe', s: 'feed/8' }),
        );
        expect(await again.text()).toBe('OK');
        expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('edit renames and moves an existing subscription', async () => {
        const fake = makeSubscriptionFake();
        const response = await fake.app.request(
            ...googleForm('edit', {
                ac: 'edit',
                s: 'feed/8',
                t: 'Example',
                a: 'user/72/label/Reading',
                r: 'user/-/label/News',
            }),
        );

        expect(await response.text()).toBe('OK');
        expect(fake.editSubscription).toHaveBeenCalledWith(72, 8, {
            categoryName: 'Reading',
            customFeedName: 'Example',
        });

        const missing = await fake.app.request(
            ...googleForm('edit', { ac: 'edit', s: 'feed/999', t: 'x' }),
        );
        expect(missing.status).toBe(404);
    });

    it('rejects malformed subscription edits', async () => {
        const fake = makeSubscriptionFake();
        const bodies: Record<string, string>[] = [
            { ac: 'subscribe' },
            { ac: 'subscribe', s: 'https://example.test/feed.xml' },
            { ac: 'subscribe', s: 'feed/999' },
            { ac: 'subscribe', s: 'feed/https://x.test/', a: 'News' },
            { ac: 'rename', s: 'feed/8' },
        ];
        for (const body of bodies) {
            const response = await fake.app.request(
                ...googleForm('edit', body),
            );
            expect(response.status).toBe(400);
        }
        const empty = await fake.app.request(...googleForm('quickadd', {}));
        expect(empty.status).toBe(400);
        expect(fake.subscribeFirstCandidate).not.toHaveBeenCalled();
    });

    it('rejects subscription writes without a google-reader app token', async () => {
        const fake = makeSubscriptionFake();
        const missing = await fake.app.request(
            ...googleForm(
                'quickadd',
                { quickadd: 'https://news.example/atom.xml' },
                null,
            ),
        );
        expect(missing.status).toBe(401);
        expect(await missing.text()).toBe('Error=AuthRequired\n');

        const wrongScope = await fake.app.request(
            ...googleForm(
                'edit',
                {
                    ac: 'subscribe',
                    s: 'feed/https://news.example/atom.xml',
                },
                'bad',
            ),
        );
        expect(wrongScope.status).toBe(403);
        expect(fake.authenticateAppTokenCredential).toHaveBeenLastCalledWith({
            plaintextToken: 'bad',
            requiredScope: 'google-reader',
        });
        expect(fake.subscribeFirstCandidate).not.toHaveBeenCalled();
        expect(fake.limitFeedAdd).not.toHaveBeenCalled();
    });

    it('applies the shared feed-add rate limit before subscribing', async () => {
        const fake = makeSubscriptionFake();
        fake.limitFeedAdd.mockImplementation(() =>
            Effect.fail(new SubscriptionRateLimited()),
        );
        const response = await fake.app.request(
            ...googleForm('quickadd', {
                quickadd: 'https://news.example/atom.xml',
            }),
        );
        expect(response.status).toBe(429);
        expect(fake.subscribeFirstCandidate).not.toHaveBeenCalled();
    });
});

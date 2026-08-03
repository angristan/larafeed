import { Effect } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import { AuthenticationFailed } from '../auth/errors';
import type { AuthService } from '../auth/service';
import { CompatibilityRateLimited } from './errors';
import type { CompatibilityRepository } from './repository';
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
    readonly rateLimit?: CompatibilityRouteDependencies['rateLimit'];
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
                    faviconUrl: '',
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
        now: () => 1_800_000_000_000,
    };
    const rateKeys: string[] = [];
    const app = registerCompatibilityRoutes(new Hono<{ Bindings: Env }>(), {
        runtimeFactory: () => Effect.succeed(runtime),
        rateLimit: (env, key) => {
            rateKeys.push(key);
            return overrides.rateLimit?.(env, key) ?? Effect.void;
        },
    });
    return {
        app,
        authenticateAppToken,
        authenticateAppTokenCredential,
        authenticateFeverApiKey,
        rateKeys,
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
    });

    it('rate-limits invalid Google credentials by IP before verification', async () => {
        const harness = makeHarness({
            rateLimit: () => Effect.fail(new CompatibilityRateLimited()),
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
    });

    it('rate-limits invalid Fever credentials by IP before verification', async () => {
        const harness = makeHarness({
            rateLimit: () => Effect.fail(new CompatibilityRateLimited()),
        });
        const response = await harness.app.request(
            '/api/fever/?api_key=ffffffffffffffffffffffffffffffff',
            { headers: { 'CF-Connecting-IP': '203.0.113.21' } },
            {} as Env,
        );

        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ api_version: 3, auth: 1 });
        expect(harness.rateKeys).toEqual([
            'compat:fever:pre-auth:203.0.113.21',
        ]);
        expect(harness.authenticateFeverApiKey).not.toHaveBeenCalled();
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
    ])('applies IP then token limits to protected Google $name', async ({
        path,
        body,
    }) => {
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
        expect(harness.authenticateAppTokenCredential).toHaveBeenCalledWith({
            plaintextToken: 'opaque-token',
            requiredScope: 'google-reader',
        });
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
            items: [
                {
                    id: 'tag:google.com,2005:reader/item/0000000000001234',
                    categories: ['user/72/state/com.google/reading-list'],
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
            `/api/fever/?api_key=${key}&groups&feeds&items&since_id=10&unread_item_ids&saved_item_ids&mark=item&id=4660&as=saved`,
            undefined,
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
            '/api/fever/?api_key=ffffffffffffffffffffffffffffffff',
            undefined,
            {} as Env,
        );
        expect(await denied.json()).toEqual({ api_version: 3, auth: 0 });
    });
});

import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AuthConfig } from '../auth/config';
import { md5Hex, sha256Bytes } from '../auth/crypto';
import { makeAuthRepository } from '../auth/repository';
import { makeAuthService } from '../auth/service';
import type { TurnstileValidator } from '../auth/turnstile';
import type { WebAuthn } from '../auth/webauthn';
import { makeD1 } from '../infrastructure/d1';
import { makeSubscriptionRepository } from '../subscriptions/repository';
import { makeSubscriptionService } from '../subscriptions/service';
import { makeCompatibilityRepository } from './repository';
import {
    type CompatibilityRuntime,
    registerCompatibilityRoutes,
} from './routes';

const d1 = makeD1(env.DB);
const now = 1_970_000_000_000;
const bytes = (value: number) => new Uint8Array(32).fill(value % 251 || 1);
const config = {
    environment: 'test',
    rpId: 'example.test',
    origin: 'https://example.test',
    rpName: 'Larafeed Test',
    challengeTtlMs: 300_000,
    sessionTtlMs: 3_600_000,
    sessionCookie: {},
    csrfCookie: {},
} as AuthConfig;

const makeRuntime = (): CompatibilityRuntime => ({
    auth: {
        config,
        service: makeAuthService({
            repository: makeAuthRepository(d1),
            webAuthn: {} as WebAuthn,
            turnstile: {} as TurnstileValidator,
            config,
            now: () => now,
        }),
    },
    repository: makeCompatibilityRepository(d1),
    subscriptions: {
        service: makeSubscriptionService({
            repository: makeSubscriptionRepository(d1),
            discoverFeeds: (url) =>
                Effect.succeed({
                    kind: 'direct' as const,
                    candidates: [
                        {
                            identicalFeedUrls: [],
                            result: {
                                kind: 'updated' as const,
                                finalUrl: url,
                                etag: null,
                                lastModified: null,
                                httpStatus: 200,
                                feed: {
                                    title: 'Discovered Feed',
                                    description: null,
                                    siteUrl: null,
                                    faviconUrl: null,
                                    sourceUpdatedAt: null,
                                },
                                entries: [],
                            },
                        },
                    ],
                }),
            now: () => now,
        }),
        limitFeedAdd: () => Effect.void,
    },
    now: () => now,
});

describe('compatibility routes with Workerd D1', () => {
    it('serves owned Google and Fever response shapes from hash-only tokens', async () => {
        const userId = 7_410_001;
        const feedId = 7_420_001;
        const categoryId = 7_430_001;
        const entryId = 7_440_001;
        const plaintextToken = 'workerd-compatibility-token';
        const username = 'workerd-compat-owner';
        const apiKey = md5Hex(`${username}:${plaintextToken}`);
        await Effect.runPromise(
            d1.batch([
                {
                    sql: `INSERT INTO users (
                        id, webauthn_user_handle, username, email, display_name,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'Workerd Owner', ?, ?)`,
                    bindings: [
                        userId,
                        bytes(userId),
                        username,
                        'workerd@example.test',
                        now,
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO feeds (
                        id, name, feed_url, site_url, favicon_url,
                        next_refresh_at, created_at, updated_at
                    ) VALUES (?, 'Workerd Feed', 'https://example.test/feed.xml',
                        'https://example.test',
                        'https://upstream.example/private-icon.png', ?, ?, ?)`,
                    bindings: [feedId, now, now, now],
                },
                {
                    sql: `INSERT INTO subscription_categories (
                        id, user_id, name, created_at, updated_at
                    ) VALUES (?, ?, 'Workerd', ?, ?)`,
                    bindings: [categoryId, userId, now, now],
                },
                {
                    sql: `INSERT INTO feed_subscriptions (
                        user_id, feed_id, category_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)`,
                    bindings: [userId, feedId, categoryId, now, now],
                },
                {
                    sql: `INSERT INTO entries (
                        id, feed_id, deduplication_key, title, url, author,
                        published_at, content_status, created_at, updated_at
                    ) VALUES (?, ?, ?, 'Workerd Item',
                        'https://example.test/item', 'Worker', ?, 'stored', ?, ?)`,
                    bindings: [entryId, feedId, bytes(9), now, now, now],
                },
                {
                    sql: `INSERT INTO entry_contents (
                        entry_id, content_html, content_hash,
                        encoded_size_bytes, created_at, updated_at
                    ) VALUES (?, '<p>Workerd</p>', ?, 14, ?, ?)`,
                    bindings: [entryId, bytes(10), now, now],
                },
                {
                    sql: `INSERT INTO app_tokens (
                        id, user_id, name, token_hash, token_prefix,
                        scopes_json, fever_verifier_hash, created_at
                    ) VALUES (7441001, ?, 'Workerd Reeder', ?, 'workerd',
                        '["google-reader","fever"]', ?, ?)`,
                    bindings: [
                        userId,
                        await Effect.runPromise(sha256Bytes(plaintextToken)),
                        await Effect.runPromise(sha256Bytes(apiKey)),
                        now,
                    ],
                },
            ]),
        );

        const app = registerCompatibilityRoutes(new Hono<{ Bindings: Env }>(), {
            runtimeFactory: () => Effect.succeed(makeRuntime()),
            loginRateLimit: () => Effect.void,
            syncRateLimit: () => Effect.void,
        });
        const google = await app.request(
            '/api/reader/reader/api/0/stream/items/contents',
            {
                method: 'POST',
                headers: {
                    Authorization: `GoogleLogin auth=${plaintextToken}`,
                    'content-type': 'application/x-www-form-urlencoded',
                },
                body: `i=${entryId}`,
            },
            env,
        );
        expect(await google.json()).toMatchObject({
            id: `user/${userId}/state/com.google/reading-list`,
            items: [
                {
                    title: 'Workerd Item',
                    content: { content: '<p>Workerd</p>' },
                    summary: { content: '<p>Workerd</p>' },
                    origin: { streamId: `feed/${feedId}` },
                },
            ],
        });

        const subscriptions = await app.request(
            '/api/reader/reader/api/0/subscription/list',
            {
                headers: {
                    Authorization: `GoogleLogin auth=${plaintextToken}`,
                },
            },
            env,
        );
        expect(await subscriptions.json()).toMatchObject({
            subscriptions: [
                {
                    id: `feed/${feedId}`,
                    iconUrl: '',
                    categories: [{ id: `user/${userId}/label/Workerd` }],
                },
            ],
        });

        const tags = await app.request(
            '/api/reader/reader/api/0/tag/list?output=json',
            {
                headers: {
                    Authorization: `GoogleLogin auth=${plaintextToken}`,
                },
            },
            env,
        );
        expect(await tags.json()).toEqual({
            tags: [
                { id: `user/${userId}/state/com.google/starred` },
                {
                    id: `user/${userId}/label/Workerd`,
                    label: 'Workerd',
                    type: 'folder',
                },
            ],
        });
        expect(tags.headers.get('cache-control')).toBe('no-store');

        const fever = await app.request(
            '/api/fever/?groups&feeds&items&unread_item_ids',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ api_key: apiKey }),
            },
            env,
        );
        expect(await fever.json()).toMatchObject({
            api_version: 3,
            auth: 1,
            groups: [{ id: categoryId, title: 'Workerd' }],
            feeds: [{ id: feedId, title: 'Workerd Feed' }],
            items: [
                {
                    id: entryId,
                    html: '<p>Workerd</p>',
                    is_read: 0,
                    is_saved: 0,
                },
            ],
            unread_item_ids: String(entryId),
        });
        expect(google.headers.get('cache-control')).toBe('no-store');
        expect(fever.headers.get('cache-control')).toBe('no-store');
    });

    it('subscribes, files, and unsubscribes feeds with a Google Reader token', async () => {
        const userId = 7_410_101;
        const plaintextToken = 'workerd-subscription-token';
        const feverOnlyToken = 'workerd-fever-only-token';
        const username = 'workerd-subscription-owner';
        await Effect.runPromise(
            d1.batch([
                {
                    sql: `INSERT INTO users (
                        id, webauthn_user_handle, username, email, display_name,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'Workerd Owner', ?, ?)`,
                    bindings: [
                        userId,
                        bytes(userId),
                        username,
                        'workerd-subscription@example.test',
                        now,
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO app_tokens (
                        id, user_id, name, token_hash, token_prefix,
                        scopes_json, fever_verifier_hash, created_at
                    ) VALUES (7441101, ?, 'Workerd Newsletters', ?, 'workerd',
                        '["google-reader"]', NULL, ?)`,
                    bindings: [
                        userId,
                        await Effect.runPromise(sha256Bytes(plaintextToken)),
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO app_tokens (
                        id, user_id, name, token_hash, token_prefix,
                        scopes_json, fever_verifier_hash, created_at
                    ) VALUES (7441102, ?, 'Workerd Fever', ?, 'workerd',
                        '["fever"]', ?, ?)`,
                    bindings: [
                        userId,
                        await Effect.runPromise(sha256Bytes(feverOnlyToken)),
                        await Effect.runPromise(
                            sha256Bytes(
                                md5Hex(`${username}:${feverOnlyToken}`),
                            ),
                        ),
                        now,
                    ],
                },
            ]),
        );

        const app = registerCompatibilityRoutes(new Hono<{ Bindings: Env }>(), {
            runtimeFactory: () => Effect.succeed(makeRuntime()),
            loginRateLimit: () => Effect.void,
            syncRateLimit: () => Effect.void,
        });
        const post = (
            path: string,
            body: Record<string, string>,
            token = plaintextToken,
        ) =>
            app.request(
                `/api/reader/reader/api/0/subscription/${path}`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `GoogleLogin auth=${token}`,
                        'content-type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams(body),
                },
                env,
            );
        const list = async () => {
            const response = await app.request(
                '/api/reader/reader/api/0/subscription/list',
                {
                    headers: {
                        Authorization: `GoogleLogin auth=${plaintextToken}`,
                    },
                },
                env,
            );
            return (
                await response.json<{
                    subscriptions: {
                        id: string;
                        url: string;
                        title: string;
                        categories: { label: string }[];
                    }[];
                }>()
            ).subscriptions;
        };
        const newsletterUrl = 'https://newsletters.example.test/acme.xml';
        const subscribe = () =>
            post('edit', {
                ac: 'subscribe',
                s: `feed/${newsletterUrl}`,
                t: 'Acme Weekly',
                a: 'user/-/label/Newsletters',
            });

        const denied = await post(
            'edit',
            { ac: 'subscribe', s: `feed/${newsletterUrl}` },
            feverOnlyToken,
        );
        expect(denied.status).toBe(403);
        expect(await list()).toEqual([]);

        expect(await (await subscribe()).text()).toBe('OK');
        expect(await (await subscribe()).text()).toBe('OK');
        const subscribed = await list();
        expect(subscribed).toHaveLength(1);
        expect(subscribed[0]).toMatchObject({
            url: newsletterUrl,
            title: 'Acme Weekly',
            categories: [{ label: 'Newsletters' }],
        });

        const quickadd = await post('quickadd', {
            quickadd: 'https://blog.example.test/feed.xml',
        });
        expect(await quickadd.json()).toMatchObject({
            numResults: 1,
            query: 'https://blog.example.test/feed.xml',
            streamId: expect.stringMatching(/^feed\/\d+$/u),
            streamName: 'Discovered Feed',
        });
        expect(await list()).toHaveLength(2);

        expect(
            await (
                await post('edit', {
                    ac: 'unsubscribe',
                    s: `feed/${newsletterUrl}`,
                })
            ).text(),
        ).toBe('OK');
        expect((await list()).map((subscription) => subscription.url)).toEqual([
            'https://blog.example.test/feed.xml',
        ]);
    });
});

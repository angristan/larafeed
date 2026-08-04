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
            rateLimit: () => Effect.void,
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
            items: [
                {
                    title: 'Workerd Item',
                    content: { content: '<p>Workerd</p>' },
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
            subscriptions: [{ id: `feed/${feedId}`, iconUrl: '' }],
        });

        const fever = await app.request(
            `/api/fever/?api_key=${apiKey}&groups&feeds&items&unread_item_ids`,
            undefined,
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
});

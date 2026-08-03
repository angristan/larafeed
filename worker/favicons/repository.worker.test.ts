import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { FaviconNotFound, makeFaviconRepository } from './repository';

const d1 = makeD1(env.DB);
const repository = makeFaviconRepository(d1);
const now = 1_900_000_000_000;

describe('favicon D1 repository', () => {
    it('enforces subscription ownership and updates refresh state', async () => {
        const userId = 960_001;
        const otherId = 960_002;
        const feedId = 961_001;
        await Effect.runPromise(
            d1.batch([
                {
                    sql: `INSERT INTO users (
                            id, webauthn_user_handle, username, email,
                            display_name, created_at, updated_at
                        ) VALUES (?, ?, 'favicon-owner', 'favicon-owner@example.test', 'Owner', ?, ?)`,
                    bindings: [userId, new Uint8Array(32).fill(1), now, now],
                },
                {
                    sql: `INSERT INTO users (
                            id, webauthn_user_handle, username, email,
                            display_name, created_at, updated_at
                        ) VALUES (?, ?, 'favicon-other', 'favicon-other@example.test', 'Other', ?, ?)`,
                    bindings: [otherId, new Uint8Array(32).fill(2), now, now],
                },
                {
                    sql: `INSERT INTO feeds (
                            id, name, feed_url, site_url, next_refresh_at,
                            created_at, updated_at
                        ) VALUES (?, 'Favicon feed', ?, ?, ?, ?, ?)`,
                    bindings: [
                        feedId,
                        'https://favicon.example.test/feed.xml',
                        'https://favicon.example.test/articles',
                        now,
                        now,
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO subscription_categories (
                            id, user_id, name, created_at, updated_at
                        ) VALUES (?, ?, 'Favicons', ?, ?)`,
                    bindings: [962_001, userId, now, now],
                },
                {
                    sql: `INSERT INTO feed_subscriptions (
                            user_id, feed_id, category_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?)`,
                    bindings: [userId, feedId, 962_001, now, now],
                },
            ]),
        );

        await expect(
            Effect.runPromise(repository.findOwnedTarget(userId, feedId)),
        ).resolves.toMatchObject({
            feedId,
            siteUrl: 'https://favicon.example.test/articles',
            faviconUrl: null,
            faviconIsDark: null,
        });
        await expect(
            Effect.runPromise(repository.findOwnedTarget(otherId, feedId)),
        ).rejects.toBeInstanceOf(FaviconNotFound);
        await expect(
            Effect.runPromise(repository.listStaleTargets(now, 5)),
        ).resolves.toEqual([
            {
                feedId,
                feedUrl: 'https://favicon.example.test/feed.xml',
                siteUrl: 'https://favicon.example.test/articles',
                faviconUrl: null,
                faviconIsDark: null,
            },
        ]);

        await Effect.runPromise(
            repository.update(
                feedId,
                'https://favicon.example.test/icon.png',
                true,
                now + 1,
            ),
        );
        await expect(
            Effect.runPromise(repository.findOwnedTarget(userId, feedId)),
        ).resolves.toMatchObject({
            faviconUrl: 'https://favicon.example.test/icon.png',
            faviconIsDark: true,
        });
        await expect(
            Effect.runPromise(
                d1.first({
                    sql: `SELECT favicon_url, favicon_is_dark, favicon_updated_at
                        FROM feeds WHERE id = ?`,
                    bindings: [feedId],
                }),
            ),
        ).resolves.toEqual({
            favicon_url: 'https://favicon.example.test/icon.png',
            favicon_is_dark: 1,
            favicon_updated_at: now + 1,
        });
    });
});

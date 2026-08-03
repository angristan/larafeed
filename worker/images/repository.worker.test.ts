import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { makeImageRepository } from './repository';

const d1 = makeD1(env.DB);
const repository = makeImageRepository(d1);
const now = 1_980_000_000_000;
const bytes = (value: number) => new Uint8Array(32).fill(value % 251 || 1);

const insertUser = (id: number) =>
    d1.run({
        sql: `INSERT INTO users (
                id, webauthn_user_handle, username, email, display_name,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        bindings: [
            id,
            bytes(id),
            `image-reader-${id}`,
            `image-reader-${id}@example.test`,
            `Image Reader ${id}`,
            now,
            now,
        ],
    });

const insertFeed = (id: number, faviconUrl: string) =>
    d1.run({
        sql: `INSERT INTO feeds (
                id, name, feed_url, site_url, favicon_url,
                next_refresh_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        bindings: [
            id,
            `Image Feed ${id}`,
            `https://feeds.example.test/${id}.xml`,
            `https://sites.example.test/${id}`,
            faviconUrl,
            now,
            now,
            now,
        ],
    });

describe('image D1 repository', () => {
    it('returns a source only through the requesting user subscription', async () => {
        const ownerId = 71_001;
        const outsiderId = 71_002;
        const ownedFeedId = 72_001;
        const otherFeedId = 72_002;
        const categoryId = 73_001;
        const storedSource = 'https://cdn.example.test/owned.png';

        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(ownerId);
                yield* insertUser(outsiderId);
                yield* insertFeed(ownedFeedId, storedSource);
                yield* insertFeed(
                    otherFeedId,
                    'https://cdn.example.test/other.png',
                );
                yield* d1.run({
                    sql: `INSERT INTO subscription_categories (
                            id, user_id, name, created_at, updated_at
                        ) VALUES (?, ?, 'Images', ?, ?)`,
                    bindings: [categoryId, ownerId, now, now],
                });
                yield* d1.run({
                    sql: `INSERT INTO feed_subscriptions (
                            user_id, feed_id, category_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?)`,
                    bindings: [ownerId, ownedFeedId, categoryId, now, now],
                });
            }),
        );

        await expect(
            Effect.runPromise(
                repository.findOwnedFeedSource(ownerId, ownedFeedId),
            ),
        ).resolves.toEqual({ faviconUrl: storedSource });
        await expect(
            Effect.runPromise(
                repository.findOwnedFeedSource(outsiderId, ownedFeedId),
            ),
        ).resolves.toBeNull();
        await expect(
            Effect.runPromise(
                repository.findOwnedFeedSource(ownerId, otherFeedId),
            ),
        ).resolves.toBeNull();
    });

    it('returns article content only to an owner when the entry is visible', async () => {
        const ownerId = 71_101;
        const outsiderId = 71_102;
        const feedId = 72_101;
        const categoryId = 73_101;
        const entryId = 74_101;
        const content =
            '<p><img src="https://cdn.example.test/article.png"></p>';

        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(ownerId);
                yield* insertUser(outsiderId);
                yield* insertFeed(feedId, 'https://cdn.example.test/icon.png');
                yield* d1.run({
                    sql: `INSERT INTO subscription_categories (
                            id, user_id, name, created_at, updated_at
                        ) VALUES (?, ?, 'Articles', ?, ?)`,
                    bindings: [categoryId, ownerId, now, now],
                });
                yield* d1.run({
                    sql: `INSERT INTO feed_subscriptions (
                            user_id, feed_id, category_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?)`,
                    bindings: [ownerId, feedId, categoryId, now, now],
                });
                yield* d1.run({
                    sql: `INSERT INTO entries (
                            id, feed_id, deduplication_key, title, url,
                            published_at, content_status, created_at, updated_at
                        ) VALUES (?, ?, ?, 'Article', ?, ?, 'stored', ?, ?)`,
                    bindings: [
                        entryId,
                        feedId,
                        bytes(entryId + 1),
                        'https://publisher.example.test/article',
                        now,
                        now,
                        now,
                    ],
                });
                yield* d1.run({
                    sql: `INSERT INTO entry_contents (
                            entry_id, content_html, content_hash,
                            encoded_size_bytes, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        entryId,
                        content,
                        bytes(entryId + 2),
                        new TextEncoder().encode(content).byteLength,
                        now,
                        now,
                    ],
                });
            }),
        );

        await expect(
            Effect.runPromise(
                repository.findOwnedArticleSource(ownerId, entryId),
            ),
        ).resolves.toEqual({
            contentHtml: content,
            entryUrl: 'https://publisher.example.test/article',
        });
        await expect(
            Effect.runPromise(
                repository.findOwnedArticleSource(outsiderId, entryId),
            ),
        ).resolves.toBeNull();

        await Effect.runPromise(
            d1.run({
                sql: `INSERT INTO entry_interactions (
                        user_id, feed_id, entry_id, filtered_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                bindings: [ownerId, feedId, entryId, now, now, now],
            }),
        );
        await expect(
            Effect.runPromise(
                repository.findOwnedArticleSource(ownerId, entryId),
            ),
        ).resolves.toBeNull();
    });
});

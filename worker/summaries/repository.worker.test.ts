import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { SummaryNotFound } from './errors';
import { makeSummaryRepository } from './repository';

const d1 = makeD1(env.DB);
const repository = makeSummaryRepository(d1);
const now = 1_900_000_000_000;
const bytes = (value: number) => new Uint8Array(32).fill(value % 255 || 1);
const key = {
    model: 'gemini-2.5-flash',
    promptVersion: 'entry-summary-v1',
};

const fixture = (
    userId: number,
    otherUserId: number,
    feedId: number,
    categoryId: number,
    entryId: number,
) =>
    Effect.gen(function* () {
        for (const id of [userId, otherUserId]) {
            yield* d1.run({
                sql: `INSERT INTO users (
                    id, webauthn_user_handle, username, email, display_name,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                bindings: [
                    id,
                    bytes(id),
                    `summary-reader-${id}`,
                    `summary-reader-${id}@example.test`,
                    `Reader ${id}`,
                    now,
                    now,
                ],
            });
        }
        yield* d1.run({
            sql: `INSERT INTO feeds (
                id, name, feed_url, next_refresh_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            bindings: [
                feedId,
                'Summary feed',
                `https://example.test/summary-${feedId}.xml`,
                now,
                now,
                now,
            ],
        });
        yield* d1.run({
            sql: `INSERT INTO subscription_categories (
                id, user_id, name, created_at, updated_at
            ) VALUES (?, ?, 'Summaries', ?, ?)`,
            bindings: [categoryId, userId, now, now],
        });
        yield* d1.run({
            sql: `INSERT INTO feed_subscriptions (
                user_id, feed_id, category_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)`,
            bindings: [userId, feedId, categoryId, now, now],
        });
        yield* d1.run({
            sql: `INSERT INTO entries (
                id, feed_id, deduplication_key, title, url, published_at,
                content_status, created_at, updated_at
            ) VALUES (?, ?, ?, 'Summary article', ?, ?, 'stored', ?, ?)`,
            bindings: [
                entryId,
                feedId,
                bytes(entryId),
                'https://example.test/article',
                now,
                now,
                now,
            ],
        });
        const content = '<p>Private article content.</p>';
        yield* d1.run({
            sql: `INSERT INTO entry_contents (
                entry_id, content_html, content_hash, encoded_size_bytes,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            bindings: [
                entryId,
                content,
                bytes(entryId + 1),
                new TextEncoder().encode(content).byteLength,
                now,
                now,
            ],
        });
    });

describe('summary D1 repository', () => {
    it('enforces ownership and uses the complete current cache key', async () => {
        const userId = 91_001;
        const otherUserId = 91_002;
        const feedId = 92_001;
        const categoryId = 93_001;
        const entryId = 94_001;
        await Effect.runPromise(
            fixture(userId, otherUserId, feedId, categoryId, entryId),
        );

        const owned = await Effect.runPromise(
            repository.findOwnedEntry(userId, entryId, key),
        );
        expect(owned).toMatchObject({
            entryId,
            title: 'Summary article',
            contentHtml: '<p>Private article content.</p>',
            summary: null,
        });
        await expect(
            Effect.runPromise(
                repository.findOwnedEntry(otherUserId, entryId, key),
            ),
        ).rejects.toBeInstanceOf(SummaryNotFound);

        const summary = await Effect.runPromise(
            repository.saveSummary({
                id: 95_001,
                userId,
                entryId,
                contentHash: owned.contentHash ?? new Uint8Array(),
                html: '<p>Cached summary.</p>',
                ...key,
                now,
            }),
        );
        expect(summary).toMatchObject({ id: 95_001, entryId });
        await expect(
            Effect.runPromise(
                repository.findOwnedEntry(userId, entryId, {
                    ...key,
                    model: 'gemini-new-model',
                }),
            ),
        ).resolves.toMatchObject({ summary: null });
    });

    it('reloads the winning row after an idempotent unique race', async () => {
        const userId = 96_001;
        const otherUserId = 96_002;
        const feedId = 97_001;
        const categoryId = 98_001;
        const entryId = 99_001;
        await Effect.runPromise(
            fixture(userId, otherUserId, feedId, categoryId, entryId),
        );
        const owned = await Effect.runPromise(
            repository.findOwnedEntry(userId, entryId, key),
        );
        const contentHash = owned.contentHash ?? new Uint8Array();

        const [left, right] = await Promise.all([
            Effect.runPromise(
                repository.saveSummary({
                    id: 100_001,
                    userId,
                    entryId,
                    contentHash,
                    html: '<p>First race result.</p>',
                    ...key,
                    now,
                }),
            ),
            Effect.runPromise(
                repository.saveSummary({
                    id: 100_002,
                    userId,
                    entryId,
                    contentHash,
                    html: '<p>Second race result.</p>',
                    ...key,
                    now: now + 1,
                }),
            ),
        ]);

        expect(right).toEqual(left);
        const count = await env.DB.prepare(
            `SELECT COUNT(*) AS count FROM entry_summaries
             WHERE entry_id = ? AND content_hash = ? AND model = ? AND prompt_version = ?`,
        )
            .bind(entryId, contentHash, key.model, key.promptVersion)
            .first<number>('count');
        expect(count).toBe(1);
    });
});

import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import {
    SummaryContentChanged,
    SummaryGenerationInProgress,
    SummaryNotFound,
} from './errors';
import { makeSummaryRepository } from './repository';
import { makeSummaryService, SUMMARY_EMPTY_CONTENT_HTML } from './service';

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

        const contentHash = owned.contentHash ?? new Uint8Array();
        await expect(
            Effect.runPromise(
                repository.claimGeneration({
                    userId,
                    entryId,
                    contentHash,
                    leaseToken: 95_000,
                    ...key,
                    now,
                    expiresAt: now + 60_000,
                }),
            ),
        ).resolves.toBe(true);
        const summary = await Effect.runPromise(
            repository.saveSummary({
                id: 95_001,
                userId,
                entryId,
                contentHash,
                leaseToken: 95_000,
                html: '<p>Cached summary.</p>',
                ...key,
                now,
            }),
        );
        expect(summary).toMatchObject({ id: 95_001, entryId });
        await expect(
            Effect.runPromise(repository.findOwnedEntry(userId, entryId)),
        ).resolves.toMatchObject({ summary });
        await expect(
            Effect.runPromise(
                repository.findOwnedEntry(userId, entryId, {
                    ...key,
                    model: 'gemini-new-model',
                }),
            ),
        ).resolves.toMatchObject({ summary: null });
    });

    it('persists the empty-content explanation without provider work', async () => {
        const userId = 121_001;
        const otherUserId = 121_002;
        const feedId = 122_001;
        const categoryId = 123_001;
        const entryId = 124_001;
        await Effect.runPromise(
            fixture(userId, otherUserId, feedId, categoryId, entryId).pipe(
                Effect.andThen(
                    d1.batch([
                        {
                            sql: 'DELETE FROM entry_contents WHERE entry_id = ?',
                            bindings: [entryId],
                        },
                        {
                            sql: `UPDATE entries SET content_status = 'empty',
                                updated_at = ? WHERE id = ?`,
                            bindings: [now + 1, entryId],
                        },
                    ]),
                ),
            ),
        );

        let providerCalls = 0;
        const service = makeSummaryService({
            config: {
                enabled: true,
                accountId: '0123456789abcdef0123456789abcdef',
                gatewayName: 'larafeed-ai',
                model: key.model,
                promptVersion: 'entry-summary-v1',
                apiKey: 'secret',
            },
            repository,
            provider: {
                generate: () => {
                    providerCalls += 1;
                    return Effect.succeed('<p>Unused.</p>');
                },
            },
            now: () => now + 2,
            generateId: () => Effect.succeed(125_001),
        });

        await expect(
            Effect.runPromise(service.generate(userId, entryId)),
        ).resolves.toMatchObject({
            summary: { html: SUMMARY_EMPTY_CONTENT_HTML },
        });
        expect(providerCalls).toBe(0);
        await expect(
            Effect.runPromise(repository.findOwnedEntry(userId, entryId)),
        ).resolves.toMatchObject({
            contentHtml: null,
            summary: { html: SUMMARY_EMPTY_CONTENT_HTML },
        });
    });

    it('grants one durable generation lease for concurrent cache misses', async () => {
        const userId = 101_001;
        const otherUserId = 101_002;
        const feedId = 102_001;
        const categoryId = 103_001;
        const entryId = 104_001;
        await Effect.runPromise(
            fixture(userId, otherUserId, feedId, categoryId, entryId),
        );
        const owned = await Effect.runPromise(
            repository.findOwnedEntry(userId, entryId, key),
        );
        const base = {
            userId,
            entryId,
            contentHash: owned.contentHash ?? new Uint8Array(),
            ...key,
            now,
            expiresAt: now + 60_000,
        };

        const claims = await Promise.all([
            Effect.runPromise(
                repository.claimGeneration({ ...base, leaseToken: 105_001 }),
            ),
            Effect.runPromise(
                repository.claimGeneration({ ...base, leaseToken: 105_002 }),
            ),
        ]);

        expect(claims.toSorted()).toEqual([false, true]);
        const winner = claims[0] ? 105_001 : 105_002;
        await Effect.runPromise(
            repository.releaseGeneration({ ...base, leaseToken: winner }),
        );
        await expect(
            Effect.runPromise(
                repository.claimGeneration({
                    ...base,
                    leaseToken: 105_003,
                    now: now + 1,
                    expiresAt: now + 60_001,
                }),
            ),
        ).resolves.toBe(true);
    });

    it('rejects stale owners after lease takeover', async () => {
        const userId = 106_001;
        const otherUserId = 106_002;
        const feedId = 107_001;
        const categoryId = 108_001;
        const entryId = 109_001;
        await Effect.runPromise(
            fixture(userId, otherUserId, feedId, categoryId, entryId),
        );
        const owned = await Effect.runPromise(
            repository.findOwnedEntry(userId, entryId, key),
        );
        const contentHash = owned.contentHash ?? new Uint8Array();
        const first = {
            userId,
            entryId,
            contentHash,
            leaseToken: 110_001,
            ...key,
            now,
            expiresAt: now + 10,
        };
        await expect(
            Effect.runPromise(repository.claimGeneration(first)),
        ).resolves.toBe(true);
        const second = {
            ...first,
            leaseToken: 110_002,
            now: now + 10,
            expiresAt: now + 60_010,
        };
        await expect(
            Effect.runPromise(repository.claimGeneration(second)),
        ).resolves.toBe(true);

        await expect(
            Effect.runPromise(
                repository.saveSummary({
                    id: 110_003,
                    userId,
                    entryId,
                    contentHash,
                    leaseToken: first.leaseToken,
                    html: '<p>Stale owner.</p>',
                    ...key,
                    now: now + 11,
                }),
            ),
        ).rejects.toBeInstanceOf(SummaryGenerationInProgress);
        await expect(
            Effect.runPromise(
                repository.saveSummary({
                    id: 110_004,
                    userId,
                    entryId,
                    contentHash,
                    leaseToken: second.leaseToken,
                    html: '<p>Current owner.</p>',
                    ...key,
                    now: now + 11,
                }),
            ),
        ).resolves.toMatchObject({ id: 110_004 });
    });

    it('rejects a generated summary when article content changes', async () => {
        const userId = 111_001;
        const otherUserId = 111_002;
        const feedId = 112_001;
        const categoryId = 113_001;
        const entryId = 114_001;
        await Effect.runPromise(
            fixture(userId, otherUserId, feedId, categoryId, entryId),
        );
        const owned = await Effect.runPromise(
            repository.findOwnedEntry(userId, entryId, key),
        );
        const contentHash = owned.contentHash ?? new Uint8Array();
        await expect(
            Effect.runPromise(
                repository.claimGeneration({
                    userId,
                    entryId,
                    contentHash,
                    leaseToken: 115_001,
                    ...key,
                    now,
                    expiresAt: now + 60_000,
                }),
            ),
        ).resolves.toBe(true);
        await Effect.runPromise(
            d1.run({
                sql: `UPDATE entry_contents
                    SET content_html = '<p>Changed.</p>', content_hash = ?,
                        encoded_size_bytes = 15, updated_at = ?
                    WHERE entry_id = ?`,
                bindings: [bytes(99), now + 1, entryId],
            }),
        );

        await expect(
            Effect.runPromise(
                repository.saveSummary({
                    id: 115_002,
                    userId,
                    entryId,
                    contentHash,
                    leaseToken: 115_001,
                    html: '<p>Stale content.</p>',
                    ...key,
                    now: now + 2,
                }),
            ),
        ).rejects.toBeInstanceOf(SummaryContentChanged);
        await expect(
            Effect.runPromise(
                d1.first<number>(
                    {
                        sql: 'SELECT COUNT(*) AS total FROM entry_summaries WHERE entry_id = ?',
                        bindings: [entryId],
                    },
                    'total',
                ),
            ),
        ).resolves.toBe(0);
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
        await expect(
            Effect.runPromise(
                repository.claimGeneration({
                    userId,
                    entryId,
                    contentHash,
                    leaseToken: 100_000,
                    ...key,
                    now,
                    expiresAt: now + 60_000,
                }),
            ),
        ).resolves.toBe(true);

        const [left, right] = await Promise.all([
            Effect.runPromise(
                repository.saveSummary({
                    id: 100_001,
                    userId,
                    entryId,
                    contentHash,
                    leaseToken: 100_000,
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
                    leaseToken: 100_000,
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

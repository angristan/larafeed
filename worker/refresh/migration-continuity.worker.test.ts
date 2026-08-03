import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { sha256Bytes } from '../auth/crypto';
import { makeD1 } from '../infrastructure/d1';
import { makeJobRepository } from '../jobs';
import { makeRefreshRuntime } from './runtime';

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

const bytes = (seed: number) => new Uint8Array(32).fill(seed % 251 || 1);

describe('migrated feed first-refresh continuity', () => {
    it('promotes the URL identity through the real parser without duplicating the entry', async () => {
        const now = 2_120_000_000_000;
        const userId = 910_001;
        const categoryId = 910_002;
        const feedId = 910_003;
        const entryId = 910_004;
        const jobId = 910_005;
        const operationId = 'migration-first-refresh-910005';
        const feedUrl = 'https://migration.example.test/feed.xml';
        const articleUrl = 'https://migration.example.test/articles/one';
        const d1 = makeD1(env.DB);
        const repository = makeJobRepository(d1);
        const legacyUrlIdentity = await Effect.runPromise(
            sha256Bytes(`url:${articleUrl}`),
        );

        await run(
            d1.batch([
                {
                    sql: `INSERT INTO users (
                            id, webauthn_user_handle, username, email,
                            display_name, created_at, updated_at
                        ) VALUES (?, ?, 'migration-continuity',
                            'migration-continuity@example.test',
                            'Migration Continuity', ?, ?)`,
                    bindings: [userId, bytes(1), now, now],
                },
                {
                    sql: `INSERT INTO subscription_categories (
                            id, user_id, name, created_at, updated_at
                        ) VALUES (?, ?, 'Migration', ?, ?)`,
                    bindings: [categoryId, userId, now, now],
                },
                {
                    sql: `INSERT INTO feeds (
                            id, name, feed_url, site_url, next_refresh_at,
                            created_at, updated_at
                        ) VALUES (?, 'Migrated feed', ?,
                            'https://migration.example.test', ?, ?, ?)`,
                    bindings: [feedId, feedUrl, now, now, now],
                },
                {
                    sql: `INSERT INTO feed_subscriptions (
                            user_id, feed_id, category_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?)`,
                    bindings: [userId, feedId, categoryId, now, now],
                },
                {
                    sql: `INSERT INTO entries (
                            id, feed_id, deduplication_key, source_id, title,
                            url, published_at, content_status, created_at,
                            updated_at
                        ) VALUES (?, ?, ?, NULL, 'Migrated title', ?, ?,
                            'stored', ?, ?)`,
                    bindings: [
                        entryId,
                        feedId,
                        legacyUrlIdentity,
                        articleUrl,
                        now - 60_000,
                        now - 60_000,
                        now - 60_000,
                    ],
                },
                {
                    sql: `INSERT INTO entry_contents (
                            entry_id, content_html, content_hash,
                            encoded_size_bytes, created_at, updated_at
                        ) VALUES (?, '<p>Migrated body</p>', ?, 20, ?, ?)`,
                    bindings: [entryId, bytes(2), now - 60_000, now - 60_000],
                },
                {
                    sql: `INSERT INTO entry_interactions (
                            user_id, feed_id, entry_id, starred_at,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?)`,
                    bindings: [userId, feedId, entryId, now, now, now],
                },
            ]),
        );
        await repository.createRefreshJob({
            jobId,
            outboxId: jobId + 1,
            operationId,
            feedId,
            trigger: 'manual',
            maxAttempts: 3,
            now,
        });

        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
            new Response(
                `<rss version="2.0"><channel><title>Refreshed feed</title>
                    <link>https://migration.example.test</link>
                    <item><guid>guid-one</guid><title>Refreshed title</title>
                    <link>${articleUrl}</link><description><![CDATA[<p>Refreshed body</p>]]></description>
                    <pubDate>${new Date(now - 60_000).toUTCString()}</pubDate></item>
                </channel></rss>`,
                {
                    status: 200,
                    headers: { 'content-type': 'application/rss+xml' },
                },
            ),
        );
        const runtime = makeRefreshRuntime(env, {
            fetch,
            now: () => now,
        });

        await expect(
            runtime.orchestrator.processQueueMessage(
                { operationId },
                'migration-acceptance-message',
            ),
        ).resolves.toMatchObject({ action: 'ack' });
        expect(fetch).toHaveBeenCalledOnce();

        const entries = await run(
            d1.all<{
                id: number;
                source_id: string | null;
                title: string;
            }>({
                sql: `SELECT id, source_id, title FROM entries
                    WHERE feed_id = ? ORDER BY id ASC`,
                bindings: [feedId],
            }),
        );
        expect(entries.results).toEqual([
            {
                id: entryId,
                source_id: 'guid-one',
                title: 'Refreshed title',
            },
        ]);
        await expect(
            run(
                d1.first<{ entry_id: number; starred_at: number | null }>({
                    sql: `SELECT entry_id, starred_at FROM entry_interactions
                        WHERE user_id = ? AND entry_id = ?`,
                    bindings: [userId, entryId],
                }),
            ),
        ).resolves.toEqual({ entry_id: entryId, starred_at: now });
    });
});

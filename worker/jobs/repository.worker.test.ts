import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeCompatibilityRepository } from '../compat/repository';
import { makeD1 } from '../infrastructure/d1';
import { makeReaderRepository } from '../reader/repository';
import { makeJobOrchestrator } from './orchestration';
import { makeJobRepository } from './repository';
import {
    DEFAULT_REFRESH_INTERVAL_MS,
    MAX_OUTBOX_ATTEMPTS,
    type RefreshJobClaim,
} from './types';

const d1 = makeD1(env.DB);
const repository = makeJobRepository(d1);
const bytes = (value: number, length = 32) =>
    new Uint8Array(length).fill(value % 255 || 1);
const allEntryFields = {
    title: true,
    url: true,
    author: true,
    publishedAt: true,
    sourceUpdatedAt: true,
    content: true,
} as const;

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

const insertFeed = (id: number, now: number, nextRefreshAt = now) =>
    run(
        d1.run({
            sql: `INSERT INTO feeds (
                    id, name, feed_url, next_refresh_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)`,
            bindings: [
                id,
                `Jobs feed ${id}`,
                `https://jobs-${id}.example.test/feed.xml`,
                nextRefreshAt,
                now,
                now,
            ],
        }),
    );

const createJob = (
    feedId: number,
    id: number,
    now: number,
    overrides: {
        readonly operationId?: string;
        readonly maxAttempts?: number;
        readonly trigger?: 'manual' | 'scheduled';
    } = {},
) =>
    repository.createRefreshJob({
        jobId: id,
        outboxId: id + 1,
        operationId: overrides.operationId ?? `operation-${id}`,
        feedId,
        trigger: overrides.trigger ?? 'manual',
        maxAttempts: overrides.maxAttempts ?? 3,
        now,
    });

const claim = async (
    operationId: string,
    now: number,
    owner = `owner-${operationId}`,
): Promise<RefreshJobClaim> => {
    const result = await repository.claimRefreshJob({
        operationId,
        owner,
        now,
        leaseMs: 10_000,
    });
    if (result.type !== 'claimed') {
        throw new Error(`Expected claimed job, received ${result.type}`);
    }
    return result.claim;
};

const first = <T>(sql: string, bindings: readonly unknown[] = []) =>
    run(d1.first<T>({ sql, bindings }));

const scalar = (sql: string, bindings: readonly unknown[] = []) =>
    run(d1.first<number>({ sql, bindings }, 'value'));

const settlePendingOutbox = (now: number) =>
    run(
        d1.run({
            sql: `UPDATE outbox_messages
                SET state = 'sent', sent_at = ?, lease_owner = NULL,
                    lease_expires_at = NULL, updated_at = ?
                WHERE state IN ('pending', 'leased')`,
            bindings: [now, now],
        }),
    );

describe('durable feed refresh jobs', () => {
    it('deduplicates commands and atomically creates one outbox row', async () => {
        const now = 2_100_000_000_000;
        const feedId = 310_001;
        await insertFeed(feedId, now);

        const firstResult = await createJob(feedId, 311_001, now, {
            operationId: 'manual-stable-operation',
        });
        const duplicate = await repository.createRefreshJob({
            jobId: 311_101,
            outboxId: 311_102,
            operationId: 'manual-stable-operation',
            feedId,
            trigger: 'manual',
            maxAttempts: 3,
            now,
        });

        expect(firstResult.created).toBe(true);
        expect(duplicate).toMatchObject({
            created: false,
            job: { id: 311_001, operationId: 'manual-stable-operation' },
        });
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM outbox_messages o
                 JOIN jobs j ON j.id = o.job_id
                 WHERE j.operation_id = ?`,
                ['manual-stable-operation'],
            ),
        ).resolves.toBe(1);
    });

    it('allocates non-reused IDs for watermarks and Fever cursors', async () => {
        const now = 2_100_000_500_000;
        const userId = 315_001;
        const categoryId = 315_002;
        const feedId = 315_003;
        await insertFeed(feedId, now);
        await run(
            d1.batch([
                {
                    sql: `INSERT INTO users (
                            id, webauthn_user_handle, username, email,
                            display_name, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        userId,
                        bytes(15),
                        'monotonic-reader',
                        'monotonic-reader@example.test',
                        'Monotonic Reader',
                        now,
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO subscription_categories (
                            id, user_id, name, created_at, updated_at
                        ) VALUES (?, ?, 'Monotonic', ?, ?)`,
                    bindings: [categoryId, userId, now, now],
                },
                {
                    sql: `INSERT INTO feed_subscriptions (
                            user_id, feed_id, category_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?)`,
                    bindings: [userId, feedId, categoryId, now, now],
                },
            ]),
        );

        const commitEntry = async (
            jobId: number,
            sourceId: string,
            publishedAt: number,
        ) => {
            const operationId = `operation-${jobId}`;
            const completedAt = now + (jobId % 1_000);
            await createJob(feedId, jobId, now, { operationId });
            const jobClaim = await claim(operationId, now);
            await repository.commitRefresh({
                claim: jobClaim,
                historyId: jobId + 2,
                completedAt,
                etag: null,
                lastModified: null,
                nextRefreshAt: completedAt + 60_000,
                httpStatus: 200,
                durationMs: 1,
                notModified: false,
                entries: [
                    {
                        deduplicationKey: bytes(jobId),
                        sourceId,
                        title: sourceId,
                        url: `https://jobs.example.test/${sourceId}`,
                        author: null,
                        publishedAt,
                        sourceUpdatedAt: null,
                        updateMask: allEntryFields,
                        filteredUserIds: [],
                        content: { type: 'empty' },
                    },
                ],
            });
            const entryId = await scalar(
                'SELECT id AS value FROM entries WHERE source_id = ?',
                [sourceId],
            );
            if (entryId === null) {
                throw new Error('Expected committed entry ID');
            }
            return entryId;
        };

        const firstEntryId = await commitEntry(315_100, 'first', now);
        await run(
            makeReaderRepository(d1).advanceReadThrough(userId, feedId, now),
        );
        const lateOldEntryId = await commitEntry(
            315_200,
            'late-old',
            now - 86_400_000,
        );
        expect(lateOldEntryId).toBeGreaterThan(firstEntryId);

        await expect(
            run(
                makeReaderRepository(d1).listEntries(userId, {
                    scope: { type: 'feed', id: feedId },
                    filter: 'unread',
                    orderBy: 'published_at',
                    page: 1,
                    pageSize: 20,
                }),
            ).then((page) => page.entries.map((entry) => entry.id)),
        ).resolves.toContain(lateOldEntryId);

        await run(
            d1.run({
                sql: 'DELETE FROM entries WHERE id = ?',
                bindings: [lateOldEntryId],
            }),
        );
        const newestEntryId = await commitEntry(315_300, 'newest', now + 1);
        expect(newestEntryId).toBeGreaterThan(lateOldEntryId);
        await expect(
            run(
                makeCompatibilityRepository(d1).listFeverItems(userId, {
                    sinceId: lateOldEntryId,
                }),
            ).then((page) => page.entries.map((entry) => entry.id)),
        ).resolves.toEqual([newestEntryId]);
    });

    it('leases stale outbox messages for ambiguous-send recovery with stable payloads', async () => {
        const now = 2_100_001_000_000;
        const feedId = 320_001;
        await settlePendingOutbox(now);
        await insertFeed(feedId, now);
        await createJob(feedId, 321_001, now);

        const firstLease = await repository.leaseOutbox({
            owner: 'dispatcher-one',
            now,
            leaseMs: 1_000,
            limit: 1,
        });
        const recoveredLease = await repository.leaseOutbox({
            owner: 'dispatcher-two',
            now: now + 1_001,
            leaseMs: 1_000,
            limit: 1,
        });

        expect(firstLease).toHaveLength(1);
        expect(recoveredLease).toMatchObject([
            {
                id: firstLease[0]?.id,
                operationId: 'operation-321001',
                leaseOwner: 'dispatcher-two',
            },
        ]);
        const payload = await first<{ payload_json: string }>(
            `SELECT o.payload_json FROM outbox_messages o
             JOIN jobs j ON j.id = o.job_id WHERE j.operation_id = ?`,
            ['operation-321001'],
        );
        expect(JSON.parse(payload?.payload_json ?? '{}')).toEqual({
            operationId: 'operation-321001',
        });
    });

    it('advances scheduled generation after outbox send exhaustion', async () => {
        const now = 2_100_001_500_000;
        const feedId = 325_001;
        const initialOperationId = `feed-refresh:scheduled:${feedId}:${now}`;
        await settlePendingOutbox(now);
        await insertFeed(feedId, now);
        await createJob(feedId, 325_101, now, {
            operationId: initialOperationId,
            trigger: 'scheduled',
        });

        let attemptAt = now;
        for (let attempt = 0; attempt < MAX_OUTBOX_ATTEMPTS; attempt += 1) {
            const [message] = await repository.leaseOutbox({
                owner: `exhaustion-${attempt}`,
                now: attemptAt,
                leaseMs: 1_000,
                limit: 1,
            });
            if (message === undefined) {
                throw new Error('Expected outbox lease');
            }
            const availableAt = attemptAt + 1_000;
            await repository.releaseOutbox({
                message,
                now: attemptAt,
                availableAt,
                errorClass: 'queue_unavailable',
                errorMessage: 'Queue unavailable',
            });
            attemptAt = availableAt;
        }

        await expect(
            first<{ job_state: string; outbox_state: string }>(
                `SELECT j.state AS job_state, o.state AS outbox_state
                 FROM jobs j JOIN outbox_messages o ON o.job_id = j.id
                 WHERE j.operation_id = ?`,
                [initialOperationId],
            ),
        ).resolves.toEqual({
            job_state: 'dead_lettered',
            outbox_state: 'dead_lettered',
        });
        const nextRefreshAt = await scalar(
            'SELECT next_refresh_at AS value FROM feeds WHERE id = ?',
            [feedId],
        );
        if (nextRefreshAt === null) {
            throw new Error('Expected next refresh time');
        }
        expect(nextRefreshAt).toBeGreaterThan(now);
        await run(
            d1.run({
                sql: `UPDATE feeds SET next_refresh_at = ?
                    WHERE id <> ? AND next_refresh_at <= ?`,
                bindings: [nextRefreshAt + 60_000, feedId, nextRefreshAt],
            }),
        );

        let nextId = 325_200;
        const orchestrator = makeJobOrchestrator({
            repository,
            queue: { send: async () => undefined },
            processor: async () => ({
                type: 'not_modified',
                etag: null,
                lastModified: null,
                httpStatus: 304,
            }),
            now: () => nextRefreshAt,
            generateId: async () => {
                nextId += 1;
                return nextId;
            },
            generateToken: async () => 'token',
        });
        const reserved = await orchestrator.reserveDueRefreshes(1);
        expect(reserved.reserved).toBe(1);
        expect(reserved.operations).toEqual([
            `feed-refresh:scheduled:${feedId}:${nextRefreshAt}`,
        ]);
        expect(reserved.operations).not.toContain(initialOperationId);
    });

    it('recovers stale job leases conditionally and respects attempt limits', async () => {
        const now = 2_100_002_000_000;
        const feedId = 330_001;
        await insertFeed(feedId, now);
        await createJob(feedId, 331_001, now, { maxAttempts: 2 });
        await claim('operation-331001', now);
        await createJob(feedId, 331_101, now, {
            operationId: 'same-feed-operation',
        });
        await expect(
            repository.claimRefreshJob({
                operationId: 'same-feed-operation',
                owner: 'competing-owner',
                now,
                leaseMs: 10_000,
            }),
        ).resolves.toEqual({ type: 'busy', retryAt: now + 10_000 });

        await expect(
            repository.recoverStaleJobLeases(now + 10_001, 1),
        ).resolves.toBe(1);
        await expect(
            first<{ state: string; lease_owner: string | null }>(
                'SELECT state, lease_owner FROM jobs WHERE operation_id = ?',
                ['operation-331001'],
            ),
        ).resolves.toEqual({ state: 'failed', lease_owner: null });

        await claim('operation-331001', now + 10_001, 'owner-second');
        await repository.recoverStaleJobLeases(now + 20_002, 1);
        await expect(
            first<{ state: string; completed_at: number | null }>(
                'SELECT state, completed_at FROM jobs WHERE operation_id = ?',
                ['operation-331001'],
            ),
        ).resolves.toEqual({
            state: 'dead_lettered',
            completed_at: now + 20_002,
        });
    });

    it('classifies 304 and makes duplicate queue delivery idempotent', async () => {
        const now = 2_100_003_000_000;
        const feedId = 340_001;
        await insertFeed(feedId, now);
        await createJob(feedId, 341_001, now);
        let processorCalls = 0;
        let generatedId = 342_000;
        const service = makeJobOrchestrator({
            repository,
            queue: { send: async () => undefined },
            processor: async (input) => {
                processorCalls += 1;
                expect(input).toMatchObject({
                    feedId,
                    etag: null,
                    lastModified: null,
                });
                return {
                    type: 'not_modified',
                    etag: 'etag-304',
                    lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT',
                    httpStatus: 304,
                    durationMs: 12,
                };
            },
            now: () => now + 10,
            generateId: async () => {
                generatedId += 1;
                return generatedId;
            },
            generateToken: async () => 'consumer-owner',
        });

        await expect(
            service.processQueueMessage({ operationId: 'operation-341001' }),
        ).resolves.toEqual({ action: 'ack', reason: 'not_modified' });
        await expect(
            service.processQueueMessage({ operationId: 'operation-341001' }),
        ).resolves.toEqual({ action: 'ack', reason: 'succeeded' });
        expect(processorCalls).toBe(1);
        await expect(
            first<{ was_not_modified: number; http_status: number }>(
                `SELECT was_not_modified, http_status FROM feed_refreshes
                 WHERE feed_id = ?`,
                [feedId],
            ),
        ).resolves.toEqual({ was_not_modified: 1, http_status: 304 });
    });

    it('rolls back the complete success batch when one entry is invalid', async () => {
        const now = 2_100_004_000_000;
        const feedId = 350_001;
        await insertFeed(feedId, now);
        await createJob(feedId, 351_001, now);
        const jobClaim = await claim('operation-351001', now);

        await expect(
            repository.commitRefresh({
                claim: jobClaim,
                historyId: 352_001,
                completedAt: now + 1,
                etag: 'must-roll-back',
                lastModified: null,
                nextRefreshAt: now + 60_000,
                httpStatus: 200,
                durationMs: 10,
                notModified: false,
                entries: [
                    {
                        deduplicationKey: bytes(1),
                        sourceId: 'valid',
                        title: 'Valid entry',
                        url: null,
                        author: null,
                        publishedAt: now,
                        sourceUpdatedAt: null,
                        updateMask: allEntryFields,
                        filteredUserIds: [],
                        content: { type: 'empty' },
                    },
                    {
                        deduplicationKey: bytes(2, 1),
                        sourceId: 'invalid',
                        title: 'Invalid entry',
                        url: null,
                        author: null,
                        publishedAt: now,
                        sourceUpdatedAt: null,
                        updateMask: allEntryFields,
                        filteredUserIds: [],
                        content: { type: 'empty' },
                    },
                ],
            }),
        ).rejects.toThrow();

        await expect(
            first<{ etag: string | null }>(
                'SELECT etag FROM feeds WHERE id = ?',
                [feedId],
            ),
        ).resolves.toEqual({ etag: null });
        await expect(
            scalar('SELECT COUNT(*) AS value FROM entries WHERE feed_id = ?', [
                feedId,
            ]),
        ).resolves.toBe(0);
        await expect(
            first<{ state: string }>(
                'SELECT state FROM jobs WHERE operation_id = ?',
                ['operation-351001'],
            ),
        ).resolves.toEqual({ state: 'running' });
    });

    it('stores content separately and removes content for oversized metadata', async () => {
        const now = 2_100_005_000_000;
        const feedId = 360_001;
        await insertFeed(feedId, now);
        await createJob(feedId, 361_001, now);
        const jobClaim = await claim('operation-361001', now);

        await repository.commitRefresh({
            claim: jobClaim,
            historyId: 362_001,
            completedAt: now + 1,
            etag: 'stored-etag',
            lastModified: null,
            nextRefreshAt: now + 60_000,
            httpStatus: 200,
            durationMs: 20,
            notModified: false,
            feedName: 'Updated feed name',
            siteUrl: 'https://jobs.example.test/',
            faviconUrl: 'https://jobs.example.test/favicon.ico',
            entries: [
                {
                    deduplicationKey: bytes(3),
                    sourceId: 'stored',
                    title: 'Stored content',
                    url: null,
                    author: null,
                    publishedAt: now,
                    sourceUpdatedAt: null,
                    updateMask: allEntryFields,
                    filteredUserIds: [],
                    content: {
                        type: 'stored',
                        html: '<p>Small article</p>',
                        hash: bytes(4),
                    },
                },
                {
                    deduplicationKey: bytes(5),
                    sourceId: 'oversized',
                    title: 'Oversized content',
                    url: null,
                    author: null,
                    publishedAt: now - 1,
                    sourceUpdatedAt: null,
                    updateMask: allEntryFields,
                    filteredUserIds: [],
                    content: { type: 'oversized' },
                },
            ],
        });

        await expect(
            first<{
                name: string;
                site_url: string | null;
                favicon_url: string | null;
                favicon_updated_at: number | null;
            }>(
                `SELECT name, site_url, favicon_url, favicon_updated_at
                 FROM feeds WHERE id = ?`,
                [feedId],
            ),
        ).resolves.toEqual({
            name: 'Updated feed name',
            site_url: 'https://jobs.example.test/',
            favicon_url: 'https://jobs.example.test/favicon.ico',
            favicon_updated_at: null,
        });
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM entry_contents c
                 JOIN entries e ON e.id = c.entry_id WHERE e.feed_id = ?`,
                [feedId],
            ),
        ).resolves.toBe(1);
        await expect(
            first<{
                entries_seen: number;
                entries_created: number;
                entries_updated: number;
            }>(
                `SELECT entries_seen, entries_created, entries_updated
                 FROM feed_refreshes WHERE job_id = ?`,
                [jobClaim.jobId],
            ),
        ).resolves.toEqual({
            entries_seen: 2,
            entries_created: 2,
            entries_updated: 0,
        });
        await expect(
            run(
                d1.all<{ source_id: string; content_status: string }>({
                    sql: `SELECT source_id, content_status FROM entries
                          WHERE feed_id = ? ORDER BY id`,
                    bindings: [feedId],
                }),
            ).then((result) => result.results),
        ).resolves.toEqual([
            { source_id: 'stored', content_status: 'stored' },
            { source_id: 'oversized', content_status: 'oversized' },
        ]);
    });

    it('preserves metadata and content omitted by sparse updates', async () => {
        const now = 2_100_005_250_000;
        const feedId = 364_001;
        const deduplicationKey = bytes(64);
        await insertFeed(feedId, now);
        await createJob(feedId, 364_101, now);
        const firstClaim = await claim('operation-364101', now);
        await repository.commitRefresh({
            claim: firstClaim,
            historyId: 364_103,
            completedAt: now + 1,
            etag: null,
            lastModified: null,
            nextRefreshAt: now + 60_000,
            httpStatus: 200,
            durationMs: 1,
            notModified: false,
            entries: [
                {
                    deduplicationKey,
                    sourceId: 'stable-guid',
                    title: 'Complete title',
                    url: 'https://jobs.example.test/complete',
                    author: 'Complete author',
                    publishedAt: now - 10_000,
                    sourceUpdatedAt: now - 5_000,
                    updateMask: allEntryFields,
                    filteredUserIds: [],
                    content: {
                        type: 'stored',
                        html: '<p>Complete article</p>',
                        hash: bytes(65),
                    },
                },
            ],
        });
        const before = await first<{
            id: number;
            title: string;
            url: string | null;
            author: string | null;
            published_at: number;
            source_updated_at: number | null;
            content_status: string;
            content_html: string | null;
            content_hash: string | null;
        }>(
            `SELECT e.id, e.title, e.url, e.author, e.published_at,
                e.source_updated_at, e.content_status, ec.content_html,
                hex(ec.content_hash) AS content_hash
             FROM entries e
             LEFT JOIN entry_contents ec ON ec.entry_id = e.id
             WHERE e.feed_id = ?`,
            [feedId],
        );

        await createJob(feedId, 364_201, now + 2);
        const sparseClaim = await claim('operation-364201', now + 2);
        await repository.commitRefresh({
            claim: sparseClaim,
            historyId: 364_203,
            completedAt: now + 3,
            etag: null,
            lastModified: null,
            nextRefreshAt: now + 60_000,
            httpStatus: 200,
            durationMs: 1,
            notModified: false,
            entries: [
                {
                    deduplicationKey,
                    sourceId: 'stable-guid',
                    title: 'Untitled',
                    url: null,
                    author: null,
                    publishedAt: now + 3,
                    sourceUpdatedAt: null,
                    updateMask: {
                        title: false,
                        url: false,
                        author: false,
                        publishedAt: false,
                        sourceUpdatedAt: false,
                        content: false,
                    },
                    filteredUserIds: [],
                    content: { type: 'empty' },
                },
            ],
        });
        await expect(
            first(
                `SELECT e.id, e.title, e.url, e.author, e.published_at,
                    e.source_updated_at, e.content_status, ec.content_html,
                    hex(ec.content_hash) AS content_hash
                 FROM entries e
                 LEFT JOIN entry_contents ec ON ec.entry_id = e.id
                 WHERE e.feed_id = ?`,
                [feedId],
            ),
        ).resolves.toEqual(before);
    });

    it('updates sparse filter matches without clearing starred state', async () => {
        const now = 2_100_005_500_000;
        const userId = 365_001;
        const categoryId = 365_002;
        const feedId = 365_003;
        const deduplicationKey = bytes(36);
        await insertFeed(feedId, now);
        await run(
            d1.batch([
                {
                    sql: `INSERT INTO users (
                            id, webauthn_user_handle, username, email,
                            display_name, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        userId,
                        bytes(37),
                        'filter-reader',
                        'filter-reader@example.test',
                        'Filter Reader',
                        now,
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO subscription_categories (
                            id, user_id, name, created_at, updated_at
                        ) VALUES (?, ?, 'Filtered', ?, ?)`,
                    bindings: [categoryId, userId, now, now],
                },
                {
                    sql: `INSERT INTO feed_subscriptions (
                            user_id, feed_id, category_id, filter_rules_json,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        userId,
                        feedId,
                        categoryId,
                        '{"exclude_title":["sponsor"],"exclude_content":[],"exclude_author":[]}',
                        now,
                        now,
                    ],
                },
            ]),
        );
        await createJob(feedId, 365_101, now);
        const firstClaim = await claim('operation-365101', now);
        await expect(
            repository.loadFeedInput(firstClaim, now),
        ).resolves.toMatchObject({
            subscriptionFilters: [
                {
                    userId,
                    rules: {
                        excludeTitle: ['sponsor'],
                        excludeContent: [],
                        excludeAuthor: [],
                    },
                },
            ],
        });
        await repository.commitRefresh({
            claim: firstClaim,
            historyId: 365_103,
            completedAt: now + 1,
            etag: null,
            lastModified: null,
            nextRefreshAt: now + 60_000,
            httpStatus: 200,
            durationMs: 5,
            notModified: false,
            entries: [
                {
                    deduplicationKey,
                    sourceId: 'filtered-entry',
                    title: 'Sponsored post',
                    url: null,
                    author: null,
                    publishedAt: now,
                    sourceUpdatedAt: null,
                    updateMask: allEntryFields,
                    filteredUserIds: [userId],
                    content: { type: 'empty' },
                },
            ],
        });
        const persistedEntryId = await scalar(
            'SELECT id AS value FROM entries WHERE feed_id = ?',
            [feedId],
        );
        await expect(
            first<{ filtered_at: number | null }>(
                `SELECT filtered_at FROM entry_interactions
                 WHERE user_id = ? AND entry_id = ?`,
                [userId, persistedEntryId],
            ),
        ).resolves.toEqual({ filtered_at: now + 1 });

        await run(
            d1.run({
                sql: `UPDATE entry_interactions
                    SET starred_at = ?, updated_at = ?
                    WHERE user_id = ? AND entry_id = ?`,
                bindings: [now + 2, now + 2, userId, persistedEntryId],
            }),
        );
        await createJob(feedId, 365_201, now + 3);
        const secondClaim = await claim('operation-365201', now + 3);
        await repository.commitRefresh({
            claim: secondClaim,
            historyId: 365_203,
            completedAt: now + 4,
            etag: null,
            lastModified: null,
            nextRefreshAt: now + 60_000,
            httpStatus: 200,
            durationMs: 5,
            notModified: false,
            entries: [
                {
                    deduplicationKey,
                    sourceId: 'filtered-entry',
                    title: 'Ordinary post',
                    url: null,
                    author: null,
                    publishedAt: now,
                    sourceUpdatedAt: null,
                    updateMask: allEntryFields,
                    filteredUserIds: [],
                    content: { type: 'empty' },
                },
            ],
        });
        await expect(
            first<{
                filtered_at: number | null;
                starred_at: number | null;
            }>(
                `SELECT filtered_at, starred_at FROM entry_interactions
                 WHERE user_id = ? AND entry_id = ?`,
                [userId, persistedEntryId],
            ),
        ).resolves.toEqual({
            filtered_at: null,
            starred_at: now + 2,
        });
    });

    it('requires repeated missing responses and permits manual recovery', async () => {
        const now = 2_100_005_750_000;
        const feedId = 368_001;
        const operationId = 'operation-368101';
        await insertFeed(feedId, now);
        await createJob(feedId, 368_101, now, {
            operationId,
            maxAttempts: 3,
            trigger: 'scheduled',
        });

        let attemptAt = now;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const jobClaim = await claim(
                operationId,
                attemptAt,
                `missing-attempt-${attempt}`,
            );
            const failedAt = attemptAt + 1;
            const retryAt = failedAt + 1;
            await expect(
                repository.recordRefreshFailure({
                    claim: jobClaim,
                    historyId: 368_200 + attempt,
                    failedAt,
                    retryable: true,
                    markGone: true,
                    errorClass: 'FeedHttpError',
                    errorMessage: 'Feed returned HTTP 410',
                    httpStatus: 410,
                    durationMs: 1,
                    retryAt,
                }),
            ).resolves.toEqual(
                attempt === 3
                    ? { terminal: true, availableAt: null }
                    : { terminal: false, availableAt: retryAt },
            );
            await expect(
                first<{
                    is_gone: number;
                    consecutive_not_found_failures: number;
                }>(
                    `SELECT is_gone, consecutive_not_found_failures
                     FROM feeds WHERE id = ?`,
                    [feedId],
                ),
            ).resolves.toEqual({
                is_gone: attempt === 3 ? 1 : 0,
                consecutive_not_found_failures: attempt,
            });
            attemptAt = retryAt;
        }

        await expect(
            repository.listDueFeeds(
                attemptAt + DEFAULT_REFRESH_INTERVAL_MS,
                100,
            ),
        ).resolves.not.toContainEqual(expect.objectContaining({ id: feedId }));

        await createJob(feedId, 368_301, attemptAt + 1, {
            operationId: 'operation-368301',
            trigger: 'manual',
        });
        const recoveryClaim = await claim(
            'operation-368301',
            attemptAt + 1,
            'manual-recovery',
        );
        await expect(
            repository.loadFeedInput(recoveryClaim, attemptAt + 1),
        ).resolves.toMatchObject({ feedId, trigger: 'manual' });
        await repository.commitRefresh({
            claim: recoveryClaim,
            historyId: 368_303,
            completedAt: attemptAt + 2,
            etag: null,
            lastModified: null,
            nextRefreshAt: attemptAt + DEFAULT_REFRESH_INTERVAL_MS,
            httpStatus: 304,
            durationMs: 1,
            notModified: true,
            entries: [],
        });
        await expect(
            first<{
                is_gone: number;
                consecutive_not_found_failures: number;
            }>(
                `SELECT is_gone, consecutive_not_found_failures
                 FROM feeds WHERE id = ?`,
                [feedId],
            ),
        ).resolves.toEqual({
            is_gone: 0,
            consecutive_not_found_failures: 0,
        });
    });

    it('records bounded retry backoff then terminates at max attempts', async () => {
        const now = 2_100_006_000_000;
        const feedId = 370_001;
        await insertFeed(feedId, now);
        await createJob(feedId, 371_001, now, { maxAttempts: 2 });
        const firstClaim = await claim('operation-371001', now);
        const retryAt = now + 30_000;

        await expect(
            repository.recordRefreshFailure({
                claim: firstClaim,
                historyId: 372_001,
                failedAt: now + 1,
                retryable: true,
                errorClass: 'x'.repeat(100),
                errorMessage: 'm'.repeat(1_000),
                httpStatus: 503,
                durationMs: 50,
                retryAt,
            }),
        ).resolves.toEqual({ terminal: false, availableAt: retryAt });
        const early = await repository.claimRefreshJob({
            operationId: 'operation-371001',
            owner: 'too-early',
            now: retryAt - 1,
            leaseMs: 1_000,
        });
        expect(early).toEqual({ type: 'unavailable', retryAt });

        const secondClaim = await claim(
            'operation-371001',
            retryAt,
            'second-attempt',
        );
        await expect(
            repository.recordRefreshFailure({
                claim: secondClaim,
                historyId: 372_002,
                failedAt: retryAt + 1,
                retryable: true,
                markGone: true,
                errorClass: 'still_unavailable',
                errorMessage: 'Second failure',
                httpStatus: 503,
                durationMs: 50,
                retryAt: retryAt + 60_000,
            }),
        ).resolves.toEqual({ terminal: true, availableAt: null });
        await expect(
            first<{
                state: string;
                class_length: number;
                message_length: number;
                is_gone: number;
                last_failed_refresh_at: number;
            }>(
                `SELECT j.state, length(j.last_error_class) AS class_length,
                    length(j.last_error_message) AS message_length,
                    f.is_gone, f.last_failed_refresh_at
                 FROM jobs j
                 JOIN feeds f ON f.id = json_extract(j.payload_json, '$.feedId')
                 WHERE j.operation_id = ?`,
                ['operation-371001'],
            ),
        ).resolves.toEqual({
            state: 'dead_lettered',
            class_length: 17,
            message_length: 14,
            is_gone: 0,
            last_failed_refresh_at: retryAt + 1,
        });
    });

    it('defers a terminal non-gone feed until the normal refresh interval', async () => {
        const now = 2_100_006_500_000;
        const failedAt = now + 1;
        const feedId = 375_001;
        await insertFeed(feedId, now);
        await createJob(feedId, 375_101, now);
        const jobClaim = await claim('operation-375101', now);

        await expect(
            repository.recordRefreshFailure({
                claim: jobClaim,
                historyId: 375_102,
                failedAt,
                retryable: false,
                errorClass: 'FeedParseError',
                errorMessage: 'Unsupported feed',
                httpStatus: 200,
                durationMs: 5,
                retryAt: failedAt + 30_000,
            }),
        ).resolves.toEqual({ terminal: true, availableAt: null });

        const nextRefreshAt = failedAt + DEFAULT_REFRESH_INTERVAL_MS;
        await expect(
            first<{ is_gone: number; next_refresh_at: number }>(
                'SELECT is_gone, next_refresh_at FROM feeds WHERE id = ?',
                [feedId],
            ),
        ).resolves.toEqual({ is_gone: 0, next_refresh_at: nextRefreshAt });
        await expect(
            repository.listDueFeeds(failedAt + 30_000, 100),
        ).resolves.not.toContainEqual({ id: feedId, nextRefreshAt });
        await expect(
            repository.listDueFeeds(nextRefreshAt, 100),
        ).resolves.toContainEqual({ id: feedId, nextRefreshAt });

        await createJob(feedId, 375_201, nextRefreshAt);
        const secondClaim = await claim('operation-375201', nextRefreshAt);
        const secondFailedAt = nextRefreshAt + 1;
        await expect(
            repository.recordRefreshFailure({
                claim: secondClaim,
                historyId: 375_202,
                failedAt: secondFailedAt,
                retryable: false,
                errorClass: 'FeedParseError',
                errorMessage: 'Still unsupported',
                httpStatus: 200,
                durationMs: 5,
                retryAt: secondFailedAt + 30_000,
            }),
        ).resolves.toEqual({ terminal: true, availableAt: null });

        const secondNextRefreshAt =
            secondFailedAt + DEFAULT_REFRESH_INTERVAL_MS * 2;
        await expect(
            first<{ consecutive_failures: number; next_refresh_at: number }>(
                `SELECT consecutive_failures, next_refresh_at
                 FROM feeds WHERE id = ?`,
                [feedId],
            ),
        ).resolves.toEqual({
            consecutive_failures: 2,
            next_refresh_at: secondNextRefreshAt,
        });
    });

    it('records DLQ state and deletes old history without deleting each feed newest row', async () => {
        const now = 2_100_007_000_000;
        const feedId = 380_001;
        await insertFeed(feedId, now);
        await createJob(feedId, 381_001, now);

        await expect(
            repository.recordDeadLetter({
                operationId: 'operation-381001',
                historyId: 382_001,
                now: now + 1,
                errorClass: 'queue_dead_letter',
                errorMessage: 'Attempts exhausted',
            }),
        ).resolves.toBe(true);
        await expect(
            first<{ job_state: string; outbox_state: string }>(
                `SELECT j.state AS job_state, o.state AS outbox_state
                 FROM jobs j JOIN outbox_messages o ON o.job_id = j.id
                 WHERE j.operation_id = ?`,
                ['operation-381001'],
            ),
        ).resolves.toEqual({
            job_state: 'dead_lettered',
            outbox_state: 'dead_lettered',
        });

        const historyFeed = 383_001;
        await insertFeed(historyFeed, now);
        await run(
            d1.batch([
                {
                    sql: `INSERT INTO feed_refreshes (
                            id, feed_id, refreshed_at, was_successful,
                            created_at
                        ) VALUES (?, ?, ?, 1, ?)`,
                    bindings: [384_001, historyFeed, 1_000, 1_000],
                },
                {
                    sql: `INSERT INTO feed_refreshes (
                            id, feed_id, refreshed_at, was_successful,
                            created_at
                        ) VALUES (?, ?, ?, 1, ?)`,
                    bindings: [384_002, historyFeed, 2_000, 2_000],
                },
            ]),
        );
        await expect(repository.cleanupRefreshHistory(10_000, 1)).resolves.toBe(
            1,
        );
        await expect(
            run(
                d1.all<{ id: number }>({
                    sql: 'SELECT id FROM feed_refreshes WHERE feed_id = ?',
                    bindings: [historyFeed],
                }),
            ).then((result) => result.results),
        ).resolves.toEqual([{ id: 384_002 }]);
        await expect(
            repository.cleanupRefreshHistory(10_000, 10),
        ).resolves.toBe(0);
    });
});

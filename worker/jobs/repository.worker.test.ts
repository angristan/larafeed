import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeCompatibilityRepository } from '../compat/repository';
import { makeD1 } from '../infrastructure/d1';
import { OPML_IMPORT_JOB_KIND, OPML_IMPORT_TOPIC } from '../opml/types';
import { makeReaderRepository } from '../reader/repository';
import { makeSubscriptionRepository } from '../subscriptions/repository';
import { RefreshLeaseLostError } from './errors';
import { makeJobOrchestrator } from './orchestration';
import { makeJobRepository } from './repository';
import {
    DEFAULT_REFRESH_INTERVAL_MS,
    DEFAULT_REFRESH_REDRIVE_AGE_MS,
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

        expect(firstResult).toMatchObject({
            type: 'created',
            job: { id: 311_001, operationId: 'manual-stable-operation' },
        });
        expect(duplicate).toMatchObject({
            type: 'idempotent',
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

    it('admits only one active refresh across racing triggers', async () => {
        const now = 2_100_000_250_000;
        const feedId = 312_001;
        await insertFeed(feedId, now);

        const outcomes = await Promise.all([
            createJob(feedId, 312_101, now, {
                operationId: 'racing-manual-refresh',
                trigger: 'manual',
            }),
            createJob(feedId, 312_201, now, {
                operationId: 'racing-scheduled-refresh',
                trigger: 'scheduled',
            }),
        ]);

        expect(outcomes.map(({ type }) => type).sort()).toEqual([
            'active',
            'created',
        ]);
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM jobs
                 WHERE kind = 'feed_refresh'
                   AND state IN ('pending', 'queued', 'running', 'failed')
                   AND CAST(json_extract(payload_json, '$.feedId') AS INTEGER) = ?`,
                [feedId],
            ),
        ).resolves.toBe(1);
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM outbox_messages o
                 JOIN jobs j ON j.id = o.job_id
                 WHERE CAST(json_extract(j.payload_json, '$.feedId') AS INTEGER) = ?`,
                [feedId],
            ),
        ).resolves.toBe(1);
    });

    it('enforces manual cooldown while allowing gone-feed recovery', async () => {
        const now = 2_100_000_350_000;
        const feedId = 313_001;
        await insertFeed(feedId, now);
        await run(
            d1.run({
                sql: `UPDATE feeds
                    SET last_successful_refresh_at = ?, is_gone = 1
                    WHERE id = ?`,
                bindings: [now - 60_000, feedId],
            }),
        );

        await expect(
            repository.createRefreshJob({
                jobId: 313_101,
                outboxId: 313_102,
                operationId: 'cooldown-manual-refresh',
                feedId,
                trigger: 'manual',
                maxAttempts: 3,
                now,
                manualCooldownMs: 5 * 60_000,
            }),
        ).resolves.toEqual({
            type: 'cooldown',
            retryAt: now + 4 * 60_000,
        });
        await expect(
            createJob(feedId, 313_201, now, {
                operationId: 'gone-scheduled-refresh',
                trigger: 'scheduled',
            }),
        ).resolves.toEqual({ type: 'gone' });
        await expect(
            repository.createRefreshJob({
                jobId: 313_301,
                outboxId: 313_302,
                operationId: 'gone-manual-recovery',
                feedId,
                trigger: 'manual',
                maxAttempts: 3,
                now: now + 4 * 60_000,
                manualCooldownMs: 5 * 60_000,
            }),
        ).resolves.toMatchObject({
            type: 'created',
            job: { operationId: 'gone-manual-recovery' },
        });
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
                subscriptionFilterRevisions: [],
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

    it('leases only the requested refresh operation', async () => {
        const now = 2_100_001_050_000;
        await settlePendingOutbox(now);
        await insertFeed(321_101, now);
        await insertFeed(321_201, now);
        await createJob(321_101, 321_110, now, {
            operationId: 'refresh-scope-one',
        });
        await createJob(321_201, 321_210, now, {
            operationId: 'refresh-scope-two',
        });

        await expect(
            repository.leaseOutbox({
                owner: 'scoped-dispatcher',
                now,
                leaseMs: 1_000,
                limit: 1,
                operationId: 'refresh-scope-two',
            }),
        ).resolves.toMatchObject([
            {
                operationId: 'refresh-scope-two',
                leaseOwner: 'scoped-dispatcher',
            },
        ]);
        await expect(
            first<{ state: string }>(
                `SELECT o.state FROM outbox_messages o
                 JOIN jobs j ON j.id = o.job_id
                 WHERE j.operation_id = ?`,
                ['refresh-scope-one'],
            ),
        ).resolves.toEqual({ state: 'pending' });
    });

    it('dispatches only refresh outbox rows and rejects OPML transitions', async () => {
        const now = 2_100_001_100_000;
        const feedId = 322_001;
        const refreshJobId = 322_101;
        const opmlRows = [
            {
                jobId: 322_201,
                outboxId: 322_202,
                operationId: 'opml-pending-isolation',
                outboxState: 'pending',
                leaseOwner: null,
                leaseExpiresAt: null,
            },
            {
                jobId: 322_301,
                outboxId: 322_302,
                operationId: 'opml-expired-isolation',
                outboxState: 'leased',
                leaseOwner: 'opml-expired-owner',
                leaseExpiresAt: now - 1,
            },
            {
                jobId: 322_401,
                outboxId: 322_402,
                operationId: 'opml-active-isolation',
                outboxState: 'leased',
                leaseOwner: 'opml-active-owner',
                leaseExpiresAt: now + 10_000,
            },
        ] as const;

        await settlePendingOutbox(now);
        await insertFeed(feedId, now);
        await createJob(feedId, refreshJobId, now, {
            operationId: 'refresh-dispatch-isolation',
        });
        await run(
            d1.batch(
                opmlRows.flatMap((row) => [
                    {
                        sql: `INSERT INTO jobs (
                                id, operation_id, kind, state, payload_json,
                                max_attempts, available_at, created_at, updated_at
                            ) VALUES (?, ?, ?, 'pending', ?, 3, ?, ?, ?)`,
                        bindings: [
                            row.jobId,
                            row.operationId,
                            OPML_IMPORT_JOB_KIND,
                            JSON.stringify({ itemId: row.jobId }),
                            now,
                            now,
                            now,
                        ],
                    },
                    {
                        sql: `INSERT INTO outbox_messages (
                                id, job_id, topic, payload_json, state,
                                available_at, lease_owner, lease_expires_at,
                                created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        bindings: [
                            row.outboxId,
                            row.jobId,
                            OPML_IMPORT_TOPIC,
                            JSON.stringify({ operationId: row.operationId }),
                            row.outboxState,
                            now,
                            row.leaseOwner,
                            row.leaseExpiresAt,
                            now,
                            now,
                        ],
                    },
                ]),
            ),
        );

        const leased = await repository.leaseOutbox({
            owner: 'refresh-isolation-dispatcher',
            now,
            leaseMs: 1_000,
            limit: 10,
        });
        expect(leased).toHaveLength(1);
        expect(leased[0]).toMatchObject({
            jobId: refreshJobId,
            operationId: 'refresh-dispatch-isolation',
        });
        const refreshMessage = leased[0];
        if (refreshMessage === undefined) {
            throw new Error('Expected refresh outbox lease');
        }
        await repository.markDispatched(refreshMessage, now);

        await expect(
            first<{ job_state: string; outbox_state: string }>(
                `SELECT j.state AS job_state, o.state AS outbox_state
                 FROM jobs j JOIN outbox_messages o ON o.job_id = j.id
                 WHERE j.id = ?`,
                [refreshJobId],
            ),
        ).resolves.toEqual({ job_state: 'queued', outbox_state: 'sent' });
        await expect(
            run(
                d1.all<{
                    id: number;
                    job_state: string;
                    outbox_state: string;
                    lease_owner: string | null;
                    lease_expires_at: number | null;
                }>({
                    sql: `SELECT o.id, j.state AS job_state,
                            o.state AS outbox_state, o.lease_owner,
                            o.lease_expires_at
                        FROM outbox_messages o
                        JOIN jobs j ON j.id = o.job_id
                        WHERE j.kind = ? ORDER BY o.id`,
                    bindings: [OPML_IMPORT_JOB_KIND],
                }),
            ).then((result) => result.results),
        ).resolves.toEqual(
            opmlRows.map((row) => ({
                id: row.outboxId,
                job_state: 'pending',
                outbox_state: row.outboxState,
                lease_owner: row.leaseOwner,
                lease_expires_at: row.leaseExpiresAt,
            })),
        );

        const opmlMessage = {
            id: 322_402,
            jobId: 322_401,
            operationId: 'opml-active-isolation',
            attemptCount: 0,
            leaseOwner: 'opml-active-owner',
            leaseExpiresAt: now + 10_000,
        };
        await expect(
            repository.markDispatched(opmlMessage, now),
        ).rejects.toThrow('dispatch lease was lost');
        await expect(
            repository.releaseOutbox({
                message: opmlMessage,
                now,
                availableAt: now + 1_000,
                errorClass: 'queue_unavailable',
                errorMessage: 'Refresh dispatcher must not release OPML work',
            }),
        ).rejects.toThrow('outbox lease was lost');
        await expect(
            first<{
                job_state: string;
                outbox_state: string;
                lease_owner: string | null;
                lease_expires_at: number | null;
            }>(
                `SELECT j.state AS job_state, o.state AS outbox_state,
                    o.lease_owner, o.lease_expires_at
                 FROM jobs j JOIN outbox_messages o ON o.job_id = j.id
                 WHERE j.id = ?`,
                [opmlMessage.jobId],
            ),
        ).resolves.toEqual({
            job_state: 'pending',
            outbox_state: 'leased',
            lease_owner: opmlMessage.leaseOwner,
            lease_expires_at: opmlMessage.leaseExpiresAt,
        });
        await run(
            d1.run({
                sql: `UPDATE jobs SET state = 'canceled', completed_at = ?,
                        updated_at = ? WHERE id = ?`,
                bindings: [now, now, refreshJobId],
            }),
        );
    });

    it('redrives a lost Queue delivery with the stable payload and converges duplicates', async () => {
        const now = 2_100_001_250_000;
        const feedId = 323_001;
        const operationId = 'lost-delivery-operation';
        await settlePendingOutbox(now);
        await insertFeed(feedId, now);
        await createJob(feedId, 323_101, now, { operationId });

        const [initial] = await repository.leaseOutbox({
            owner: 'initial-dispatch',
            now,
            leaseMs: 1_000,
            limit: 1,
        });
        if (initial === undefined) throw new Error('Expected initial lease');
        await repository.markDispatched(initial, now);

        await expect(
            repository.reconcileStrandedRefreshJobs({
                now: now + DEFAULT_REFRESH_REDRIVE_AGE_MS - 1,
                staleBefore: now - 1,
                limit: 1,
            }),
        ).resolves.toEqual({ redriven: 0, deadLettered: 0 });

        const recoveredAt = now + DEFAULT_REFRESH_REDRIVE_AGE_MS;
        await expect(
            repository.reconcileStrandedRefreshJobs({
                now: recoveredAt,
                staleBefore: now,
                limit: 1,
            }),
        ).resolves.toEqual({ redriven: 1, deadLettered: 0 });
        await expect(
            first<{
                state: string;
                attempt_count: number;
                payload_json: string;
            }>(
                `SELECT state, attempt_count, payload_json
                 FROM outbox_messages WHERE id = ?`,
                [initial.id],
            ),
        ).resolves.toEqual({
            state: 'pending',
            attempt_count: 1,
            payload_json: JSON.stringify({ operationId }),
        });

        const sent: { operationId: string }[] = [];
        let historyId = 323_200;
        let processorCalls = 0;
        const service = makeJobOrchestrator({
            repository,
            queue: { send: async (body) => void sent.push(body) },
            processor: async () => {
                processorCalls += 1;
                return {
                    type: 'not_modified',
                    etag: null,
                    lastModified: null,
                    httpStatus: 304,
                };
            },
            now: () => recoveredAt,
            generateId: async () => {
                historyId += 1;
                return historyId;
            },
            generateToken: async () => 'recovery-owner',
        });
        await expect(service.dispatchOutbox(1)).resolves.toMatchObject({
            sent: 1,
        });
        expect(sent).toEqual([{ operationId }]);

        await expect(service.processQueueMessage(sent[0])).resolves.toEqual({
            action: 'ack',
            reason: 'not_modified',
        });
        await expect(service.processQueueMessage(sent[0])).resolves.toEqual({
            action: 'ack',
            reason: 'succeeded',
        });
        expect(processorCalls).toBe(1);
        await expect(
            first<{ state: string }>(
                'SELECT state FROM jobs WHERE operation_id = ?',
                [operationId],
            ),
        ).resolves.toEqual({ state: 'succeeded' });
        await expect(
            repository.reconcileStrandedRefreshJobs({
                now: recoveredAt + DEFAULT_REFRESH_REDRIVE_AGE_MS,
                staleBefore: recoveredAt,
                limit: 1,
            }),
        ).resolves.toEqual({ redriven: 0, deadLettered: 0 });
    });

    it('bounds stranded redrives and recovers eligible failed jobs only', async () => {
        const now = 2_100_001_350_000;
        await settlePendingOutbox(now);
        const jobs = [324_001, 324_011, 324_021];
        for (const feedId of jobs) {
            await insertFeed(feedId, now);
            await createJob(feedId, feedId + 1, now);
            const [leased] = await repository.leaseOutbox({
                owner: `dispatch-${feedId}`,
                now,
                leaseMs: 1_000,
                limit: 1,
            });
            if (leased === undefined) throw new Error('Expected outbox lease');
            await repository.markDispatched(leased, now);
        }

        const failedClaim = await claim('operation-324002', now, 'failed-job');
        await repository.recordRefreshFailure({
            claim: failedClaim,
            historyId: 324_100,
            failedAt: now + 1,
            retryable: true,
            errorClass: 'temporary',
            errorMessage: 'Try later',
            httpStatus: 503,
            durationMs: 1,
            retryAt: now + 2,
        });
        const reconciledAt = now + DEFAULT_REFRESH_REDRIVE_AGE_MS + 1;
        await expect(
            repository.reconcileStrandedRefreshJobs({
                now: reconciledAt,
                staleBefore: now + 1,
                limit: 2,
            }),
        ).resolves.toEqual({ redriven: 2, deadLettered: 0 });
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM outbox_messages o
                 JOIN jobs j ON j.id = o.job_id
                 WHERE j.operation_id IN (?, ?, ?) AND o.state = 'pending'`,
                ['operation-324002', 'operation-324012', 'operation-324022'],
            ),
        ).resolves.toBe(2);
        await expect(
            repository.reconcileStrandedRefreshJobs({
                now: reconciledAt,
                staleBefore: now + 1,
                limit: 2,
            }),
        ).resolves.toEqual({ redriven: 1, deadLettered: 0 });
    });

    it('exhausts redrive recovery once, advances scheduled feeds, and excludes terminal jobs', async () => {
        const now = 2_100_001_450_000;
        const feedId = 324_501;
        const operationId = `feed-refresh:scheduled:${feedId}:${now}`;
        await settlePendingOutbox(now);
        await run(
            d1.run({
                sql: `UPDATE jobs SET state = 'canceled', completed_at = ?,
                        lease_owner = NULL, lease_expires_at = NULL,
                        updated_at = MAX(updated_at, ?)
                    WHERE kind = 'feed_refresh'
                      AND state IN ('pending', 'queued', 'failed', 'running')`,
                bindings: [now, now],
            }),
        );
        await insertFeed(feedId, now);
        await createJob(feedId, 324_601, now, {
            operationId,
            trigger: 'scheduled',
        });
        const [leased] = await repository.leaseOutbox({
            owner: 'terminal-dispatch',
            now,
            leaseMs: 1_000,
            limit: 1,
        });
        if (leased === undefined) throw new Error('Expected outbox lease');
        await repository.markDispatched(leased, now);
        await run(
            d1.run({
                sql: `UPDATE outbox_messages SET attempt_count = ?
                    WHERE id = ?`,
                bindings: [MAX_OUTBOX_ATTEMPTS, leased.id],
            }),
        );

        const reconciledAt = now + DEFAULT_REFRESH_REDRIVE_AGE_MS;
        const reconcile = () =>
            repository.reconcileStrandedRefreshJobs({
                now: reconciledAt,
                staleBefore: now,
                limit: 1,
            });
        await expect(reconcile()).resolves.toEqual({
            redriven: 0,
            deadLettered: 1,
        });
        const terminal = await first<{
            job_state: string;
            outbox_state: string;
            next_refresh_at: number;
        }>(
            `SELECT j.state AS job_state, o.state AS outbox_state,
                f.next_refresh_at
             FROM jobs j
             JOIN outbox_messages o ON o.job_id = j.id
             JOIN feeds f ON f.id = json_extract(j.payload_json, '$.feedId')
             WHERE j.operation_id = ?`,
            [operationId],
        );
        expect(terminal).toEqual({
            job_state: 'dead_lettered',
            outbox_state: 'dead_lettered',
            next_refresh_at: reconciledAt + DEFAULT_REFRESH_INTERVAL_MS,
        });
        await expect(reconcile()).resolves.toEqual({
            redriven: 0,
            deadLettered: 0,
        });
        await expect(
            scalar('SELECT next_refresh_at AS value FROM feeds WHERE id = ?', [
                feedId,
            ]),
        ).resolves.toBe(terminal?.next_refresh_at);
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

    it('recovers stale refresh jobs without touching earlier OPML leases', async () => {
        const now = 2_100_001_750_000;
        const feedId = 329_001;
        const refreshJobId = 329_101;
        const refreshOperationId = 'refresh-stale-isolation';
        const opmlRunningJobId = 329_201;
        const opmlPendingJobId = 329_301;

        await insertFeed(feedId, now);
        await createJob(feedId, refreshJobId, now, {
            operationId: refreshOperationId,
            maxAttempts: 2,
        });
        await claim(refreshOperationId, now, 'refresh-stale-owner');
        await run(
            d1.batch([
                {
                    sql: `INSERT INTO jobs (
                            id, operation_id, kind, state, payload_json,
                            attempt_count, max_attempts, available_at,
                            lease_owner, lease_expires_at, started_at,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, 'running', ?, 1, 3, ?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        opmlRunningJobId,
                        'opml-running-stale-isolation',
                        OPML_IMPORT_JOB_KIND,
                        JSON.stringify({ itemId: opmlRunningJobId }),
                        now,
                        'opml-running-owner',
                        now + 500,
                        now,
                        now,
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO jobs (
                            id, operation_id, kind, state, payload_json,
                            max_attempts, available_at, created_at, updated_at
                        ) VALUES (?, ?, ?, 'pending', ?, 3, ?, ?, ?)`,
                    bindings: [
                        opmlPendingJobId,
                        'opml-pending-stale-isolation',
                        OPML_IMPORT_JOB_KIND,
                        JSON.stringify({ itemId: opmlPendingJobId }),
                        now,
                        now,
                        now,
                    ],
                },
            ]),
        );

        const recoveredAt = now + 10_001;
        await expect(
            repository.recoverStaleJobLeases(recoveredAt, 1),
        ).resolves.toBe(1);
        await expect(
            first<{
                state: string;
                lease_owner: string | null;
                last_error_class: string | null;
            }>(
                `SELECT state, lease_owner, last_error_class
                 FROM jobs WHERE id = ?`,
                [refreshJobId],
            ),
        ).resolves.toEqual({
            state: 'failed',
            lease_owner: null,
            last_error_class: 'stale_lease',
        });
        await expect(
            run(
                d1.all<{
                    id: number;
                    state: string;
                    attempt_count: number;
                    lease_owner: string | null;
                    lease_expires_at: number | null;
                    last_error_class: string | null;
                }>({
                    sql: `SELECT id, state, attempt_count, lease_owner,
                            lease_expires_at, last_error_class
                        FROM jobs
                        WHERE kind = ? AND id IN (?, ?) ORDER BY id`,
                    bindings: [
                        OPML_IMPORT_JOB_KIND,
                        opmlRunningJobId,
                        opmlPendingJobId,
                    ],
                }),
            ).then((result) => result.results),
        ).resolves.toEqual([
            {
                id: opmlRunningJobId,
                state: 'running',
                attempt_count: 1,
                lease_owner: 'opml-running-owner',
                lease_expires_at: now + 500,
                last_error_class: null,
            },
            {
                id: opmlPendingJobId,
                state: 'pending',
                attempt_count: 0,
                lease_owner: null,
                lease_expires_at: null,
                last_error_class: null,
            },
        ]);
    });

    it('deduplicates active refreshes and recovers stale leases conditionally', async () => {
        const now = 2_100_002_000_000;
        const feedId = 330_001;
        await insertFeed(feedId, now);
        await createJob(feedId, 331_001, now, { maxAttempts: 2 });
        await claim('operation-331001', now);
        await expect(
            createJob(feedId, 331_101, now, {
                operationId: 'same-feed-operation',
                trigger: 'scheduled',
            }),
        ).resolves.toMatchObject({
            type: 'active',
            job: { operationId: 'operation-331001', trigger: 'manual' },
        });
        await expect(
            repository.claimRefreshJob({
                operationId: 'same-feed-operation',
                owner: 'competing-owner',
                now,
                leaseMs: 10_000,
            }),
        ).resolves.toEqual({ type: 'missing' });

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
        await expect(
            first<{ state: string }>(
                `SELECT state FROM outbox_messages
                 WHERE job_id = (SELECT id FROM jobs WHERE operation_id = ?)`,
                ['operation-331001'],
            ),
        ).resolves.toEqual({ state: 'dead_lettered' });
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
                subscriptionFilterRevisions: [],
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
        await run(
            d1.run({
                sql: `UPDATE feeds SET favicon_url = ?, favicon_is_dark = 1,
                        favicon_asset_hash = ?, favicon_updated_at = ?
                        WHERE id = ?`,
                bindings: [
                    'https://jobs.example.test/old-icon.png',
                    'e'.repeat(64),
                    now,
                    feedId,
                ],
            }),
        );
        await createJob(feedId, 361_001, now);
        const jobClaim = await claim('operation-361001', now);

        await repository.commitRefresh({
            claim: jobClaim,
            subscriptionFilterRevisions: [],
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
                favicon_asset_hash: string | null;
                favicon_is_dark: number | null;
                favicon_updated_at: number | null;
            }>(
                `SELECT name, site_url, favicon_url, favicon_asset_hash,
                    favicon_is_dark, favicon_updated_at
                 FROM feeds WHERE id = ?`,
                [feedId],
            ),
        ).resolves.toEqual({
            name: 'Updated feed name',
            site_url: 'https://jobs.example.test/',
            favicon_url: 'https://jobs.example.test/favicon.ico',
            favicon_asset_hash: 'e'.repeat(64),
            favicon_is_dark: 1,
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
            subscriptionFilterRevisions: [],
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
            subscriptionFilterRevisions: [],
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
                    filterRevision: 0,
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
            subscriptionFilterRevisions: [{ userId, filterRevision: 0 }],
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
            subscriptionFilterRevisions: [{ userId, filterRevision: 0 }],
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

    it('does not apply stale refresh filter results after a rebuild', async () => {
        const now = 2_100_005_650_000;
        const userId = 366_001;
        const categoryId = 366_002;
        const feedId = 366_003;
        const firstEntryId = 366_004;
        const secondEntryId = 366_005;
        const firstKey = bytes(66);
        const secondKey = bytes(67);
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
                        bytes(68),
                        'filter-race-reader',
                        'filter-race-reader@example.test',
                        'Filter Race Reader',
                        now,
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO subscription_categories (
                            id, user_id, name, created_at, updated_at
                        ) VALUES (?, ?, 'Filter race', ?, ?)`,
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
                        '{"exclude_title":["Old"],"exclude_content":[],"exclude_author":[]}',
                        now,
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO entries (
                            id, feed_id, deduplication_key, source_id, title,
                            published_at, content_status, created_at, updated_at
                        ) VALUES (?, ?, ?, 'race-first', 'New blocked', ?,
                            'empty', ?, ?)`,
                    bindings: [firstEntryId, feedId, firstKey, now, now, now],
                },
                {
                    sql: `INSERT INTO entries (
                            id, feed_id, deduplication_key, source_id, title,
                            published_at, content_status, created_at, updated_at
                        ) VALUES (?, ?, ?, 'race-second', 'Old blocked', ?,
                            'empty', ?, ?)`,
                    bindings: [secondEntryId, feedId, secondKey, now, now, now],
                },
                {
                    sql: `INSERT INTO entry_interactions (
                            user_id, feed_id, entry_id, starred_at,
                            filtered_at, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, NULL, ?, ?),
                                 (?, ?, ?, ?, ?, ?, ?)`,
                    bindings: [
                        userId,
                        feedId,
                        firstEntryId,
                        now,
                        now,
                        now,
                        userId,
                        feedId,
                        secondEntryId,
                        now,
                        now,
                        now,
                        now,
                    ],
                },
            ]),
        );
        await createJob(feedId, 366_101, now, {
            operationId: 'operation-366101',
        });
        const refreshClaim = await claim('operation-366101', now);
        const refreshInput = await repository.loadFeedInput(refreshClaim, now);
        expect(refreshInput.subscriptionFilters).toMatchObject([
            { userId, filterRevision: 0 },
        ]);

        const subscriptions = makeSubscriptionRepository(d1);
        const window = await run(
            subscriptions.filterEntryWindow(userId, feedId),
        );
        await run(
            subscriptions.updateSubscriptionWithFilterRebuild(
                userId,
                feedId,
                categoryId,
                null,
                {
                    excludeTitle: ['New'],
                    excludeContent: [],
                    excludeAuthor: [],
                },
                window.filterRevision,
                window.throughId ?? 0,
                [firstEntryId],
                now + 1,
            ),
        );

        await expect(
            repository.commitRefresh({
                claim: refreshClaim,
                subscriptionFilterRevisions:
                    refreshInput.subscriptionFilters.map(
                        ({ userId: snapshotUserId, filterRevision }) => ({
                            userId: snapshotUserId,
                            filterRevision,
                        }),
                    ),
                historyId: 366_103,
                completedAt: now + 2,
                etag: null,
                lastModified: null,
                nextRefreshAt: now + 60_000,
                httpStatus: 200,
                durationMs: 5,
                notModified: false,
                entries: [
                    {
                        deduplicationKey: firstKey,
                        sourceId: 'race-first',
                        title: 'Ordinary first',
                        url: null,
                        author: null,
                        publishedAt: now,
                        sourceUpdatedAt: null,
                        updateMask: allEntryFields,
                        filteredUserIds: [],
                        content: { type: 'empty' },
                    },
                    {
                        deduplicationKey: secondKey,
                        sourceId: 'race-second',
                        title: 'Old blocked',
                        url: null,
                        author: null,
                        publishedAt: now,
                        sourceUpdatedAt: null,
                        updateMask: allEntryFields,
                        filteredUserIds: [userId],
                        content: { type: 'empty' },
                    },
                ],
            }),
        ).rejects.toBeInstanceOf(RefreshLeaseLostError);
        await expect(
            repository.releaseRefreshJobLease({
                claim: refreshClaim,
                now: now + 2,
                availableAt: now + 30_002,
                errorClass: 'orchestration_error',
                errorMessage: 'Refresh orchestration failed',
            }),
        ).resolves.toBe(true);
        await expect(
            repository.claimRefreshJob({
                operationId: refreshClaim.operationId,
                owner: 'revision-retry-owner',
                now: now + 30_002,
                leaseMs: 60_000,
            }),
        ).resolves.toMatchObject({
            type: 'claimed',
            claim: { leaseOwner: 'revision-retry-owner' },
        });

        await expect(
            run(
                d1.all<{
                    entry_id: number;
                    title: string;
                    starred_at: number | null;
                    filtered_at: number | null;
                }>({
                    sql: `SELECT e.id AS entry_id, e.title,
                            ei.starred_at, ei.filtered_at
                        FROM entries e
                        LEFT JOIN entry_interactions ei
                          ON ei.user_id = ? AND ei.entry_id = e.id
                        WHERE e.feed_id = ? ORDER BY e.id`,
                    bindings: [userId, feedId],
                }),
            ).then((result) => result.results),
        ).resolves.toEqual([
            {
                entry_id: firstEntryId,
                title: 'New blocked',
                starred_at: now,
                filtered_at: now + 1,
            },
            {
                entry_id: secondEntryId,
                title: 'Old blocked',
                starred_at: now,
                filtered_at: null,
            },
        ]);
        await expect(
            first<{ filter_revision: number; filter_rules_json: string }>(
                `SELECT filter_revision, filter_rules_json
                 FROM feed_subscriptions WHERE user_id = ? AND feed_id = ?`,
                [userId, feedId],
            ),
        ).resolves.toEqual({
            filter_revision: 1,
            filter_rules_json:
                '{"exclude_title":["New"],"exclude_content":[],"exclude_author":[]}',
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
            subscriptionFilterRevisions: [],
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
                outbox_state: string;
                class_length: number;
                message_length: number;
                is_gone: number;
                last_failed_refresh_at: number;
            }>(
                `SELECT j.state, o.state AS outbox_state,
                    length(j.last_error_class) AS class_length,
                    length(j.last_error_message) AS message_length,
                    f.is_gone, f.last_failed_refresh_at
                 FROM jobs j
                 JOIN outbox_messages o ON o.job_id = j.id
                 JOIN feeds f ON f.id = json_extract(j.payload_json, '$.feedId')
                 WHERE j.operation_id = ?`,
                ['operation-371001'],
            ),
        ).resolves.toEqual({
            state: 'dead_lettered',
            outbox_state: 'dead_lettered',
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

    it('deletes bounded old terminal jobs without deleting protected work', async () => {
        const now = 2_100_006_750_000;
        const old = now - 100 * 24 * 60 * 60_000;
        const feedId = 378_001;
        const userId = 378_002;
        const importId = 378_003;
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
                        bytes(78),
                        'retention-reader',
                        'retention-reader@example.test',
                        'Retention Reader',
                        now,
                        now,
                    ],
                },
                {
                    sql: `INSERT INTO opml_imports (
                            id, user_id, state, total_items, succeeded_items,
                            completed_at, created_at, updated_at
                        ) VALUES (?, ?, 'completed', 1, 1, ?, ?, ?)`,
                    bindings: [importId, userId, old, old, old],
                },
            ]),
        );
        const jobs = [
            { id: 378_100, state: 'succeeded', completedAt: old },
            { id: 378_110, state: 'canceled', completedAt: old + 1 },
            { id: 378_120, state: 'succeeded', completedAt: now - 1 },
            { id: 378_130, state: 'pending', completedAt: null },
            { id: 378_140, state: 'succeeded', completedAt: old + 2 },
            { id: 378_150, state: 'dead_lettered', completedAt: old + 3 },
            { id: 378_160, state: 'canceled', completedAt: old + 4 },
        ] as const;
        await run(
            d1.batch(
                jobs.flatMap((job) => {
                    const leased = job.id === 378_160;
                    return [
                        {
                            sql: `INSERT INTO jobs (
                                    id, operation_id, kind, state, payload_json,
                                    max_attempts, available_at, lease_owner,
                                    lease_expires_at, completed_at, created_at,
                                    updated_at
                                ) VALUES (?, ?, 'retention_test', ?, '{}', 3,
                                    ?, NULL, NULL, ?, ?, ?)`,
                            bindings: [
                                job.id,
                                `retention-${job.id}`,
                                job.state,
                                old,
                                job.completedAt,
                                old,
                                job.completedAt ?? old,
                            ],
                        },
                        {
                            sql: `INSERT INTO outbox_messages (
                                    id, job_id, topic, payload_json, state,
                                    available_at, lease_owner, lease_expires_at,
                                    sent_at, created_at, updated_at
                                ) VALUES (?, ?, 'retention-test', '{}', ?, ?,
                                    ?, ?, ?, ?, ?)`,
                            bindings: [
                                job.id + 1,
                                job.id,
                                leased ? 'leased' : 'sent',
                                old,
                                leased ? 'retention-lease' : null,
                                leased ? now + 60_000 : null,
                                leased ? null : old,
                                old,
                                old,
                            ],
                        },
                    ];
                }),
            ),
        );
        await run(
            d1.batch([
                {
                    sql: `INSERT INTO feed_refreshes (
                            id, feed_id, job_id, refreshed_at,
                            was_successful, created_at
                        ) VALUES (?, ?, ?, ?, 1, ?)`,
                    bindings: [378_141, feedId, 378_140, old, old],
                },
                {
                    sql: `INSERT INTO opml_import_items (
                            id, import_id, user_id, position, operation_id,
                            job_id, feed_url, normalized_feed_url, state,
                            max_attempts, completed_at, created_at, updated_at
                        ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'succeeded', 3,
                            ?, ?, ?)`,
                    bindings: [
                        378_151,
                        importId,
                        userId,
                        'retention-opml-item',
                        378_150,
                        'https://retention.example.test/feed.xml',
                        'https://retention.example.test/feed.xml',
                        old,
                        old,
                        old,
                    ],
                },
            ]),
        );

        await expect(
            repository.cleanupTerminalJobs(now - 90 * 24 * 60 * 60_000, 1),
        ).resolves.toBe(1);
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM jobs
                 WHERE id IN (378100, 378110)`,
            ),
        ).resolves.toBe(1);
        await expect(
            repository.cleanupTerminalJobs(now - 90 * 24 * 60 * 60_000, 10),
        ).resolves.toBe(3);
        await expect(
            run(
                d1.all<{ id: number }>({
                    sql: `SELECT id FROM jobs
                        WHERE id BETWEEN 378100 AND 378160 ORDER BY id`,
                }),
            ).then((result) => result.results.map(({ id }) => id)),
        ).resolves.toEqual([378_120, 378_130, 378_160]);
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM outbox_messages
                 WHERE job_id IN (378100, 378110, 378140, 378150)`,
            ),
        ).resolves.toBe(0);
        await expect(
            first<{ job_id: number | null }>(
                'SELECT job_id FROM feed_refreshes WHERE id = ?',
                [378_141],
            ),
        ).resolves.toEqual({ job_id: null });
        await expect(
            first<{ job_id: number | null }>(
                'SELECT job_id FROM opml_import_items WHERE id = ?',
                [378_151],
            ),
        ).resolves.toEqual({ job_id: null });
    });

    it('deletes old history without deleting each feed newest row', async () => {
        const now = 2_100_007_000_000;
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

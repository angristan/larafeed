import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { makeJobRepository } from '../jobs/repository';
import { FEED_REFRESH_JOB_KIND, FEED_REFRESH_TOPIC } from '../jobs/types';
import { makeOpmlRepository } from './repository';
import { OPML_IMPORT_JOB_KIND, OPML_IMPORT_TOPIC } from './types';

const d1 = makeD1(env.DB);
const repository = makeOpmlRepository(d1);
const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
const handle = (value: number) => new Uint8Array(32).fill(value % 255 || 1);

const insertUser = (id: number, now: number) =>
    run(
        d1.run({
            sql: `INSERT INTO users (
                    id, webauthn_user_handle, username, email, display_name,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            bindings: [
                id,
                handle(id),
                `opml-user-${id}`,
                `opml-user-${id}@example.test`,
                `OPML User ${id}`,
                now,
                now,
            ],
        }),
    );

const scalar = (sql: string, bindings: readonly unknown[] = []) =>
    run(d1.first<number>({ sql, bindings }, 'value'));

const first = <T>(sql: string, bindings: readonly unknown[] = []) =>
    run(d1.first<T>({ sql, bindings }));

describe('OPML D1 repository', () => {
    it('creates one command per feed and completes exact progress atomically', async () => {
        const now = 2_200_000_000_000;
        const userId = 710_001;
        const importId = 711_001;
        await insertUser(userId, now);

        const created = await repository.createImport({
            id: importId,
            userId,
            filename: 'subscriptions.opml',
            maxAttempts: 3,
            now,
            items: [
                {
                    id: 712_001,
                    jobId: 713_001,
                    outboxId: 714_001,
                    operationId: 'opml-workerd-operation',
                    position: 0,
                    title: 'Example feed',
                    customTitle: 'My Example',
                    feedUrl: 'https://opml-workerd.example.test/rss',
                    normalizedFeedUrl: 'https://opml-workerd.example.test/rss',
                    siteUrl: 'https://opml-workerd.example.test/',
                    categoryPath: ['Tech', 'Web'],
                },
            ],
        });

        expect(created).toMatchObject({
            id: importId,
            state: 'processing',
            totalItems: 1,
            succeededItems: 0,
        });
        await expect(
            first<{
                kind: string;
                topic: string;
                payload_json: string;
            }>(
                `SELECT j.kind, o.topic, o.payload_json FROM jobs j
                 JOIN outbox_messages o ON o.job_id = j.id
                 WHERE j.operation_id = ?`,
                ['opml-workerd-operation'],
            ),
        ).resolves.toEqual({
            kind: OPML_IMPORT_JOB_KIND,
            topic: OPML_IMPORT_TOPIC,
            payload_json: '{"operationId":"opml-workerd-operation"}',
        });

        const leased = await repository.leaseOutbox({
            owner: 'dispatcher',
            now,
            leaseMs: 10_000,
            limit: 10,
        });
        expect(leased).toHaveLength(1);
        const leasedMessage = leased[0];
        if (leasedMessage === undefined) throw new Error('Expected lease');
        await repository.markDispatched(leasedMessage, now);
        const claimed = await repository.claimJob({
            operationId: 'opml-workerd-operation',
            owner: 'consumer',
            now,
            leaseMs: 10_000,
        });
        if (claimed.type !== 'claimed') {
            throw new Error(`Expected claim, received ${claimed.type}`);
        }

        await expect(
            repository.completeItem({
                claim: claimed.claim,
                feedId: 715_001,
                categoryId: 716_001,
                refreshJobId: 717_001,
                refreshOutboxId: 718_001,
                feedUrl: 'https://opml-workerd.example.test/feed.xml',
                feedName: 'Example feed',
                categoryName: 'Tech / Web',
                siteUrl: 'https://opml-workerd.example.test/',
                faviconUrl: 'https://opml-workerd.example.test/favicon.ico',
                completedAt: now + 1,
            }),
        ).resolves.toEqual({
            state: 'succeeded',
            refreshOperationId: 'feed-refresh:opml:opml-workerd-operation',
        });

        await expect(
            repository.getImport(userId, importId),
        ).resolves.toMatchObject({
            state: 'completed',
            totalItems: 1,
            succeededItems: 1,
            failedItems: 0,
            skippedItems: 0,
            completedAt: now + 1,
        });
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM feed_subscriptions
                 WHERE user_id = ? AND feed_id = ?`,
                [userId, 715_001],
            ),
        ).resolves.toBe(1);
        await expect(
            first<{ custom_feed_name: string | null }>(
                `SELECT custom_feed_name FROM feed_subscriptions
                 WHERE user_id = ? AND feed_id = ?`,
                [userId, 715_001],
            ),
        ).resolves.toEqual({ custom_feed_name: 'My Example' });
        await expect(
            first<{
                operation_id: string;
                kind: string;
                state: string;
                payload_json: string;
                topic: string;
                outbox_state: string;
                outbox_payload: string;
            }>(
                `SELECT j.operation_id, j.kind, j.state, j.payload_json,
                    o.topic, o.state AS outbox_state,
                    o.payload_json AS outbox_payload
                 FROM jobs j JOIN outbox_messages o ON o.job_id = j.id
                 WHERE j.id = ?`,
                [717_001],
            ),
        ).resolves.toEqual({
            operation_id: 'feed-refresh:opml:opml-workerd-operation',
            kind: FEED_REFRESH_JOB_KIND,
            state: 'pending',
            payload_json: JSON.stringify({
                feedId: 715_001,
                trigger: 'scheduled',
            }),
            topic: FEED_REFRESH_TOPIC,
            outbox_state: 'pending',
            outbox_payload: JSON.stringify({
                operationId: 'feed-refresh:opml:opml-workerd-operation',
            }),
        });
        const refreshRepository = makeJobRepository(d1);
        const refreshOutbox = await refreshRepository.leaseOutbox({
            owner: 'refresh-dispatcher',
            now: now + 2,
            leaseMs: 10_000,
            limit: 1,
        });
        expect(refreshOutbox).toHaveLength(1);
        const refreshMessage = refreshOutbox[0];
        if (refreshMessage === undefined) {
            throw new Error('Expected refresh outbox message');
        }
        expect(refreshMessage.operationId).toBe(
            'feed-refresh:opml:opml-workerd-operation',
        );
        await refreshRepository.markDispatched(refreshMessage, now + 2);
        await expect(
            first<{ state: string }>(
                'SELECT state FROM jobs WHERE id = ?',
                [717_001],
            ),
        ).resolves.toEqual({ state: 'queued' });
        await expect(
            repository.claimJob({
                operationId: 'opml-workerd-operation',
                owner: 'duplicate',
                now: now + 2,
                leaseMs: 10_000,
            }),
        ).resolves.toEqual({ type: 'completed', state: 'succeeded' });
    });

    it('leases one import and marks its outbox batch atomically', async () => {
        const now = 2_200_000_250_000;
        const userId = 728_001;
        const importId = 728_100;
        await insertUser(userId, now);

        const item = (
            position: number,
            idBase: number,
            operationId: string,
        ) => ({
            id: idBase,
            jobId: idBase + 1,
            outboxId: idBase + 2,
            operationId,
            position,
            title: `Feed ${position}`,
            customTitle: null,
            feedUrl: `https://opml-batch-${position}.example.test/rss`,
            normalizedFeedUrl: `https://opml-batch-${position}.example.test/rss`,
            siteUrl: null,
            categoryPath: [],
        });
        await repository.createImport({
            id: importId,
            userId,
            filename: null,
            maxAttempts: 3,
            now,
            items: [
                item(0, 728_110, 'opml-batch-0'),
                item(1, 728_120, 'opml-batch-1'),
            ],
        });
        await repository.createImport({
            id: 728_200,
            userId,
            filename: null,
            maxAttempts: 3,
            now,
            items: [item(0, 728_210, 'opml-other-import')],
        });

        const leased = await repository.leaseOutbox({
            owner: 'batch-dispatcher',
            now,
            leaseMs: 10_000,
            limit: 10,
            importId,
        });
        expect(leased.map((message) => message.operationId)).toEqual([
            'opml-batch-0',
            'opml-batch-1',
        ]);
        await repository.markDispatchedBatch(leased, now);

        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM jobs
                 WHERE operation_id IN ('opml-batch-0', 'opml-batch-1')
                    AND state = 'queued'`,
            ),
        ).resolves.toBe(2);
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM outbox_messages o
                 JOIN jobs j ON j.id = o.job_id
                 WHERE j.operation_id IN ('opml-batch-0', 'opml-batch-1')
                    AND o.state = 'sent'`,
            ),
        ).resolves.toBe(2);
        await expect(
            first<{ job_state: string; outbox_state: string }>(
                `SELECT j.state AS job_state, o.state AS outbox_state
                 FROM jobs j JOIN outbox_messages o ON o.job_id = j.id
                 WHERE j.operation_id = 'opml-other-import'`,
            ),
        ).resolves.toEqual({ job_state: 'pending', outbox_state: 'pending' });

        const failedBatch = await repository.leaseOutbox({
            owner: 'failed-batch-dispatcher',
            now,
            leaseMs: 10_000,
            limit: 10,
            importId: 728_200,
        });
        await repository.releaseOutboxBatch({
            messages: failedBatch,
            now,
            availableAt: now + 30_000,
            errorClass: 'queue_error',
            errorMessage: 'Queue batch failed',
        });
        await expect(
            first<{ state: string; attempt_count: number }>(
                `SELECT o.state, o.attempt_count FROM outbox_messages o
                 JOIN jobs j ON j.id = o.job_id
                 WHERE j.operation_id = 'opml-other-import'`,
            ),
        ).resolves.toEqual({ state: 'pending', attempt_count: 1 });
        const retryBatch = await repository.leaseOutbox({
            owner: 'retry-batch-dispatcher',
            now: now + 30_000,
            leaseMs: 10_000,
            limit: 10,
            importId: 728_200,
        });
        await repository.markDispatchedBatch(retryBatch, now + 30_000);
    });

    it('creates no duplicate refresh work for retried items or shared feeds', async () => {
        const now = 2_200_000_500_000;
        const firstUserId = 719_001;
        const secondUserId = 719_002;
        const sharedFeedUrl = 'https://opml-shared.example.test/feed.xml';
        await insertUser(firstUserId, now);
        await insertUser(secondUserId, now);

        await repository.createImport({
            id: 719_101,
            userId: firstUserId,
            filename: null,
            maxAttempts: 3,
            now,
            items: [
                {
                    id: 719_102,
                    jobId: 719_103,
                    outboxId: 719_104,
                    operationId: 'opml-retried-shared-first',
                    position: 0,
                    title: 'Original shared feed',
                    customTitle: null,
                    feedUrl: sharedFeedUrl,
                    normalizedFeedUrl: sharedFeedUrl,
                    siteUrl: null,
                    categoryPath: [],
                },
            ],
        });
        const firstAttempt = await repository.claimJob({
            operationId: 'opml-retried-shared-first',
            owner: 'first-attempt',
            now,
            leaseMs: 10_000,
        });
        if (firstAttempt.type !== 'claimed') throw new Error('Expected claim');
        await repository.recordFailure({
            claim: firstAttempt.claim,
            failedAt: now + 1,
            retryable: true,
            retryAt: now + 2,
            errorClass: 'temporary_failure',
            errorMessage: 'retry me',
        });
        const retried = await repository.claimJob({
            operationId: 'opml-retried-shared-first',
            owner: 'retried-attempt',
            now: now + 2,
            leaseMs: 10_000,
        });
        if (retried.type !== 'claimed') throw new Error('Expected retry claim');
        await repository.completeItem({
            claim: retried.claim,
            feedId: 719_501,
            categoryId: 719_502,
            refreshJobId: 719_503,
            refreshOutboxId: 719_504,
            feedUrl: sharedFeedUrl,
            feedName: 'Canonical shared feed',
            categoryName: 'Uncategorized',
            siteUrl: null,
            faviconUrl: null,
            completedAt: now + 3,
        });

        await repository.createImport({
            id: 719_201,
            userId: secondUserId,
            filename: null,
            maxAttempts: 3,
            now: now + 4,
            items: [
                {
                    id: 719_202,
                    jobId: 719_203,
                    outboxId: 719_204,
                    operationId: 'opml-retried-shared-second',
                    position: 0,
                    title: 'Ignored fallback',
                    customTitle: 'Second user title',
                    feedUrl: sharedFeedUrl,
                    normalizedFeedUrl: sharedFeedUrl,
                    siteUrl: null,
                    categoryPath: [],
                },
            ],
        });
        const sharedClaim = await repository.claimJob({
            operationId: 'opml-retried-shared-second',
            owner: 'shared-attempt',
            now: now + 4,
            leaseMs: 10_000,
        });
        if (sharedClaim.type !== 'claimed') throw new Error('Expected claim');
        await expect(
            repository.completeItem({
                claim: sharedClaim.claim,
                feedId: 719_601,
                categoryId: 719_602,
                refreshJobId: 719_603,
                refreshOutboxId: 719_604,
                feedUrl: sharedFeedUrl,
                feedName: 'Replacement canonical title',
                categoryName: 'Uncategorized',
                siteUrl: null,
                faviconUrl: null,
                completedAt: now + 5,
            }),
        ).resolves.toEqual({
            state: 'succeeded',
            refreshOperationId: null,
        });

        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM jobs
                 WHERE kind = ? AND json_extract(payload_json, '$.feedId') = ?`,
                [FEED_REFRESH_JOB_KIND, 719_501],
            ),
        ).resolves.toBe(1);
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM outbox_messages o
                 JOIN jobs j ON j.id = o.job_id
                 WHERE j.kind = ? AND json_extract(j.payload_json, '$.feedId') = ?`,
                [FEED_REFRESH_JOB_KIND, 719_501],
            ),
        ).resolves.toBe(1);
        await expect(
            repository.listExportSubscriptions(secondUserId),
        ).resolves.toEqual([
            {
                category: 'Uncategorized',
                canonicalTitle: 'Canonical shared feed',
                customTitle: 'Second user title',
                feedUrl: sharedFeedUrl,
                siteUrl: null,
            },
        ]);
        await expect(
            repository.claimJob({
                operationId: 'opml-retried-shared-first',
                owner: 'duplicate-delivery',
                now: now + 6,
                leaseMs: 10_000,
            }),
        ).resolves.toEqual({ type: 'completed', state: 'succeeded' });
    });

    it('bootstraps an empty canonical feed and skips a populated feed', async () => {
        const now = 2_200_000_750_000;
        const feedUrl = 'https://opml-existing-empty.example.test/feed.xml';
        const emptyFeedId = 727_010;
        const firstUserId = 727_001;
        const secondUserId = 727_002;
        await insertUser(firstUserId, now);
        await insertUser(secondUserId, now);
        await run(
            d1.run({
                sql: `INSERT INTO feeds (
                        id, name, feed_url, next_refresh_at, created_at, updated_at
                    ) VALUES (?, 'Existing canonical feed', ?, ?, ?, ?)`,
                bindings: [emptyFeedId, feedUrl, now, now, now],
            }),
        );

        const importExistingFeed = async (
            userId: number,
            importId: number,
            operationId: string,
            idBase: number,
            completedAt: number,
        ) => {
            await repository.createImport({
                id: importId,
                userId,
                filename: null,
                maxAttempts: 3,
                now: completedAt - 1,
                items: [
                    {
                        id: idBase,
                        jobId: idBase + 1,
                        outboxId: idBase + 2,
                        operationId,
                        position: 0,
                        title: 'Fallback title',
                        customTitle: null,
                        feedUrl,
                        normalizedFeedUrl: feedUrl,
                        siteUrl: null,
                        categoryPath: [],
                    },
                ],
            });
            const claim = await repository.claimJob({
                operationId,
                owner: `${operationId}-owner`,
                now: completedAt - 1,
                leaseMs: 10_000,
            });
            if (claim.type !== 'claimed') throw new Error('Expected claim');
            return repository.completeItem({
                claim: claim.claim,
                feedId: idBase + 3,
                categoryId: idBase + 4,
                refreshJobId: idBase + 5,
                refreshOutboxId: idBase + 6,
                feedUrl,
                feedName: 'Replacement title',
                categoryName: 'Uncategorized',
                siteUrl: null,
                faviconUrl: null,
                completedAt,
            });
        };

        await expect(
            importExistingFeed(
                firstUserId,
                727_100,
                'opml-existing-empty',
                727_110,
                now + 1,
            ),
        ).resolves.toEqual({
            state: 'succeeded',
            refreshOperationId: 'feed-refresh:opml:opml-existing-empty',
        });
        await expect(
            first<{ payload_json: string }>(
                `SELECT payload_json FROM jobs WHERE id = ? AND kind = ?`,
                [727_115, FEED_REFRESH_JOB_KIND],
            ),
        ).resolves.toEqual({
            payload_json: JSON.stringify({
                feedId: emptyFeedId,
                trigger: 'scheduled',
            }),
        });

        await run(
            d1.batch([
                {
                    sql: `UPDATE jobs SET state = 'succeeded', completed_at = ?,
                            updated_at = ?
                        WHERE id = ?`,
                    bindings: [now + 2, now + 2, 727_115],
                },
                {
                    sql: `UPDATE feeds SET last_successful_refresh_at = ?,
                            updated_at = ? WHERE id = ?`,
                    bindings: [now + 2, now + 2, emptyFeedId],
                },
            ]),
        );
        await expect(
            importExistingFeed(
                secondUserId,
                727_200,
                'opml-existing-populated',
                727_210,
                now + 3,
            ),
        ).resolves.toEqual({
            state: 'succeeded',
            refreshOperationId: 'feed-refresh:opml:opml-existing-populated',
        });
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM jobs
                 WHERE kind = ? AND json_extract(payload_json, '$.feedId') = ?`,
                [FEED_REFRESH_JOB_KIND, emptyFeedId],
            ),
        ).resolves.toBe(2);
    });

    it('never leases another topic and hides imports from other users', async () => {
        const now = 2_200_001_000_000;
        const userId = 720_001;
        const otherUserId = 720_002;
        await insertUser(userId, now);
        await insertUser(otherUserId, now);
        await repository.createImport({
            id: 721_001,
            userId,
            filename: null,
            maxAttempts: 2,
            now,
            items: [
                {
                    id: 722_001,
                    jobId: 723_001,
                    outboxId: 724_001,
                    operationId: 'opml-filtered-operation',
                    position: 0,
                    title: null,
                    customTitle: null,
                    feedUrl: 'https://filtered.example.test/rss',
                    normalizedFeedUrl: 'https://filtered.example.test/rss',
                    siteUrl: null,
                    categoryPath: [],
                },
            ],
        });
        await run(
            d1.batch([
                {
                    sql: `INSERT INTO jobs (id, operation_id, kind, state, payload_json,
                            max_attempts, available_at, created_at, updated_at)
                        VALUES (?, ?, 'other_kind', 'pending', '{}', 2, ?, ?, ?)`,
                    bindings: [725_001, 'other-operation', now, now, now],
                },
                {
                    sql: `INSERT INTO outbox_messages (id, job_id, topic, payload_json,
                            state, available_at, created_at, updated_at)
                        VALUES (?, ?, 'other_topic', ?, 'pending', ?, ?, ?)`,
                    bindings: [
                        726_001,
                        725_001,
                        '{"operationId":"other-operation"}',
                        now,
                        now,
                        now,
                    ],
                },
            ]),
        );

        await run(
            d1.run({
                sql: `UPDATE opml_imports SET state = 'pending' WHERE id = ?`,
                bindings: [721_001],
            }),
        );
        await expect(
            repository.leaseOutbox({
                owner: 'incomplete-dispatcher',
                now,
                leaseMs: 1_000,
                limit: 10,
            }),
        ).resolves.toEqual([]);
        await run(
            d1.run({
                sql: `UPDATE opml_imports SET state = 'processing' WHERE id = ?`,
                bindings: [721_001],
            }),
        );

        const leased = await repository.leaseOutbox({
            owner: 'filtered-dispatcher',
            now,
            leaseMs: 1_000,
            limit: 10,
        });
        expect(leased.map((message) => message.operationId)).toEqual([
            'opml-filtered-operation',
        ]);
        await expect(
            repository.getImport(otherUserId, 721_001),
        ).resolves.toBeNull();
        await expect(
            first<{ state: string }>(
                'SELECT state FROM outbox_messages WHERE id = ?',
                [726_001],
            ),
        ).resolves.toEqual({ state: 'pending' });
    });

    it('records terminal URL failures once and exposes bounded error progress', async () => {
        const now = 2_200_002_000_000;
        const userId = 730_001;
        await insertUser(userId, now);
        await repository.createImport({
            id: 731_001,
            userId,
            filename: null,
            maxAttempts: 3,
            now,
            items: [
                {
                    id: 732_001,
                    jobId: 733_001,
                    outboxId: 734_001,
                    operationId: 'opml-terminal-failure',
                    position: 0,
                    title: 'Private feed',
                    customTitle: null,
                    feedUrl: 'http://127.0.0.1/rss',
                    normalizedFeedUrl: 'http://127.0.0.1/rss',
                    siteUrl: null,
                    categoryPath: [],
                },
            ],
        });
        const claim = await repository.claimJob({
            operationId: 'opml-terminal-failure',
            owner: 'failure-consumer',
            now,
            leaseMs: 10_000,
        });
        if (claim.type !== 'claimed') throw new Error('Expected claim');

        await repository.recordFailure({
            claim: claim.claim,
            failedAt: now + 1,
            retryable: false,
            retryAt: now + 30_000,
            errorClass: 'FeedPolicyError',
            errorMessage: 'forbidden_ip_address',
        });

        await expect(
            repository.getImport(userId, 731_001),
        ).resolves.toMatchObject({
            state: 'completed',
            failedItems: 1,
            errors: [
                {
                    position: 0,
                    feedUrl: 'http://127.0.0.1/rss',
                    errorClass: 'FeedPolicyError',
                },
            ],
        });
        await expect(
            repository.recordDeadLetter({
                operationId: 'opml-terminal-failure',
                now: now + 2,
                errorClass: 'queue_dead_letter',
                errorMessage: 'duplicate delivery',
            }),
        ).resolves.toBe(false);
        await expect(
            repository.getImport(userId, 731_001),
        ).resolves.toMatchObject({
            failedItems: 1,
        });
    });
});

import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { makeFaviconJobRepository } from './job-repository';
import { FAVICON_REFRESH_JOB_KIND, FAVICON_REFRESH_TOPIC } from './job-types';

const d1 = makeD1(env.DB);
const repository = makeFaviconJobRepository(d1);

const insertSubscribedFeed = async (
    seed: number,
    now: number,
): Promise<number> => {
    const userId = seed;
    const feedId = seed + 1;
    const categoryId = seed + 2;
    await Effect.runPromise(
        d1.batch([
            {
                sql: `INSERT INTO users (
                        id, webauthn_user_handle, username, email,
                        display_name, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'Queue owner', ?, ?)`,
                bindings: [
                    userId,
                    new Uint8Array(32).fill(seed % 255),
                    `favicon-job-${seed}`,
                    `favicon-job-${seed}@example.test`,
                    now,
                    now,
                ],
            },
            {
                sql: `INSERT INTO feeds (
                        id, name, feed_url, site_url, favicon_url,
                        next_refresh_at, created_at, updated_at
                    ) VALUES (?, 'Queued favicon', ?, ?, ?, ?, ?, ?)`,
                bindings: [
                    feedId,
                    `https://feed-${seed}.example.test/rss.xml`,
                    `https://feed-${seed}.example.test/`,
                    `https://feed-${seed}.example.test/favicon.ico`,
                    now,
                    now,
                    now,
                ],
            },
            {
                sql: `INSERT INTO subscription_categories (
                        id, user_id, name, created_at, updated_at
                    ) VALUES (?, ?, 'Queued', ?, ?)`,
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
    return feedId;
};

const first = <T>(sql: string, bindings: readonly unknown[] = []) =>
    Effect.runPromise(d1.first<T>({ sql, bindings }));

describe('favicon durable job repository', () => {
    it('admits one active job per feed and completes a duplicate-safe claim', async () => {
        const now = 2_200_000_000_000;
        const feedId = await insertSubscribedFeed(970_000, now);
        await expect(repository.listStaleFeedIds(now, 5)).resolves.toContain(
            feedId,
        );

        await expect(
            repository.createJob({
                jobId: 970_010,
                outboxId: 970_011,
                operationId: 'favicon-refresh:workerd-one',
                feedId,
                cutoff: now,
                force: false,
                maxAttempts: 6,
                now,
            }),
        ).resolves.toBe(true);
        await expect(
            repository.createJob({
                jobId: 970_012,
                outboxId: 970_013,
                operationId: 'favicon-refresh:workerd-duplicate',
                feedId,
                cutoff: now,
                force: false,
                maxAttempts: 6,
                now,
            }),
        ).resolves.toBe(false);

        const [message] = await repository.leaseOutbox({
            owner: 'dispatcher',
            now: now + 1,
            leaseMs: 60_000,
            limit: 1,
        });
        expect(message?.operationId).toBe('favicon-refresh:workerd-one');
        if (message === undefined) throw new Error('Expected favicon outbox');
        await repository.markDispatched(message, now + 2);

        const claimed = await repository.claimJob({
            operationId: message.operationId,
            owner: 'consumer',
            now: now + 3,
            leaseMs: 300_000,
        });
        expect(claimed).toMatchObject({
            type: 'claimed',
            claim: { feedId, attemptCount: 1 },
        });
        if (claimed.type !== 'claimed') throw new Error('Expected claim');
        const reclaimed = await repository.claimJob({
            operationId: message.operationId,
            owner: 'replacement',
            now: now + 300_004,
            leaseMs: 300_000,
        });
        expect(reclaimed).toMatchObject({
            type: 'claimed',
            claim: { feedId, attemptCount: 2, leaseOwner: 'replacement' },
        });
        if (reclaimed.type !== 'claimed')
            throw new Error('Expected reclaimed job');
        await repository.completeJob(reclaimed.claim, now + 300_005);
        await expect(
            repository.claimJob({
                operationId: message.operationId,
                owner: 'duplicate',
                now: now + 300_006,
                leaseMs: 300_000,
            }),
        ).resolves.toEqual({ type: 'completed', state: 'succeeded' });
    });

    it('dead-letters an exhausted poison favicon and applies a cooldown', async () => {
        const now = 2_200_001_000_000;
        const feedId = await insertSubscribedFeed(971_000, now);
        const operationId = 'favicon-refresh:workerd-poison';
        await repository.createJob({
            jobId: 971_010,
            outboxId: 971_011,
            operationId,
            feedId,
            cutoff: now,
            force: false,
            maxAttempts: 1,
            now,
        });
        const [message] = await repository.leaseOutbox({
            owner: 'dispatcher',
            now: now + 1,
            leaseMs: 60_000,
            limit: 1,
            operationId,
        });
        if (message === undefined) throw new Error('Expected poison outbox');
        await repository.markDispatched(message, now + 2);
        const claimed = await repository.claimJob({
            operationId,
            owner: 'consumer',
            now: now + 3,
            leaseMs: 300_000,
        });
        if (claimed.type !== 'claimed') throw new Error('Expected claim');

        await expect(
            repository.recordFailure({
                claim: claimed.claim,
                now: now + 4,
                availableAt: now + 30_004,
                errorClass: 'FaviconDiscoveryError',
            }),
        ).resolves.toEqual({ terminal: true });
        await expect(
            first<{
                readonly state: string;
                readonly favicon_updated_at: number;
            }>(
                `SELECT j.state, f.favicon_updated_at
                 FROM jobs j
                 JOIN feeds f ON f.id = json_extract(j.payload_json, '$.feedId')
                 WHERE j.operation_id = ? AND j.kind = ?`,
                [operationId, FAVICON_REFRESH_JOB_KIND],
            ),
        ).resolves.toEqual({
            state: 'dead_lettered',
            favicon_updated_at: now + 4,
        });
        await expect(
            repository.listStaleFeedIds(now + 5 - 30 * 24 * 60 * 60_000, 5),
        ).resolves.not.toContain(feedId);
        await expect(
            first<{ readonly state: string; readonly sent_at: number | null }>(
                `SELECT state, sent_at FROM outbox_messages
                 WHERE job_id = (SELECT id FROM jobs WHERE operation_id = ?)`,
                [operationId],
            ),
        ).resolves.toEqual({ state: 'dead_lettered', sent_at: null });
    });

    it('admits an owned manual command for a fresh favicon', async () => {
        const now = 2_200_001_500_000;
        const feedId = await insertSubscribedFeed(971_500, now);
        await Effect.runPromise(
            d1.run({
                sql: `UPDATE feeds SET favicon_updated_at = ? WHERE id = ?`,
                bindings: [now, feedId],
            }),
        );

        await expect(
            repository.createJob({
                jobId: 971_510,
                outboxId: 971_511,
                operationId: 'favicon-refresh:fresh-scheduled',
                feedId,
                cutoff: now - 30 * 24 * 60 * 60_000,
                force: false,
                maxAttempts: 6,
                now,
            }),
        ).resolves.toBe(false);
        await expect(
            repository.createJob({
                jobId: 971_512,
                outboxId: 971_513,
                operationId: 'favicon-refresh:fresh-manual',
                feedId,
                cutoff: now - 30 * 24 * 60 * 60_000,
                force: true,
                maxAttempts: 6,
                now,
            }),
        ).resolves.toBe(true);
    });

    it('reopens an old sent operation without changing its identity', async () => {
        const now = 2_200_002_000_000;
        const feedId = await insertSubscribedFeed(972_000, now);
        const operationId = 'favicon-refresh:workerd-redrive';
        await repository.createJob({
            jobId: 972_010,
            outboxId: 972_011,
            operationId,
            feedId,
            cutoff: now,
            force: false,
            maxAttempts: 6,
            now,
        });
        const [message] = await repository.leaseOutbox({
            owner: 'dispatcher',
            now: now + 1,
            leaseMs: 60_000,
            limit: 1,
            operationId,
        });
        if (message === undefined) throw new Error('Expected redrive outbox');
        await repository.markDispatched(message, now + 2);

        await expect(
            repository.reconcileStrandedJobs({
                now: now + 1_000_000,
                staleBefore: now + 900_000,
                limit: 1,
            }),
        ).resolves.toEqual({ redriven: 1, deadLettered: 0 });
        await expect(
            first<{
                readonly job_state: string;
                readonly outbox_state: string;
                readonly topic: string;
                readonly payload_json: string;
            }>(
                `SELECT j.state AS job_state, o.state AS outbox_state,
                        o.topic, o.payload_json
                 FROM jobs j JOIN outbox_messages o ON o.job_id = j.id
                 WHERE j.operation_id = ?`,
                [operationId],
            ),
        ).resolves.toEqual({
            job_state: 'pending',
            outbox_state: 'pending',
            topic: FAVICON_REFRESH_TOPIC,
            payload_json: JSON.stringify({ operationId }),
        });
    });
});

import { describe, expect, it } from 'vitest';
import { makeJobOrchestrator, retryBackoffMs } from './orchestration';
import type { JobRepository } from './repository';
import type { LeasedOutboxMessage, RefreshQueueMessage } from './types';

const unusedProcessor = async () => ({
    type: 'not_modified' as const,
    etag: null,
    lastModified: null,
    httpStatus: 304 as const,
});

const leasedMessage: LeasedOutboxMessage = {
    id: 1,
    jobId: 2,
    operationId: 'refresh-operation',
    attemptCount: 0,
    leaseOwner: 'outbox-owner',
    leaseExpiresAt: 2_000,
};

const repository = (overrides: Partial<JobRepository>): JobRepository =>
    overrides as JobRepository;

const sequentialIds = () => {
    let id = 100;
    return async () => {
        id += 1;
        return id;
    };
};

describe('job orchestration', () => {
    it('sends only stable operation IDs and recovers ambiguous sends by duplication', async () => {
        const sent: RefreshQueueMessage[] = [];
        let markAttempts = 0;
        const service = makeJobOrchestrator({
            repository: repository({
                leaseOutbox: async () => [leasedMessage],
                markDispatched: async () => {
                    markAttempts += 1;
                    if (markAttempts === 1) throw new Error('D1 unavailable');
                },
            }),
            queue: { send: async (message) => void sent.push(message) },
            processor: unusedProcessor,
            now: () => 1_000,
            generateToken: async () => 'owner-token',
        });

        await expect(service.dispatchOutbox(1)).resolves.toEqual({
            leased: 1,
            sent: 0,
            released: 0,
            ambiguous: 1,
        });
        await expect(service.dispatchOutbox(1)).resolves.toEqual({
            leased: 1,
            sent: 1,
            released: 0,
            ambiguous: 0,
        });
        expect(sent).toEqual([
            { operationId: 'refresh-operation' },
            { operationId: 'refresh-operation' },
        ]);
        expect(JSON.stringify(sent)).not.toContain('feedUrl');
        expect(JSON.stringify(sent)).not.toContain('content');
    });

    it('releases failed sends with exponential bounded backoff', async () => {
        let releasedAt = 0;
        const service = makeJobOrchestrator({
            repository: repository({
                leaseOutbox: async () => [
                    { ...leasedMessage, attemptCount: 4 },
                ],
                releaseOutbox: async (input) => {
                    releasedAt = input.availableAt;
                },
            }),
            queue: {
                send: async () => {
                    throw new Error('queue unavailable');
                },
            },
            processor: unusedProcessor,
            now: () => 10_000,
            generateToken: async () => 'owner-token',
        });

        await expect(service.dispatchOutbox()).resolves.toMatchObject({
            released: 1,
            sent: 0,
        });
        expect(releasedAt).toBe(10_000 + retryBackoffMs(5));
        expect(retryBackoffMs(100)).toBe(6 * 60 * 60_000);
    });

    it('returns individual ack retry and dead decisions without Queue globals', async () => {
        const service = makeJobOrchestrator({
            repository: repository({
                claimRefreshJob: async ({ operationId }) => {
                    if (operationId === 'done') {
                        return { type: 'completed', state: 'succeeded' };
                    }
                    return {
                        type: 'busy',
                        retryAt: 11_500,
                    };
                },
            }),
            queue: { send: async () => undefined },
            processor: unusedProcessor,
            now: () => 10_000,
            generateToken: async () => 'owner-token',
        });

        await expect(
            service.processQueueMessage({ operationId: 'done' }),
        ).resolves.toEqual({ action: 'ack', reason: 'succeeded' });
        await expect(
            service.processQueueMessage({ operationId: 'busy' }),
        ).resolves.toEqual({
            action: 'retry',
            reason: 'job_busy',
            retryDelaySeconds: 2,
        });
        await expect(
            service.processQueueMessage({
                operationId: 'done',
                feedUrl: 'secret',
            }),
        ).resolves.toEqual({ action: 'dead', reason: 'invalid_message' });
    });

    it('runs bounded stale recovery, due reservation, dispatch, and retention cleanup', async () => {
        const calls: string[] = [];
        const service = makeJobOrchestrator({
            repository: repository({
                recoverStaleJobLeases: async (_now, limit) => {
                    calls.push(`recover:${limit}`);
                    return 2;
                },
                cleanupRefreshHistory: async (cutoff, limit) => {
                    calls.push(`cleanup:${cutoff}:${limit}`);
                    return 3;
                },
                listDueFeeds: async (_now, limit) => {
                    calls.push(`due:${limit}`);
                    return [{ id: 9, nextRefreshAt: 500 }];
                },
                createRefreshJob: async (input) => ({
                    created: true,
                    job: {
                        id: input.jobId,
                        operationId: input.operationId,
                        feedId: input.feedId,
                        trigger: input.trigger,
                        state: 'pending',
                        attemptCount: 0,
                        maxAttempts: input.maxAttempts,
                        availableAt: input.now,
                    },
                }),
                leaseOutbox: async () => [],
            }),
            queue: { send: async () => undefined },
            processor: unusedProcessor,
            now: () => 100 * 24 * 60 * 60_000,
            generateId: sequentialIds(),
            generateToken: async () => 'token',
        });

        await expect(
            service.runCron({
                dueLimit: 7,
                dispatchLimit: 8,
                staleLeaseLimit: 6,
                cleanupLimit: 5,
            }),
        ).resolves.toEqual({
            recoveredJobs: 2,
            reservedJobs: 1,
            dispatched: { leased: 0, sent: 0, released: 0, ambiguous: 0 },
            refreshHistoryDeleted: 3,
        });
        expect(calls).toEqual([
            'recover:6',
            `cleanup:${10 * 24 * 60 * 60_000}:5`,
            'due:7',
        ]);
    });
});

import { describe, expect, it, vi } from 'vitest';
import { makeJobOrchestrator, retryBackoffMs } from './orchestration';
import type { JobRepository } from './repository';
import {
    DEFAULT_REFRESH_REDRIVE_AGE_MS,
    FEED_REFRESH_RETENTION_MS,
    type LeasedOutboxMessage,
    type RefreshQueueMessage,
    TERMINAL_JOB_RETENTION_MS,
} from './types';

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

    it('dispatches only the requested refresh operation immediately', async () => {
        const leaseOutbox = vi.fn(async () => [leasedMessage]);
        const sent: RefreshQueueMessage[] = [];
        const service = makeJobOrchestrator({
            repository: repository({
                leaseOutbox,
                markDispatched: async () => undefined,
            }),
            queue: { send: async (message) => void sent.push(message) },
            processor: unusedProcessor,
            now: () => 1_000,
            generateToken: async () => 'owner-token',
        });

        await expect(
            service.dispatchOperation('refresh-operation'),
        ).resolves.toEqual({
            leased: 1,
            sent: 1,
            released: 0,
            ambiguous: 0,
        });
        expect(leaseOutbox).toHaveBeenCalledWith({
            owner: 'outbox:owner-token',
            now: 1_000,
            leaseMs: 60_000,
            limit: 1,
            operationId: 'refresh-operation',
        });
        expect(sent).toEqual([{ operationId: 'refresh-operation' }]);
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

    it('leaves entry ID allocation to the repository', async () => {
        let generatedIds = 0;
        let committedEntries: readonly unknown[] = [];
        const scheduleFavicon = vi.fn(() =>
            Promise.reject(new Error('favicon Queue unavailable')),
        );
        const service = makeJobOrchestrator({
            repository: repository({
                claimRefreshJob: async ({ operationId, owner }) => ({
                    type: 'claimed',
                    claim: {
                        jobId: 10,
                        operationId,
                        feedId: 20,
                        trigger: 'scheduled',
                        attemptCount: 1,
                        maxAttempts: 5,
                        leaseOwner: owner,
                        leaseExpiresAt: 20_000,
                    },
                }),
                loadFeedInput: async (claim) => ({
                    ...claim,
                    feedUrl: 'https://example.test/feed.xml',
                    siteUrl: null,
                    etag: null,
                    lastModified: null,
                    subscriptionFilters: [],
                }),
                commitRefresh: async (input) => {
                    committedEntries = input.entries;
                },
            }),
            queue: { send: async () => undefined },
            scheduleFavicon,
            processor: async () => ({
                type: 'success',
                etag: null,
                lastModified: null,
                httpStatus: 200,
                entries: [
                    {
                        deduplicationKey: new Uint8Array(32),
                        sourceId: 'entry-1',
                        title: 'Entry',
                        url: null,
                        author: null,
                        publishedAt: 1_000,
                        sourceUpdatedAt: null,
                        updateMask: {
                            title: true,
                            url: true,
                            author: true,
                            publishedAt: true,
                            sourceUpdatedAt: true,
                            content: true,
                        },
                        content: { type: 'empty' },
                        filteredUserIds: [],
                    },
                ],
            }),
            now: () => 10_000,
            generateId: async () => {
                generatedIds += 1;
                return 1_000 + generatedIds;
            },
            generateToken: async () => 'lease-owner',
        });

        await expect(
            service.processQueueMessage({ operationId: 'scheduled-1' }),
        ).resolves.toEqual({ action: 'ack', reason: 'succeeded' });
        expect(generatedIds).toBe(1);
        expect(committedEntries).toHaveLength(1);
        expect(committedEntries[0]).not.toHaveProperty('id');
        expect(scheduleFavicon).toHaveBeenCalledWith(20);
    });

    it('releases a claimed job when refresh commit orchestration fails', async () => {
        const releaseRefreshJobLease = vi.fn(async () => true);
        const service = makeJobOrchestrator({
            repository: repository({
                claimRefreshJob: async ({ operationId, owner }) => ({
                    type: 'claimed',
                    claim: {
                        jobId: 10,
                        operationId,
                        feedId: 20,
                        trigger: 'scheduled',
                        attemptCount: 1,
                        maxAttempts: 5,
                        leaseOwner: owner,
                        leaseExpiresAt: 20_000,
                    },
                }),
                loadFeedInput: async (claim) => ({
                    ...claim,
                    feedUrl: 'https://example.test/feed.xml',
                    siteUrl: null,
                    etag: null,
                    lastModified: null,
                    subscriptionFilters: [],
                }),
                commitRefresh: async () => {
                    throw new Error('stale filter snapshot');
                },
                releaseRefreshJobLease,
            }),
            queue: { send: async () => undefined },
            processor: async () => ({
                type: 'not_modified',
                etag: null,
                lastModified: null,
                nextRefreshAt: 70_000,
                httpStatus: 304,
            }),
            now: () => 10_000,
            generateId: async () => 1_000,
            generateToken: async () => 'lease-owner',
        });

        await expect(
            service.processQueueMessage({ operationId: 'revision-race' }),
        ).resolves.toEqual({
            action: 'retry',
            reason: 'orchestration_error',
            retryDelaySeconds: 30,
        });
        expect(releaseRefreshJobLease).toHaveBeenCalledWith({
            claim: expect.objectContaining({
                operationId: 'revision-race',
                leaseOwner: 'refresh:lease-owner',
            }),
            now: 10_000,
            availableAt: 40_000,
            errorClass: 'orchestration_error',
            errorMessage: 'Refresh orchestration failed',
        });
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
                reconcileStrandedRefreshJobs: async (input) => {
                    calls.push(`redrive:${input.staleBefore}:${input.limit}`);
                    return { redriven: 4, deadLettered: 1 };
                },
                cleanupRefreshHistory: async (cutoff, limit) => {
                    calls.push(`cleanup:${cutoff}:${limit}`);
                    return 3;
                },
                cleanupTerminalJobs: async (cutoff, limit) => {
                    calls.push(`jobs:${cutoff}:${limit}`);
                    return 5;
                },
                listDueFeeds: async (_now, limit) => {
                    calls.push(`due:${limit}`);
                    return [{ id: 9, nextRefreshAt: 500 }];
                },
                createRefreshJob: async (input) => ({
                    type: 'created',
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
            now: () => 400 * 24 * 60 * 60_000,
            generateId: sequentialIds(),
            generateToken: async () => 'token',
        });

        await expect(
            service.runCron({
                dueLimit: 7,
                dispatchLimit: 8,
                staleLeaseLimit: 6,
                redriveLimit: 4,
                cleanupLimit: 5,
                jobCleanupLimit: 9,
            }),
        ).resolves.toEqual({
            recoveredJobs: 2,
            redrivenJobs: 4,
            deadLetteredJobs: 1,
            reservedJobs: 1,
            dispatched: { leased: 0, sent: 0, released: 0, ambiguous: 0 },
            refreshHistoryDeleted: 3,
            terminalJobsDeleted: 5,
        });
        expect(calls).toEqual([
            'recover:6',
            `redrive:${400 * 24 * 60 * 60_000 - DEFAULT_REFRESH_REDRIVE_AGE_MS}:4`,
            `cleanup:${400 * 24 * 60 * 60_000 - FEED_REFRESH_RETENTION_MS}:5`,
            `jobs:${400 * 24 * 60 * 60_000 - TERMINAL_JOB_RETENTION_MS}:9`,
            'due:7',
        ]);
    });
});

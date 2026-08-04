import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { FaviconJobRepository } from './job-repository';
import {
    decodeFaviconQueueMessage,
    faviconRetryBackoffMs,
    makeFaviconOrchestrator,
} from './orchestration';

const repository = (
    overrides: Partial<FaviconJobRepository> = {},
): FaviconJobRepository => ({
    listStaleFeedIds: async () => [],
    createJob: async () => false,
    leaseOutbox: async () => [],
    markDispatched: async () => undefined,
    releaseOutbox: async () => undefined,
    claimJob: async () => ({ type: 'missing' }),
    completeJob: async () => undefined,
    recordFailure: async () => ({ terminal: false }),
    recoverStaleJobs: async () => 0,
    reconcileStrandedJobs: async () => ({
        redriven: 0,
        deadLettered: 0,
    }),
    ...overrides,
});

const claim = {
    jobId: 10,
    operationId: 'favicon-refresh:one',
    feedId: 20,
    attemptCount: 1,
    maxAttempts: 6,
    leaseOwner: 'consumer',
    leaseExpiresAt: 301_000,
};

describe('favicon Queue orchestration', () => {
    it('accepts only one opaque operation ID', () => {
        expect(
            decodeFaviconQueueMessage({ operationId: 'favicon-refresh:one' }),
        ).toEqual({ operationId: 'favicon-refresh:one' });
        for (const value of [
            null,
            {},
            { operationId: '' },
            { operationId: 'one', feedId: 2 },
            { feedId: 2 },
        ]) {
            expect(decodeFaviconQueueMessage(value)).toBeNull();
        }
        expect(faviconRetryBackoffMs(1)).toBe(30_000);
        expect(faviconRetryBackoffMs(100)).toBe(6 * 60 * 60_000);
    });

    it('creates one durable operation and immediately dispatches it', async () => {
        const createJob = vi.fn(async () => true);
        const markDispatched = vi.fn(async () => undefined);
        const send = vi.fn(async () => undefined);
        const service = makeFaviconOrchestrator({
            repository: repository({
                createJob,
                leaseOutbox: async () => [
                    {
                        id: 2,
                        jobId: 1,
                        operationId: 'favicon-refresh:token',
                        attemptCount: 0,
                        leaseOwner: 'favicon-outbox:owner',
                        leaseExpiresAt: 61_000,
                    },
                ],
                markDispatched,
            }),
            queue: { send },
            processor: { refreshIfStale: () => Effect.succeed(null) },
            now: () => 1_000,
            generateId: async () => (createJob.mock.calls.length === 0 ? 1 : 2),
            generateToken: async () =>
                createJob.mock.calls.length === 0 ? 'token' : 'owner',
        });

        await expect(service.scheduleFeed(20)).resolves.toBe(true);
        expect(createJob).toHaveBeenCalledWith(
            expect.objectContaining({
                operationId: 'favicon-refresh:token',
                feedId: 20,
            }),
        );
        expect(send).toHaveBeenCalledWith({
            operationId: 'favicon-refresh:token',
        });
        expect(markDispatched).toHaveBeenCalledOnce();
    });

    it('completes a successful operation before acknowledging', async () => {
        const completeJob = vi.fn(async () => undefined);
        const refreshIfStale = vi.fn(() => Effect.succeed(null));
        const service = makeFaviconOrchestrator({
            repository: repository({
                claimJob: async () => ({ type: 'claimed', claim }),
                completeJob,
            }),
            queue: { send: async () => undefined },
            processor: { refreshIfStale },
            now: () => 1_000,
        });

        await expect(
            service.processQueueMessage(
                { operationId: claim.operationId },
                claim.leaseOwner,
            ),
        ).resolves.toEqual({ action: 'ack', reason: 'succeeded' });
        expect(refreshIfStale).toHaveBeenCalledWith(claim.feedId);
        expect(completeJob).toHaveBeenCalledWith(claim, 1_000);
    });

    it('records an isolated retry without completing the job', async () => {
        const completeJob = vi.fn(async () => undefined);
        const recordFailure = vi.fn(async () => ({ terminal: false }));
        const service = makeFaviconOrchestrator({
            repository: repository({
                claimJob: async () => ({ type: 'claimed', claim }),
                completeJob,
                recordFailure,
            }),
            queue: { send: async () => undefined },
            processor: {
                refreshIfStale: () =>
                    Effect.fail(new Error('publisher unavailable')),
            },
            now: () => 1_000,
        });

        await expect(
            service.processQueueMessage(
                { operationId: claim.operationId },
                claim.leaseOwner,
            ),
        ).resolves.toEqual({
            action: 'retry',
            reason: 'retryable_failure',
            retryDelaySeconds: 30,
        });
        expect(recordFailure).toHaveBeenCalledWith({
            claim,
            now: 1_000,
            availableAt: 31_000,
            errorClass: 'Error',
        });
        expect(completeJob).not.toHaveBeenCalled();
    });
});

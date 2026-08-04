import { Effect } from 'effect';

import { generateRandomToken, generateSafeId } from '../auth/crypto';
import type { FaviconJobRepository } from './job-repository';
import {
    FAVICON_JOB_LEASE_MS,
    FAVICON_MAX_BACKOFF_MS,
    FAVICON_MAX_DISPATCH,
    FAVICON_OUTBOX_LEASE_MS,
    FAVICON_QUEUE_MAX_ATTEMPTS,
    FAVICON_REDRIVE_AGE_MS,
    type FaviconCronResult,
    type FaviconDispatchResult,
    type FaviconQueueDecision,
    type FaviconQueueMessage,
} from './job-types';
import { FaviconConflict } from './repository';
import { FAVICON_STALE_AFTER_MS } from './service';

export interface FaviconQueueSender {
    readonly send: (message: FaviconQueueMessage) => Promise<void>;
}

export interface FaviconRefreshProcessor {
    readonly refreshIfStale: (
        feedId: number,
    ) => Effect.Effect<unknown, unknown>;
}

export interface FaviconOrchestratorDependencies {
    readonly repository: FaviconJobRepository;
    readonly queue: FaviconQueueSender;
    readonly processor: FaviconRefreshProcessor;
    readonly now?: () => number;
    readonly generateId?: () => Promise<number>;
    readonly generateToken?: () => Promise<string>;
    readonly jobLeaseMs?: number;
    readonly outboxLeaseMs?: number;
    readonly maxAttempts?: number;
}

export interface FaviconOrchestrator {
    readonly reserveFeed: (
        feedId: number,
        force?: boolean,
    ) => Promise<string | null>;
    readonly reserveStale: (limit?: number) => Promise<{
        readonly reserved: number;
        readonly operations: readonly string[];
    }>;
    readonly dispatchOutbox: (
        limit?: number,
        operationId?: string,
    ) => Promise<FaviconDispatchResult>;
    readonly dispatchOperation: (
        operationId: string,
    ) => Promise<FaviconDispatchResult>;
    readonly scheduleFeed: (
        feedId: number,
        force?: boolean,
    ) => Promise<boolean>;
    readonly processQueueMessage: (
        body: unknown,
        owner?: string,
    ) => Promise<FaviconQueueDecision>;
    readonly runCron: (input?: {
        readonly reserve?: boolean;
        readonly dispatch?: boolean;
        readonly reserveLimit?: number;
        readonly dispatchLimit?: number;
        readonly recoveryLimit?: number;
    }) => Promise<FaviconCronResult>;
}

const defaultGenerateId = () => Effect.runPromise(generateSafeId());
const defaultGenerateToken = () => Effect.runPromise(generateRandomToken());
const limit = (value: number | undefined, maximum: number): number =>
    Math.max(1, Math.min(maximum, Math.trunc(value ?? maximum)));

export const faviconRetryBackoffMs = (attempt: number): number => {
    const exponent = Math.max(0, Math.min(20, Math.trunc(attempt) - 1));
    return Math.min(FAVICON_MAX_BACKOFF_MS, 30_000 * 2 ** exponent);
};

export const decodeFaviconQueueMessage = (
    body: unknown,
): FaviconQueueMessage | null => {
    if (
        typeof body !== 'object' ||
        body === null ||
        !('operationId' in body) ||
        typeof body.operationId !== 'string' ||
        body.operationId.length === 0 ||
        body.operationId.length > 256 ||
        Object.keys(body).length !== 1
    )
        return null;
    return { operationId: body.operationId };
};

const retryDecision = (
    reason: string,
    now: number,
    retryAt: number,
): FaviconQueueDecision => ({
    action: 'retry',
    reason,
    retryDelaySeconds: Math.max(1, Math.ceil((retryAt - now) / 1_000)),
});

const failureClass = (cause: unknown): string => {
    if (
        typeof cause === 'object' &&
        cause !== null &&
        '_tag' in cause &&
        typeof cause._tag === 'string'
    )
        return cause._tag;
    if (cause instanceof Error && cause.name) return cause.name;
    return 'favicon_refresh_error';
};

export const makeFaviconOrchestrator = (
    dependencies: FaviconOrchestratorDependencies,
): FaviconOrchestrator => {
    const {
        repository,
        queue,
        processor,
        now = Date.now,
        generateId = defaultGenerateId,
        generateToken = defaultGenerateToken,
        jobLeaseMs = FAVICON_JOB_LEASE_MS,
        outboxLeaseMs = FAVICON_OUTBOX_LEASE_MS,
        maxAttempts = FAVICON_QUEUE_MAX_ATTEMPTS,
    } = dependencies;

    const createJob = async (
        feedId: number,
        currentTime: number,
        force = false,
    ) => {
        const [jobId, outboxId, token] = await Promise.all([
            generateId(),
            generateId(),
            generateToken(),
        ]);
        const operationId = `favicon-refresh:${token}`;
        const created = await repository.createJob({
            jobId,
            outboxId,
            operationId,
            feedId,
            cutoff: Math.max(0, currentTime - FAVICON_STALE_AFTER_MS),
            force,
            maxAttempts,
            now: currentTime,
        });
        return created ? operationId : null;
    };

    const reserveFeed = (feedId: number, force = false) =>
        createJob(feedId, now(), force);

    const reserveStale = async (requestedLimit = 1) => {
        const currentTime = now();
        const bounded = limit(requestedLimit, FAVICON_MAX_DISPATCH);
        const feeds = await repository.listStaleFeedIds(
            Math.max(0, currentTime - FAVICON_STALE_AFTER_MS),
            bounded,
        );
        const operations: string[] = [];
        for (const feedId of feeds) {
            const operationId = await createJob(feedId, currentTime);
            if (operationId !== null) operations.push(operationId);
        }
        return { reserved: operations.length, operations };
    };

    const dispatchOutbox = async (
        requestedLimit = FAVICON_MAX_DISPATCH,
        operationId?: string,
    ): Promise<FaviconDispatchResult> => {
        const currentTime = now();
        const owner = `favicon-outbox:${await generateToken()}`;
        const leased = await repository.leaseOutbox({
            owner,
            now: currentTime,
            leaseMs: outboxLeaseMs,
            limit: limit(requestedLimit, FAVICON_MAX_DISPATCH),
            ...(operationId === undefined ? {} : { operationId }),
        });
        let sent = 0;
        let released = 0;
        let ambiguous = 0;
        for (const message of leased) {
            try {
                await queue.send({ operationId: message.operationId });
            } catch (cause) {
                try {
                    await repository.releaseOutbox({
                        message,
                        now: currentTime,
                        availableAt:
                            currentTime +
                            faviconRetryBackoffMs(message.attemptCount + 1),
                        errorClass: failureClass(cause),
                    });
                    released += 1;
                } catch {
                    ambiguous += 1;
                }
                continue;
            }
            try {
                await repository.markDispatched(message, currentTime);
                sent += 1;
            } catch {
                // A successful send followed by an unknown D1 result remains
                // leased. Expiry safely sends the stable operation again.
                ambiguous += 1;
            }
        }
        return { leased: leased.length, sent, released, ambiguous };
    };

    const dispatchOperation = (operationId: string) =>
        dispatchOutbox(1, operationId);

    const scheduleFeed = async (
        feedId: number,
        force = false,
    ): Promise<boolean> => {
        const operationId = await reserveFeed(feedId, force);
        if (operationId === null) return false;
        await dispatchOperation(operationId);
        return true;
    };

    const processQueueMessage = async (
        body: unknown,
        requestedOwner?: string,
    ): Promise<FaviconQueueDecision> => {
        const message = decodeFaviconQueueMessage(body);
        if (message === null)
            return { action: 'dead', reason: 'invalid_message' };
        const currentTime = now();
        try {
            const owner =
                requestedOwner ?? `favicon-job:${await generateToken()}`;
            const result = await repository.claimJob({
                operationId: message.operationId,
                owner,
                now: currentTime,
                leaseMs: jobLeaseMs,
            });
            switch (result.type) {
                case 'completed':
                    return { action: 'ack', reason: result.state };
                case 'dead':
                    return { action: 'dead', reason: result.state };
                case 'missing':
                    return { action: 'dead', reason: 'missing_job' };
                case 'busy':
                    return retryDecision(
                        'job_busy',
                        currentTime,
                        result.retryAt,
                    );
                case 'unavailable':
                    return retryDecision(
                        'job_unavailable',
                        currentTime,
                        result.retryAt,
                    );
                case 'claimed':
                    break;
            }

            try {
                await Effect.runPromise(
                    processor.refreshIfStale(result.claim.feedId),
                );
                await repository.completeJob(result.claim, now());
                return { action: 'ack', reason: 'succeeded' };
            } catch (cause) {
                if (cause instanceof FaviconConflict) {
                    await repository.completeJob(result.claim, now());
                    return { action: 'ack', reason: 'superseded' };
                }
                const failedAt = now();
                const retryAt =
                    failedAt + faviconRetryBackoffMs(result.claim.attemptCount);
                const failure = await repository.recordFailure({
                    claim: result.claim,
                    now: failedAt,
                    availableAt: retryAt,
                    errorClass: failureClass(cause),
                });
                return failure.terminal
                    ? { action: 'dead', reason: 'terminal_failure' }
                    : retryDecision('retryable_failure', failedAt, retryAt);
            }
        } catch {
            return retryDecision(
                'orchestration_error',
                currentTime,
                currentTime + 30_000,
            );
        }
    };

    const runCron = async (
        input: {
            readonly reserve?: boolean;
            readonly dispatch?: boolean;
            readonly reserveLimit?: number;
            readonly dispatchLimit?: number;
            readonly recoveryLimit?: number;
        } = {},
    ): Promise<FaviconCronResult> => {
        const currentTime = now();
        const recoveryLimit = limit(input.recoveryLimit, FAVICON_MAX_DISPATCH);
        const recoveredJobs = await repository.recoverStaleJobs(
            currentTime,
            recoveryLimit,
        );
        const reconciled = await repository.reconcileStrandedJobs({
            now: currentTime,
            staleBefore: Math.max(0, currentTime - FAVICON_REDRIVE_AGE_MS),
            limit: recoveryLimit,
        });
        const reserved =
            input.reserve === false
                ? { reserved: 0, operations: [] }
                : await reserveStale(input.reserveLimit);
        const dispatched =
            input.dispatch === false
                ? { leased: 0, sent: 0, released: 0, ambiguous: 0 }
                : await dispatchOutbox(input.dispatchLimit);
        return {
            recoveredJobs,
            redrivenJobs: reconciled.redriven,
            deadLetteredJobs: reconciled.deadLettered,
            reservedJobs: reserved.reserved,
            dispatched,
        };
    };

    return {
        reserveFeed,
        reserveStale,
        dispatchOutbox,
        dispatchOperation,
        scheduleFeed,
        processQueueMessage,
        runCron,
    };
};

import { Effect } from 'effect';

import { generateRandomToken, generateSafeId } from '../auth/crypto';
import type { JobRepository } from './repository';
import {
    DEFAULT_JOB_LEASE_MS,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_OUTBOX_LEASE_MS,
    DEFAULT_REFRESH_INTERVAL_MS,
    DEFAULT_REFRESH_REDRIVE_AGE_MS,
    FEED_REFRESH_RETENTION_MS,
    MAX_BACKOFF_MS,
    MAX_DUE_FEEDS,
    MAX_HISTORY_CLEANUP,
    MAX_OUTBOX_MESSAGES,
    type QueueDecision,
    type QueueSender,
    type RefreshJob,
    type RefreshProcessor,
    type RefreshProcessorResult,
    type RefreshQueueMessage,
} from './types';

export interface JobOrchestratorDependencies {
    readonly repository: JobRepository;
    readonly queue: QueueSender;
    readonly processor: RefreshProcessor;
    readonly now?: () => number;
    readonly generateId?: () => Promise<number>;
    readonly generateToken?: () => Promise<string>;
    readonly jobLeaseMs?: number;
    readonly outboxLeaseMs?: number;
    readonly maxAttempts?: number;
}

export interface DispatchResult {
    readonly leased: number;
    readonly sent: number;
    readonly released: number;
    readonly ambiguous: number;
}

export interface CronResult {
    readonly recoveredJobs: number;
    readonly redrivenJobs: number;
    readonly deadLetteredJobs: number;
    readonly reservedJobs: number;
    readonly dispatched: DispatchResult;
    readonly refreshHistoryDeleted: number;
}

export interface JobOrchestrator {
    readonly createManualRefresh: (
        feedId: number,
        operationId?: string,
    ) => Promise<{
        readonly operationId: string;
        readonly created: boolean;
        readonly job: RefreshJob;
    }>;
    readonly reserveDueRefreshes: (limit?: number) => Promise<{
        readonly reserved: number;
        readonly operations: readonly string[];
    }>;
    readonly dispatchOutbox: (limit?: number) => Promise<DispatchResult>;
    readonly processQueueMessage: (
        body: unknown,
        owner?: string,
    ) => Promise<QueueDecision>;
    readonly recordDeadLetter: (
        body: unknown,
        errorClass?: string,
        errorMessage?: string,
    ) => Promise<QueueDecision>;
    readonly runCron: (input?: {
        readonly reserve?: boolean;
        readonly dispatch?: boolean;
        readonly dueLimit?: number;
        readonly dispatchLimit?: number;
        readonly staleLeaseLimit?: number;
        readonly redriveLimit?: number;
        readonly cleanupLimit?: number;
    }) => Promise<CronResult>;
}

const defaultGenerateId = () => Effect.runPromise(generateSafeId());
const defaultGenerateToken = () => Effect.runPromise(generateRandomToken());

const limit = (value: number | undefined, maximum: number): number =>
    Math.max(1, Math.min(maximum, Math.trunc(value ?? maximum)));

export const retryBackoffMs = (attempt: number): number => {
    const exponent = Math.max(0, Math.min(20, Math.trunc(attempt) - 1));
    return Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** exponent);
};

const retryDecision = (
    reason: string,
    now: number,
    retryAt: number,
): QueueDecision => ({
    action: 'retry',
    reason,
    retryDelaySeconds: Math.max(1, Math.ceil((retryAt - now) / 1_000)),
});

export const decodeRefreshQueueMessage = (
    body: unknown,
): RefreshQueueMessage | null => {
    if (
        typeof body !== 'object' ||
        body === null ||
        !('operationId' in body) ||
        typeof body.operationId !== 'string' ||
        body.operationId.length === 0 ||
        body.operationId.length > 256 ||
        Object.keys(body).length !== 1
    ) {
        return null;
    }
    return { operationId: body.operationId };
};

const processorFailure = (cause: unknown): RefreshProcessorResult => ({
    type: 'failure',
    retryable: true,
    errorClass:
        cause instanceof Error && cause.name ? cause.name : 'processor_error',
    errorMessage:
        cause instanceof Error
            ? cause.message
            : 'Feed refresh processor failed',
});

export const makeJobOrchestrator = (
    dependencies: JobOrchestratorDependencies,
): JobOrchestrator => {
    const {
        repository,
        queue,
        processor,
        now = Date.now,
        generateId = defaultGenerateId,
        generateToken = defaultGenerateToken,
        jobLeaseMs = DEFAULT_JOB_LEASE_MS,
        outboxLeaseMs = DEFAULT_OUTBOX_LEASE_MS,
        maxAttempts = DEFAULT_MAX_ATTEMPTS,
    } = dependencies;

    const createJob = async (
        feedId: number,
        operationId: string,
        trigger: 'manual' | 'scheduled',
        currentTime: number,
    ) => {
        const [jobId, outboxId] = await Promise.all([
            generateId(),
            generateId(),
        ]);
        return repository.createRefreshJob({
            jobId,
            outboxId,
            operationId,
            feedId,
            trigger,
            maxAttempts,
            now: currentTime,
        });
    };

    const createManualRefresh = async (
        feedId: number,
        requestedOperationId?: string,
    ) => {
        const operationId =
            requestedOperationId ??
            `feed-refresh:manual:${await generateToken()}`;
        const result = await createJob(feedId, operationId, 'manual', now());
        return {
            operationId: result.job.operationId,
            created: result.created,
            job: result.job,
        };
    };

    const reserveDueRefreshes = async (requestedLimit = MAX_DUE_FEEDS) => {
        const currentTime = now();
        const feeds = await repository.listDueFeeds(
            currentTime,
            limit(requestedLimit, MAX_DUE_FEEDS),
        );
        let reserved = 0;
        const operations: string[] = [];
        for (const feed of feeds) {
            const operationId = `feed-refresh:scheduled:${feed.id}:${feed.nextRefreshAt}`;
            const result = await createJob(
                feed.id,
                operationId,
                'scheduled',
                currentTime,
            );
            if (result.created) reserved += 1;
            operations.push(result.job.operationId);
        }
        return { reserved, operations };
    };

    const dispatchOutbox = async (
        requestedLimit = MAX_OUTBOX_MESSAGES,
    ): Promise<DispatchResult> => {
        const currentTime = now();
        const owner = `outbox:${await generateToken()}`;
        const leased = await repository.leaseOutbox({
            owner,
            now: currentTime,
            leaseMs: outboxLeaseMs,
            limit: limit(requestedLimit, MAX_OUTBOX_MESSAGES),
        });
        let sent = 0;
        let released = 0;
        let ambiguous = 0;
        for (const message of leased) {
            try {
                await queue.send({ operationId: message.operationId });
            } catch (cause) {
                const retryAt =
                    currentTime + retryBackoffMs(message.attemptCount + 1);
                await repository.releaseOutbox({
                    message,
                    now: currentTime,
                    availableAt: retryAt,
                    errorClass:
                        cause instanceof Error
                            ? cause.name
                            : 'queue_send_error',
                    errorMessage:
                        cause instanceof Error
                            ? cause.message
                            : 'Queue send failed',
                });
                released += 1;
                continue;
            }
            try {
                await repository.markDispatched(message, currentTime);
                sent += 1;
            } catch {
                // A send followed by an unknown D1 result is intentionally left
                // leased. Expiry causes a safe duplicate send with the same
                // operation ID; queue consumption is idempotent.
                ambiguous += 1;
            }
        }
        return { leased: leased.length, sent, released, ambiguous };
    };

    const processQueueMessage = async (
        body: unknown,
        requestedOwner?: string,
    ): Promise<QueueDecision> => {
        const message = decodeRefreshQueueMessage(body);
        if (message === null) {
            return { action: 'dead', reason: 'invalid_message' };
        }
        const currentTime = now();
        try {
            const owner = requestedOwner ?? `refresh:${await generateToken()}`;
            const claimed = await repository.claimRefreshJob({
                operationId: message.operationId,
                owner,
                now: currentTime,
                leaseMs: jobLeaseMs,
            });
            switch (claimed.type) {
                case 'completed':
                    return { action: 'ack', reason: claimed.state };
                case 'dead':
                    return { action: 'dead', reason: claimed.state };
                case 'missing':
                    return { action: 'dead', reason: 'missing_job' };
                case 'busy':
                    return retryDecision(
                        'job_busy',
                        currentTime,
                        claimed.retryAt,
                    );
                case 'unavailable':
                    return retryDecision(
                        'job_unavailable',
                        currentTime,
                        claimed.retryAt,
                    );
                case 'claimed':
                    break;
            }

            const feed = await repository.loadFeedInput(
                claimed.claim,
                currentTime,
            );
            let result: RefreshProcessorResult;
            try {
                result = await processor(feed);
            } catch (cause) {
                result = processorFailure(cause);
            }
            const completedAt = now();
            const historyId = await generateId();
            if (result.type === 'failure') {
                const retryAt =
                    completedAt +
                    Math.min(
                        MAX_BACKOFF_MS,
                        Math.max(
                            retryBackoffMs(claimed.claim.attemptCount),
                            result.retryAfterMs ?? 0,
                        ),
                    );
                const failure = await repository.recordRefreshFailure({
                    claim: claimed.claim,
                    historyId,
                    failedAt: completedAt,
                    retryable: result.retryable,
                    markGone: result.markGone,
                    errorClass: result.errorClass,
                    errorMessage: result.errorMessage,
                    httpStatus: result.httpStatus ?? null,
                    durationMs: result.durationMs ?? null,
                    retryAt,
                });
                return failure.terminal
                    ? { action: 'dead', reason: 'terminal_failure' }
                    : retryDecision(
                          'retryable_failure',
                          completedAt,
                          failure.availableAt ?? retryAt,
                      );
            }

            const entries = result.type === 'success' ? result.entries : [];
            await repository.commitRefresh({
                claim: claimed.claim,
                historyId,
                completedAt,
                etag: result.etag,
                lastModified: result.lastModified,
                nextRefreshAt:
                    result.nextRefreshAt ??
                    completedAt + DEFAULT_REFRESH_INTERVAL_MS,
                httpStatus: result.httpStatus,
                durationMs: result.durationMs ?? null,
                notModified: result.type === 'not_modified',
                ...(result.type === 'success'
                    ? {
                          feedName: result.feedName,
                          siteUrl: result.siteUrl,
                          faviconUrl: result.faviconUrl,
                      }
                    : {}),
                entries,
            });
            return {
                action: 'ack',
                reason:
                    result.type === 'not_modified'
                        ? 'not_modified'
                        : 'succeeded',
            };
        } catch {
            return retryDecision(
                'orchestration_error',
                currentTime,
                currentTime + 30_000,
            );
        }
    };

    const recordDeadLetter = async (
        body: unknown,
        klass = 'queue_dead_letter',
        message = 'Queue delivery attempts exhausted',
    ): Promise<QueueDecision> => {
        const queueMessage = decodeRefreshQueueMessage(body);
        if (queueMessage === null) {
            return { action: 'dead', reason: 'invalid_message' };
        }
        try {
            const changed = await repository.recordDeadLetter({
                operationId: queueMessage.operationId,
                historyId: await generateId(),
                now: now(),
                errorClass: klass,
                errorMessage: message,
            });
            return {
                action: 'dead',
                reason: changed ? 'dead_lettered' : 'already_terminal',
            };
        } catch {
            return {
                action: 'retry',
                reason: 'dead_letter_storage_error',
                retryDelaySeconds: 30,
            };
        }
    };

    const runCron = async (
        input: {
            readonly reserve?: boolean;
            readonly dispatch?: boolean;
            readonly dueLimit?: number;
            readonly dispatchLimit?: number;
            readonly staleLeaseLimit?: number;
            readonly redriveLimit?: number;
            readonly cleanupLimit?: number;
        } = {},
    ): Promise<CronResult> => {
        const currentTime = now();
        const recoveredJobs = await repository.recoverStaleJobLeases(
            currentTime,
            limit(input.staleLeaseLimit, MAX_DUE_FEEDS),
        );
        const reconciled = await repository.reconcileStrandedRefreshJobs({
            now: currentTime,
            staleBefore: Math.max(
                0,
                currentTime - DEFAULT_REFRESH_REDRIVE_AGE_MS,
            ),
            limit: limit(input.redriveLimit, MAX_DUE_FEEDS),
        });
        const refreshHistoryDeleted = await repository.cleanupRefreshHistory(
            Math.max(0, currentTime - FEED_REFRESH_RETENTION_MS),
            limit(input.cleanupLimit, MAX_HISTORY_CLEANUP),
        );
        const reserved =
            input.reserve === false
                ? { reserved: 0, operations: [] }
                : await reserveDueRefreshes(input.dueLimit);
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
            refreshHistoryDeleted,
        };
    };

    return {
        createManualRefresh,
        reserveDueRefreshes,
        dispatchOutbox,
        processQueueMessage,
        recordDeadLetter,
        runCron,
    };
};

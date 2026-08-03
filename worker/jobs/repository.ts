import { Effect } from 'effect';

import type { D1, D1Statement } from '../infrastructure/d1';
import { parseStoredFilterRules } from '../subscriptions/filter';
import {
    FeedNotFoundError,
    JobInvariantError,
    JobStorageError,
    RefreshLeaseLostError,
} from './errors';
import {
    type ClaimRefreshJobResult,
    type CommitRefreshInput,
    type CreateRefreshJobInput,
    DEFAULT_REFRESH_INTERVAL_MS,
    type DueFeed,
    FEED_REFRESH_JOB_KIND,
    FEED_REFRESH_TOPIC,
    type FeedRefreshInput,
    type JobState,
    type LeasedOutboxMessage,
    MAX_BACKOFF_MS,
    MAX_CONTENT_BYTES,
    MAX_DUE_FEEDS,
    MAX_ERROR_CLASS_LENGTH,
    MAX_ERROR_MESSAGE_LENGTH,
    MAX_HISTORY_CLEANUP,
    MAX_OUTBOX_ATTEMPTS,
    MAX_OUTBOX_MESSAGES,
    type RecordRefreshFailureInput,
    type RefreshFailureRecord,
    type RefreshJob,
    type RefreshJobClaim,
    type RefreshRedriveResult,
    type RefreshTrigger,
} from './types';

interface JobRow {
    readonly id: number;
    readonly operation_id: string;
    readonly payload_json: string;
    readonly state: JobState;
    readonly attempt_count: number;
    readonly max_attempts: number;
    readonly available_at: number;
    readonly lease_expires_at: number | null;
}

interface DueFeedRow {
    readonly id: number;
    readonly next_refresh_at: number;
}

interface OutboxRow {
    readonly id: number;
    readonly job_id: number;
    readonly payload_json: string;
    readonly attempt_count: number;
    readonly lease_owner: string;
    readonly lease_expires_at: number;
}

interface FeedInputRow {
    readonly feed_url: string;
    readonly site_url: string | null;
    readonly etag: string | null;
    readonly last_modified: string | null;
    readonly subscription_filters_json: string;
}

interface StrandedOutboxRow {
    readonly id: number;
    readonly exhausted: number;
}

interface JobPayload {
    readonly feedId: number;
    readonly trigger: RefreshTrigger;
}

export interface JobRepository {
    readonly createRefreshJob: (
        input: CreateRefreshJobInput,
    ) => Promise<{ readonly job: RefreshJob; readonly created: boolean }>;
    readonly listDueFeeds: (
        now: number,
        limit: number,
    ) => Promise<readonly DueFeed[]>;
    readonly leaseOutbox: (input: {
        readonly owner: string;
        readonly now: number;
        readonly leaseMs: number;
        readonly limit: number;
    }) => Promise<readonly LeasedOutboxMessage[]>;
    readonly markDispatched: (
        message: LeasedOutboxMessage,
        now: number,
    ) => Promise<void>;
    readonly releaseOutbox: (input: {
        readonly message: LeasedOutboxMessage;
        readonly now: number;
        readonly availableAt: number;
        readonly errorClass: string;
        readonly errorMessage: string;
    }) => Promise<void>;
    readonly claimRefreshJob: (input: {
        readonly operationId: string;
        readonly owner: string;
        readonly now: number;
        readonly leaseMs: number;
    }) => Promise<ClaimRefreshJobResult>;
    readonly loadFeedInput: (
        claim: RefreshJobClaim,
        now: number,
    ) => Promise<FeedRefreshInput>;
    readonly releaseRefreshJobLease: (input: {
        readonly claim: RefreshJobClaim;
        readonly now: number;
        readonly availableAt: number;
        readonly errorClass: string;
        readonly errorMessage: string;
    }) => Promise<boolean>;
    readonly recoverStaleJobLeases: (
        now: number,
        limit: number,
    ) => Promise<number>;
    readonly reconcileStrandedRefreshJobs: (input: {
        readonly now: number;
        readonly staleBefore: number;
        readonly limit: number;
    }) => Promise<RefreshRedriveResult>;
    readonly cleanupRefreshHistory: (
        cutoff: number,
        limit: number,
    ) => Promise<number>;
    readonly commitRefresh: (input: CommitRefreshInput) => Promise<void>;
    readonly recordRefreshFailure: (
        input: RecordRefreshFailureInput,
    ) => Promise<RefreshFailureRecord>;
    readonly recordDeadLetter: (input: {
        readonly operationId: string;
        readonly historyId: number;
        readonly now: number;
        readonly errorClass: string;
        readonly errorMessage: string;
    }) => Promise<boolean>;
}

const run = async <A>(operation: string, effect: Effect.Effect<A, unknown>) => {
    try {
        return await Effect.runPromise(effect);
    } catch (cause) {
        if (
            cause instanceof JobInvariantError ||
            cause instanceof FeedNotFoundError ||
            cause instanceof RefreshLeaseLostError
        ) {
            throw cause;
        }
        throw new JobStorageError(operation, cause);
    }
};

const boundedLimit = (value: number, maximum: number): number =>
    Math.max(1, Math.min(maximum, Math.trunc(value)));

const boundedText = (value: string, maximum: number): string => {
    const normalized = value.trim() || 'unknown';
    return normalized.slice(0, maximum);
};

const errorClass = (value: string) =>
    boundedText(value, MAX_ERROR_CLASS_LENGTH);
const errorMessage = (value: string) =>
    boundedText(value, MAX_ERROR_MESSAGE_LENGTH);

const dailyRefreshAggregate = (
    historyId: number,
    successful: boolean,
): D1Statement => ({
    sql: `INSERT INTO chart_daily_refreshes (
            feed_id, day_start, attempts_count, successes_count,
            failures_count, entries_created_count, created_at, updated_at
        )
        SELECT feed_id,
            refreshed_at - (refreshed_at % 86400000),
            1, ?, ?, entries_created, refreshed_at, refreshed_at
        FROM feed_refreshes
        WHERE id = ? AND changes() = 1
        ON CONFLICT(feed_id, day_start) DO UPDATE SET
            attempts_count = attempts_count + 1,
            successes_count = successes_count + excluded.successes_count,
            failures_count = failures_count + excluded.failures_count,
            entries_created_count = entries_created_count + excluded.entries_created_count,
            updated_at = excluded.updated_at`,
    bindings: [successful ? 1 : 0, successful ? 0 : 1, historyId],
});

const changeCount = (
    operation: string,
    result: D1Result<unknown> | undefined,
): number => {
    const value = result?.meta.changes;
    if (typeof value !== 'number' || value < 0) {
        throw new JobInvariantError(operation, 'missing D1 change metadata');
    }
    return value;
};

const resultRows = <T>(result: D1Result<unknown> | undefined): readonly T[] => {
    if (result === undefined || !Array.isArray(result.results)) {
        return [];
    }
    return result.results as T[];
};

const isSafeId = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isTimestamp = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const parseSubscriptionFilters = (
    value: string,
): FeedRefreshInput['subscriptionFilters'] => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new JobInvariantError(
            'loadFeedInput',
            'invalid subscription filters JSON',
        );
    }
    if (!Array.isArray(parsed)) {
        throw new JobInvariantError(
            'loadFeedInput',
            'unexpected subscription filters',
        );
    }
    return parsed.map((item) => {
        if (
            typeof item !== 'object' ||
            item === null ||
            !isSafeId(Reflect.get(item, 'userId')) ||
            !isTimestamp(Reflect.get(item, 'filterRevision')) ||
            typeof Reflect.get(item, 'rulesJson') !== 'string'
        ) {
            throw new JobInvariantError(
                'loadFeedInput',
                'unexpected subscription filter row',
            );
        }
        return {
            userId: Reflect.get(item, 'userId') as number,
            filterRevision: Reflect.get(item, 'filterRevision') as number,
            rules: parseStoredFilterRules(
                Reflect.get(item, 'rulesJson') as string,
            ),
        };
    });
};

const parsePayload = (operation: string, value: string): JobPayload => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (cause) {
        throw new JobInvariantError(
            operation,
            `invalid job payload: ${String(cause)}`,
        );
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('feedId' in parsed) ||
        !isSafeId(parsed.feedId) ||
        !('trigger' in parsed) ||
        (parsed.trigger !== 'manual' && parsed.trigger !== 'scheduled')
    ) {
        throw new JobInvariantError(operation, 'unexpected job payload');
    }
    return { feedId: parsed.feedId, trigger: parsed.trigger };
};

const parseQueuePayload = (operation: string, value: string): string => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (cause) {
        throw new JobInvariantError(
            operation,
            `invalid outbox payload: ${String(cause)}`,
        );
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('operationId' in parsed) ||
        typeof parsed.operationId !== 'string' ||
        parsed.operationId.length === 0 ||
        Object.keys(parsed).length !== 1
    ) {
        throw new JobInvariantError(operation, 'unexpected outbox payload');
    }
    return parsed.operationId;
};

const jobFromRow = (operation: string, row: JobRow): RefreshJob => {
    if (
        !isSafeId(row.id) ||
        typeof row.operation_id !== 'string' ||
        !isTimestamp(row.attempt_count) ||
        !isSafeId(row.max_attempts) ||
        !isTimestamp(row.available_at)
    ) {
        throw new JobInvariantError(operation, 'invalid job row');
    }
    const payload = parsePayload(operation, row.payload_json);
    return {
        id: row.id,
        operationId: row.operation_id,
        feedId: payload.feedId,
        trigger: payload.trigger,
        state: row.state,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        availableAt: row.available_at,
    };
};

const leasePredicate = `j.operation_id = ?
    AND j.kind = '${FEED_REFRESH_JOB_KIND}' AND j.state = 'running'
    AND j.lease_owner = ? AND j.lease_expires_at >= ?`;
const directLeasePredicate = `operation_id = ?
    AND kind = '${FEED_REFRESH_JOB_KIND}' AND state = 'running'
    AND lease_owner = ? AND lease_expires_at >= ?`;

export const makeJobRepository = (d1: D1): JobRepository => ({
    async createRefreshJob(input) {
        const operation = 'createRefreshJob';
        const jobPayload = JSON.stringify({
            feedId: input.feedId,
            trigger: input.trigger,
        });
        const queuePayload = JSON.stringify({ operationId: input.operationId });
        const results = await run(
            operation,
            d1.batch<JobRow>([
                {
                    sql: `INSERT INTO jobs (
                            id, operation_id, kind, state, payload_json,
                            max_attempts, available_at, created_at, updated_at
                        )
                        SELECT ?, ?, ?, 'pending', ?, ?, ?, ?, ?
                        FROM feeds WHERE id = ?
                        ON CONFLICT(operation_id) DO NOTHING`,
                    bindings: [
                        input.jobId,
                        input.operationId,
                        FEED_REFRESH_JOB_KIND,
                        jobPayload,
                        input.maxAttempts,
                        input.now,
                        input.now,
                        input.now,
                        input.feedId,
                    ],
                },
                {
                    sql: `INSERT INTO outbox_messages (
                            id, job_id, topic, payload_json, state, available_at,
                            created_at, updated_at
                        )
                        SELECT ?, j.id, ?, ?, 'pending', ?, ?, ?
                        FROM jobs j WHERE j.operation_id = ? AND j.kind = ?
                            AND NOT EXISTS (
                                SELECT 1 FROM outbox_messages o
                                WHERE o.job_id = j.id
                            )`,
                    bindings: [
                        input.outboxId,
                        FEED_REFRESH_TOPIC,
                        queuePayload,
                        input.now,
                        input.now,
                        input.now,
                        input.operationId,
                        FEED_REFRESH_JOB_KIND,
                    ],
                },
                {
                    sql: `SELECT id, operation_id, payload_json, state,
                            attempt_count, max_attempts, available_at,
                            lease_expires_at
                        FROM jobs WHERE operation_id = ? AND kind = ?`,
                    bindings: [input.operationId, FEED_REFRESH_JOB_KIND],
                },
                {
                    sql: `SELECT COUNT(*) AS count FROM outbox_messages o
                        JOIN jobs j ON j.id = o.job_id
                        WHERE j.operation_id = ? AND j.kind = ?
                            AND o.topic = ? AND o.payload_json = ?`,
                    bindings: [
                        input.operationId,
                        FEED_REFRESH_JOB_KIND,
                        FEED_REFRESH_TOPIC,
                        queuePayload,
                    ],
                },
            ]),
        );
        const jobChanges = changeCount(operation, results[0]);
        if (jobChanges > 1) {
            throw new JobInvariantError(operation, 'created multiple jobs');
        }
        const created = jobChanges === 1;
        const outboxChanges = changeCount(operation, results[1]);
        if (outboxChanges > 1) {
            throw new JobInvariantError(
                operation,
                'created multiple outbox rows',
            );
        }
        const row = resultRows<JobRow>(results[2])[0];
        const outboxCount = resultRows<{ readonly count: number }>(
            results[3],
        )[0]?.count;
        if (row === undefined) {
            throw new FeedNotFoundError(input.feedId);
        }
        if (outboxCount !== 1) {
            throw new JobInvariantError(
                operation,
                'job does not have one outbox row',
            );
        }
        return { job: jobFromRow(operation, row), created };
    },

    async listDueFeeds(now, limit) {
        const operation = 'listDueFeeds';
        const result = await run(
            operation,
            d1.all<DueFeedRow>({
                sql: `SELECT id, next_refresh_at FROM feeds
                    WHERE is_gone = 0 AND next_refresh_at <= ?
                    ORDER BY next_refresh_at, id LIMIT ?`,
                bindings: [now, boundedLimit(limit, MAX_DUE_FEEDS)],
            }),
        );
        return result.results.map((row) => {
            if (!isSafeId(row.id) || !isTimestamp(row.next_refresh_at)) {
                throw new JobInvariantError(operation, 'invalid due feed row');
            }
            return { id: row.id, nextRefreshAt: row.next_refresh_at };
        });
    },

    async leaseOutbox(input) {
        const operation = 'leaseOutbox';
        const leaseExpiresAt = input.now + Math.max(1, input.leaseMs);
        const results = await run(
            operation,
            d1.batch<OutboxRow>([
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'pending', lease_owner = NULL,
                            lease_expires_at = NULL,
                            available_at = MIN(available_at, ?), updated_at = ?
                        WHERE id IN (
                            SELECT o.id FROM outbox_messages o
                            JOIN jobs j ON j.id = o.job_id
                            WHERE o.topic = ? AND j.kind = ?
                              AND o.state = 'leased'
                              AND o.lease_expires_at <= ?
                            ORDER BY o.lease_expires_at, o.id LIMIT ?
                        )`,
                    bindings: [
                        input.now,
                        input.now,
                        FEED_REFRESH_TOPIC,
                        FEED_REFRESH_JOB_KIND,
                        input.now,
                        boundedLimit(input.limit, MAX_OUTBOX_MESSAGES),
                    ],
                },
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'leased', lease_owner = ?,
                            lease_expires_at = ?, updated_at = ?
                        WHERE id IN (
                            SELECT o.id FROM outbox_messages o
                            JOIN jobs j ON j.id = o.job_id
                            WHERE o.topic = ? AND j.kind = ?
                              AND o.state = 'pending' AND o.available_at <= ?
                            ORDER BY o.available_at, o.id LIMIT ?
                        )
                        RETURNING id, job_id, payload_json, attempt_count,
                            lease_owner, lease_expires_at`,
                    bindings: [
                        input.owner,
                        leaseExpiresAt,
                        input.now,
                        FEED_REFRESH_TOPIC,
                        FEED_REFRESH_JOB_KIND,
                        input.now,
                        boundedLimit(input.limit, MAX_OUTBOX_MESSAGES),
                    ],
                },
            ]),
        );
        const recoveredChanges = changeCount(operation, results[0]);
        if (recoveredChanges > boundedLimit(input.limit, MAX_OUTBOX_MESSAGES)) {
            throw new JobInvariantError(
                operation,
                'recovered beyond lease limit',
            );
        }
        const leasedChanges = changeCount(operation, results[1]);
        const rows = resultRows<OutboxRow>(results[1]);
        if (leasedChanges !== rows.length || rows.length > input.limit) {
            throw new JobInvariantError(
                operation,
                'invalid leased outbox batch',
            );
        }
        return rows.map((row) => {
            if (
                !isSafeId(row.id) ||
                !isSafeId(row.job_id) ||
                !isTimestamp(row.attempt_count) ||
                row.lease_owner !== input.owner ||
                !isTimestamp(row.lease_expires_at)
            ) {
                throw new JobInvariantError(
                    operation,
                    'invalid outbox lease row',
                );
            }
            return {
                id: row.id,
                jobId: row.job_id,
                operationId: parseQueuePayload(operation, row.payload_json),
                attemptCount: row.attempt_count,
                leaseOwner: row.lease_owner,
                leaseExpiresAt: row.lease_expires_at,
            };
        });
    },

    async markDispatched(message, now) {
        const operation = 'markDispatched';
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE jobs SET state = 'queued', updated_at = ?
                        WHERE id = ? AND operation_id = ? AND kind = ?
                            AND state IN ('pending', 'failed')
                            AND EXISTS (
                                SELECT 1 FROM outbox_messages o
                                WHERE o.id = ? AND o.job_id = jobs.id
                                  AND o.topic = ? AND o.state = 'leased'
                                  AND o.lease_owner = ?
                                  AND o.lease_expires_at >= ?
                            )`,
                    bindings: [
                        now,
                        message.jobId,
                        message.operationId,
                        FEED_REFRESH_JOB_KIND,
                        message.id,
                        FEED_REFRESH_TOPIC,
                        message.leaseOwner,
                        now,
                    ],
                },
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'sent', sent_at = ?, lease_owner = NULL,
                            lease_expires_at = NULL, updated_at = ?
                        WHERE id = ? AND job_id = ? AND topic = ?
                            AND state = 'leased' AND lease_owner = ?
                            AND lease_expires_at >= ?
                            AND EXISTS (
                                SELECT 1 FROM jobs j
                                WHERE j.id = outbox_messages.job_id
                                  AND j.operation_id = ? AND j.kind = ?
                            )`,
                    bindings: [
                        now,
                        now,
                        message.id,
                        message.jobId,
                        FEED_REFRESH_TOPIC,
                        message.leaseOwner,
                        now,
                        message.operationId,
                        FEED_REFRESH_JOB_KIND,
                    ],
                },
            ]),
        );
        const jobChanges = changeCount(operation, results[0]);
        const outboxChanges = changeCount(operation, results[1]);
        if (jobChanges > 1 || outboxChanges !== 1) {
            throw new JobInvariantError(operation, 'dispatch lease was lost');
        }
    },

    async releaseOutbox(input) {
        const operation = 'releaseOutbox';
        const klass = errorClass(input.errorClass);
        const message = errorMessage(input.errorMessage);
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE outbox_messages
                        SET state = CASE
                                WHEN attempt_count + 1 >= ?
                                THEN 'dead_lettered' ELSE 'pending' END,
                            attempt_count = attempt_count + 1,
                            available_at = ?, lease_owner = NULL,
                            lease_expires_at = NULL, last_error_class = ?,
                            last_error_message = ?, updated_at = ?
                        WHERE id = ? AND job_id = ? AND topic = ?
                            AND state = 'leased' AND lease_owner = ?
                            AND lease_expires_at >= ?
                            AND EXISTS (
                                SELECT 1 FROM jobs j
                                WHERE j.id = outbox_messages.job_id
                                  AND j.operation_id = ? AND j.kind = ?
                            )`,
                    bindings: [
                        MAX_OUTBOX_ATTEMPTS,
                        Math.max(input.now, input.availableAt),
                        klass,
                        message,
                        input.now,
                        input.message.id,
                        input.message.jobId,
                        FEED_REFRESH_TOPIC,
                        input.message.leaseOwner,
                        input.now,
                        input.message.operationId,
                        FEED_REFRESH_JOB_KIND,
                    ],
                },
                {
                    sql: `UPDATE jobs
                        SET state = 'dead_lettered', completed_at = ?,
                            last_error_class = ?, last_error_message = ?,
                            updated_at = ?
                        WHERE id = ? AND operation_id = ? AND kind = ?
                          AND state IN ('pending', 'failed')
                          AND EXISTS (
                              SELECT 1 FROM outbox_messages
                              WHERE id = ? AND job_id = jobs.id AND topic = ?
                                AND state = 'dead_lettered'
                          )`,
                    bindings: [
                        input.now,
                        klass,
                        message,
                        input.now,
                        input.message.jobId,
                        input.message.operationId,
                        FEED_REFRESH_JOB_KIND,
                        input.message.id,
                        FEED_REFRESH_TOPIC,
                    ],
                },
                {
                    sql: `UPDATE feeds
                        SET next_refresh_at = MAX(next_refresh_at + 1, ?),
                            updated_at = MAX(updated_at, ?)
                        WHERE id = (
                            SELECT json_extract(j.payload_json, '$.feedId')
                            FROM jobs j
                            JOIN outbox_messages o ON o.job_id = j.id
                            WHERE j.id = ? AND j.operation_id = ?
                              AND j.kind = ? AND o.id = ? AND o.topic = ?
                              AND j.state = 'dead_lettered'
                              AND o.state = 'dead_lettered'
                              AND json_extract(j.payload_json, '$.trigger') = 'scheduled'
                        )`,
                    bindings: [
                        Math.max(input.now, input.availableAt),
                        input.now,
                        input.message.jobId,
                        input.message.operationId,
                        FEED_REFRESH_JOB_KIND,
                        input.message.id,
                        FEED_REFRESH_TOPIC,
                    ],
                },
            ]),
        );
        if (changeCount(operation, results[0]) !== 1) {
            throw new JobInvariantError(operation, 'outbox lease was lost');
        }
        if (
            changeCount(operation, results[1]) > 1 ||
            changeCount(operation, results[2]) > 1
        ) {
            throw new JobInvariantError(
                operation,
                'updated multiple jobs or feeds',
            );
        }
    },

    async claimRefreshJob(input) {
        const operation = 'claimRefreshJob';
        const leaseExpiresAt = input.now + Math.max(1, input.leaseMs);
        const result = await run(
            operation,
            d1.run<JobRow>({
                sql: `UPDATE jobs
                    SET state = 'running', attempt_count = attempt_count + 1,
                        lease_owner = ?, lease_expires_at = ?,
                        started_at = COALESCE(started_at, ?), updated_at = ?
                    WHERE operation_id = ? AND kind = ?
                        AND state IN ('pending', 'queued', 'failed')
                        AND available_at <= ? AND attempt_count < max_attempts
                        AND NOT EXISTS (
                            SELECT 1 FROM jobs other
                            WHERE other.id <> jobs.id
                              AND other.kind = ? AND other.state = 'running'
                              AND json_extract(other.payload_json, '$.feedId') =
                                  json_extract(jobs.payload_json, '$.feedId')
                        )
                    RETURNING id, operation_id, payload_json, state,
                        attempt_count, max_attempts, available_at,
                        lease_expires_at`,
                bindings: [
                    input.owner,
                    leaseExpiresAt,
                    input.now,
                    input.now,
                    input.operationId,
                    FEED_REFRESH_JOB_KIND,
                    input.now,
                    FEED_REFRESH_JOB_KIND,
                ],
            }),
        );
        const claimedChanges = changeCount(operation, result);
        const row = result.results[0];
        if (claimedChanges === 1 && row !== undefined) {
            const job = jobFromRow(operation, row);
            return {
                type: 'claimed',
                claim: {
                    jobId: job.id,
                    operationId: job.operationId,
                    feedId: job.feedId,
                    trigger: job.trigger,
                    attemptCount: job.attemptCount,
                    maxAttempts: job.maxAttempts,
                    leaseOwner: input.owner,
                    leaseExpiresAt,
                },
            };
        }
        if (claimedChanges !== 0) {
            throw new JobInvariantError(operation, 'claimed multiple jobs');
        }
        const existing = await run(
            operation,
            d1.first<JobRow>({
                sql: `SELECT id, operation_id, payload_json, state,
                        attempt_count, max_attempts, available_at,
                        lease_expires_at
                    FROM jobs WHERE operation_id = ? AND kind = ?`,
                bindings: [input.operationId, FEED_REFRESH_JOB_KIND],
            }),
        );
        if (existing === null) return { type: 'missing' };
        const job = jobFromRow(operation, existing);
        if (job.state === 'succeeded' || job.state === 'canceled') {
            return { type: 'completed', state: job.state };
        }
        if (job.state === 'dead_lettered') {
            return { type: 'dead', state: job.state };
        }
        if (job.state === 'running') {
            return {
                type: 'busy',
                retryAt: existing.lease_expires_at ?? input.now + 1_000,
            };
        }
        const competingLease = await run(
            operation,
            d1.first<number>(
                {
                    sql: `SELECT MAX(lease_expires_at) AS retry_at
                        FROM jobs
                        WHERE id <> ? AND kind = ? AND state = 'running'
                          AND json_extract(payload_json, '$.feedId') = ?`,
                    bindings: [job.id, FEED_REFRESH_JOB_KIND, job.feedId],
                },
                'retry_at',
            ),
        );
        if (competingLease !== null && competingLease > input.now) {
            return { type: 'busy', retryAt: competingLease };
        }
        return { type: 'unavailable', retryAt: job.availableAt };
    },

    async loadFeedInput(claim, now) {
        const operation = 'loadFeedInput';
        const row = await run(
            operation,
            d1.first<FeedInputRow>({
                sql: `SELECT f.feed_url, f.site_url, f.etag, f.last_modified,
                    COALESCE((
                        SELECT json_group_array(json_object(
                            'userId', fs.user_id,
                            'filterRevision', fs.filter_revision,
                            'rulesJson', fs.filter_rules_json
                        ))
                        FROM feed_subscriptions fs
                        WHERE fs.feed_id = f.id
                          AND fs.filter_rules_json IS NOT NULL
                    ), '[]') AS subscription_filters_json
                    FROM jobs j
                    JOIN feeds f ON f.id = json_extract(j.payload_json, '$.feedId')
                    WHERE ${leasePredicate} AND f.id = ?
                      AND (
                        f.is_gone = 0
                        OR json_extract(j.payload_json, '$.trigger') = 'manual'
                      )`,
                bindings: [
                    claim.operationId,
                    claim.leaseOwner,
                    now,
                    claim.feedId,
                ],
            }),
        );
        if (row === null) {
            throw new RefreshLeaseLostError(claim.operationId);
        }
        return {
            ...claim,
            feedUrl: row.feed_url,
            siteUrl: row.site_url,
            etag: row.etag,
            lastModified: row.last_modified,
            subscriptionFilters: parseSubscriptionFilters(
                row.subscription_filters_json,
            ),
        };
    },

    async releaseRefreshJobLease(input) {
        const operation = 'releaseRefreshJobLease';
        const result = await run(
            operation,
            d1.run({
                sql: `UPDATE jobs
                    SET state = 'failed', available_at = ?,
                        lease_owner = NULL, lease_expires_at = NULL,
                        last_error_class = ?, last_error_message = ?,
                        updated_at = ?
                    WHERE operation_id = ? AND kind = ?
                      AND state = 'running' AND lease_owner = ?`,
                bindings: [
                    input.availableAt,
                    errorClass(input.errorClass),
                    errorMessage(input.errorMessage),
                    input.now,
                    input.claim.operationId,
                    FEED_REFRESH_JOB_KIND,
                    input.claim.leaseOwner,
                ],
            }),
        );
        const changed = changeCount(operation, result);
        if (changed > 1) {
            throw new JobInvariantError(operation, 'released multiple jobs');
        }
        return changed === 1;
    },

    async recoverStaleJobLeases(now, limit) {
        const operation = 'recoverStaleJobLeases';
        const bounded = boundedLimit(limit, MAX_DUE_FEEDS);
        const staleJobs = `SELECT id FROM jobs
            WHERE kind = ? AND state = 'running' AND lease_expires_at <= ?
            ORDER BY lease_expires_at, id LIMIT ?`;
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE feeds
                        SET next_refresh_at = MAX(
                                next_refresh_at + 1,
                                ? + ${DEFAULT_REFRESH_INTERVAL_MS}
                            ),
                            updated_at = MAX(updated_at, ?)
                        WHERE id IN (
                            SELECT json_extract(payload_json, '$.feedId')
                            FROM jobs
                            WHERE id IN (${staleJobs})
                              AND attempt_count >= max_attempts
                              AND json_extract(payload_json, '$.trigger') = 'scheduled'
                        )`,
                    bindings: [now, now, FEED_REFRESH_JOB_KIND, now, bounded],
                },
                {
                    sql: `UPDATE jobs
                        SET state = CASE WHEN attempt_count >= max_attempts
                                THEN 'dead_lettered' ELSE 'failed' END,
                            available_at = ?, lease_owner = NULL,
                            lease_expires_at = NULL,
                            completed_at = CASE WHEN attempt_count >= max_attempts
                                THEN ? ELSE NULL END,
                            last_error_class = 'stale_lease',
                            last_error_message = 'Worker lease expired',
                            updated_at = ?
                        WHERE id IN (
                            SELECT id FROM jobs
                            WHERE kind = ? AND state = 'running'
                              AND lease_expires_at <= ?
                            ORDER BY lease_expires_at, id LIMIT ?
                        )`,
                    bindings: [
                        now,
                        now,
                        now,
                        FEED_REFRESH_JOB_KIND,
                        now,
                        bounded,
                    ],
                },
            ]),
        );
        if (changeCount(operation, results[0]) > bounded) {
            throw new JobInvariantError(operation, 'advanced beyond job limit');
        }
        const recovered = changeCount(operation, results[1]);
        if (recovered > boundedLimit(limit, MAX_DUE_FEEDS)) {
            throw new JobInvariantError(
                operation,
                'recovered beyond job limit',
            );
        }
        return recovered;
    },

    async reconcileStrandedRefreshJobs(input) {
        const operation = 'reconcileStrandedRefreshJobs';
        const bounded = boundedLimit(input.limit, MAX_DUE_FEEDS);
        const candidates = await run(
            operation,
            d1.all<StrandedOutboxRow>({
                sql: `SELECT o.id,
                        CASE WHEN o.attempt_count >= ?
                                  OR j.attempt_count >= j.max_attempts
                            THEN 1 ELSE 0 END AS exhausted
                    FROM outbox_messages o
                    JOIN jobs j ON j.id = o.job_id
                    WHERE o.topic = ? AND o.state = 'sent'
                      AND o.updated_at <= ?
                      AND j.kind = ? AND j.state IN ('queued', 'failed')
                      AND j.updated_at <= ? AND j.available_at <= ?
                    ORDER BY o.updated_at, o.id LIMIT ?`,
                bindings: [
                    MAX_OUTBOX_ATTEMPTS,
                    FEED_REFRESH_TOPIC,
                    input.staleBefore,
                    FEED_REFRESH_JOB_KIND,
                    input.staleBefore,
                    input.now,
                    bounded,
                ],
            }),
        );
        const redriveIds: number[] = [];
        const exhaustedIds: number[] = [];
        for (const row of candidates.results) {
            if (
                !isSafeId(row.id) ||
                (row.exhausted !== 0 && row.exhausted !== 1)
            ) {
                throw new JobInvariantError(
                    operation,
                    'invalid stranded outbox row',
                );
            }
            (row.exhausted === 1 ? exhaustedIds : redriveIds).push(row.id);
        }
        if (redriveIds.length + exhaustedIds.length > bounded) {
            throw new JobInvariantError(
                operation,
                'selected beyond redrive limit',
            );
        }
        if (candidates.results.length === 0) {
            return { redriven: 0, deadLettered: 0 };
        }

        const redriveJson = JSON.stringify(redriveIds);
        const exhaustedJson = JSON.stringify(exhaustedIds);
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE jobs
                        SET state = 'dead_lettered', completed_at = ?,
                            last_error_class = 'queue_redrive_exhausted',
                            last_error_message = 'Queue redrive attempts exhausted',
                            updated_at = ?
                        WHERE id IN (
                            SELECT o.job_id FROM outbox_messages o
                            JOIN json_each(?) selected
                              ON o.id = CAST(selected.value AS INTEGER)
                            WHERE o.topic = ? AND o.state = 'sent'
                              AND (
                                o.attempt_count >= ?
                                OR jobs.attempt_count >= jobs.max_attempts
                              )
                        ) AND kind = ? AND state IN ('queued', 'failed')
                          AND updated_at <= ? AND available_at <= ?`,
                    bindings: [
                        input.now,
                        input.now,
                        exhaustedJson,
                        FEED_REFRESH_TOPIC,
                        MAX_OUTBOX_ATTEMPTS,
                        FEED_REFRESH_JOB_KIND,
                        input.staleBefore,
                        input.now,
                    ],
                },
                {
                    sql: `UPDATE feeds
                        SET next_refresh_at = MAX(
                                next_refresh_at + 1,
                                ? + ${DEFAULT_REFRESH_INTERVAL_MS}
                            ),
                            updated_at = MAX(updated_at, ?)
                        WHERE id IN (
                            SELECT json_extract(j.payload_json, '$.feedId')
                            FROM jobs j
                            JOIN outbox_messages o ON o.job_id = j.id
                            JOIN json_each(?) selected
                              ON o.id = CAST(selected.value AS INTEGER)
                            WHERE o.topic = ? AND o.state = 'sent'
                              AND j.kind = ? AND j.state = 'dead_lettered'
                              AND j.last_error_class = 'queue_redrive_exhausted'
                              AND j.updated_at = ?
                              AND json_extract(j.payload_json, '$.trigger') = 'scheduled'
                        )`,
                    bindings: [
                        input.now,
                        input.now,
                        exhaustedJson,
                        FEED_REFRESH_TOPIC,
                        FEED_REFRESH_JOB_KIND,
                        input.now,
                    ],
                },
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'dead_lettered', sent_at = NULL,
                            last_error_class = 'queue_redrive_exhausted',
                            last_error_message = 'Queue redrive attempts exhausted',
                            updated_at = ?
                        WHERE id IN (
                            SELECT CAST(value AS INTEGER) FROM json_each(?)
                        ) AND topic = ? AND state = 'sent'
                          AND EXISTS (
                            SELECT 1 FROM jobs j
                            WHERE j.id = outbox_messages.job_id
                              AND j.kind = ? AND j.state = 'dead_lettered'
                              AND j.last_error_class = 'queue_redrive_exhausted'
                              AND j.updated_at = ?
                          )`,
                    bindings: [
                        input.now,
                        exhaustedJson,
                        FEED_REFRESH_TOPIC,
                        FEED_REFRESH_JOB_KIND,
                        input.now,
                    ],
                },
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'pending',
                            attempt_count = attempt_count + 1,
                            available_at = ?, sent_at = NULL,
                            last_error_class = 'queue_delivery_lost',
                            last_error_message = 'Queue delivery was not observed',
                            updated_at = ?
                        WHERE id IN (
                            SELECT CAST(value AS INTEGER) FROM json_each(?)
                        ) AND topic = ? AND state = 'sent'
                          AND attempt_count < ? AND updated_at <= ?
                          AND EXISTS (
                            SELECT 1 FROM jobs j
                            WHERE j.id = outbox_messages.job_id
                              AND j.kind = ?
                              AND j.state IN ('queued', 'failed')
                              AND j.attempt_count < j.max_attempts
                              AND j.updated_at <= ? AND j.available_at <= ?
                          )`,
                    bindings: [
                        input.now,
                        input.now,
                        redriveJson,
                        FEED_REFRESH_TOPIC,
                        MAX_OUTBOX_ATTEMPTS,
                        input.staleBefore,
                        FEED_REFRESH_JOB_KIND,
                        input.staleBefore,
                        input.now,
                    ],
                },
            ]),
        );
        const terminalJobs = changeCount(operation, results[0]);
        const advancedFeeds = changeCount(operation, results[1]);
        const terminalOutbox = changeCount(operation, results[2]);
        const redriven = changeCount(operation, results[3]);
        if (
            terminalJobs > exhaustedIds.length ||
            advancedFeeds > terminalJobs ||
            terminalOutbox !== terminalJobs ||
            redriven > redriveIds.length ||
            terminalJobs + redriven > bounded
        ) {
            throw new JobInvariantError(
                operation,
                'invalid redrive reconciliation',
            );
        }
        return { redriven, deadLettered: terminalJobs };
    },

    async cleanupRefreshHistory(cutoff, limit) {
        const operation = 'cleanupRefreshHistory';
        const result = await run(
            operation,
            d1.run({
                sql: `DELETE FROM feed_refreshes
                    WHERE id IN (
                        SELECT old.id FROM feed_refreshes old
                        WHERE old.refreshed_at < ?
                            AND EXISTS (
                                SELECT 1 FROM feed_refreshes newer
                                WHERE newer.feed_id = old.feed_id
                                    AND (
                                        newer.refreshed_at > old.refreshed_at
                                        OR (
                                            newer.refreshed_at = old.refreshed_at
                                            AND newer.id > old.id
                                        )
                                    )
                            )
                        ORDER BY old.refreshed_at, old.id LIMIT ?
                    )`,
                bindings: [cutoff, boundedLimit(limit, MAX_HISTORY_CLEANUP)],
            }),
        );
        const deleted = changeCount(operation, result);
        if (deleted > boundedLimit(limit, MAX_HISTORY_CLEANUP)) {
            throw new JobInvariantError(
                operation,
                'deleted beyond cleanup limit',
            );
        }
        return deleted;
    },

    async commitRefresh(input) {
        const operation = 'commitRefresh';
        const filterRevisionMappings = JSON.stringify(
            input.subscriptionFilterRevisions,
        );
        const commitPredicate = `${leasePredicate}
            AND NOT EXISTS (
                SELECT 1 FROM feed_subscriptions current_fs
                WHERE current_fs.feed_id = ?
                  AND current_fs.filter_rules_json IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM json_each(?) snapshot
                    WHERE CAST(json_extract(snapshot.value, '$.userId') AS INTEGER)
                            = current_fs.user_id
                      AND CAST(json_extract(snapshot.value, '$.filterRevision') AS INTEGER)
                            = current_fs.filter_revision
                  )
            )
            AND NOT EXISTS (
                SELECT 1 FROM json_each(?) snapshot
                WHERE NOT EXISTS (
                    SELECT 1 FROM feed_subscriptions current_fs
                    WHERE current_fs.feed_id = ?
                      AND current_fs.filter_rules_json IS NOT NULL
                      AND current_fs.user_id = CAST(
                        json_extract(snapshot.value, '$.userId') AS INTEGER
                      )
                      AND current_fs.filter_revision = CAST(
                        json_extract(snapshot.value, '$.filterRevision') AS INTEGER
                      )
                )
            )`;
        const conditionBindings = [
            input.claim.operationId,
            input.claim.leaseOwner,
            input.completedAt,
            input.claim.feedId,
            filterRevisionMappings,
            filterRevisionMappings,
            input.claim.feedId,
        ] as const;
        const statements: D1Statement[] = [];
        const mutationKinds: (
            | 'exactlyOne'
            | 'oneOrTwo'
            | 'atMostOne'
            | 'any'
        )[] = [];
        const latestEntryAt = input.entries.reduce<number | null>(
            (latest, entry) =>
                latest === null
                    ? entry.publishedAt
                    : Math.max(latest, entry.publishedAt),
            null,
        );

        statements.push({
            sql: `UPDATE feeds
                SET name = COALESCE(?, name),
                    site_url = CASE WHEN ? = 1 THEN ? ELSE site_url END,
                    favicon_updated_at = CASE
                        WHEN ? = 1 AND favicon_url IS NOT ? THEN NULL
                        ELSE favicon_updated_at END,
                    favicon_url = CASE WHEN ? = 1 THEN ? ELSE favicon_url END,
                    etag = ?, last_modified = ?, consecutive_failures = 0,
                    consecutive_not_found_failures = 0, is_gone = 0,
                    last_attempt_at = ?, last_successful_refresh_at = ?,
                    latest_entry_at = CASE
                        WHEN ? IS NULL THEN latest_entry_at
                        WHEN latest_entry_at IS NULL THEN ?
                        ELSE MAX(latest_entry_at, ?) END,
                    next_refresh_at = ?, last_error_class = NULL,
                    last_error_message = NULL, updated_at = ?
                WHERE id = ? AND EXISTS (
                    SELECT 1 FROM jobs j WHERE ${commitPredicate}
                )`,
            bindings: [
                input.feedName ?? null,
                input.siteUrl === undefined ? 0 : 1,
                input.siteUrl ?? null,
                input.faviconUrl === undefined ? 0 : 1,
                input.faviconUrl ?? null,
                input.faviconUrl === undefined ? 0 : 1,
                input.faviconUrl ?? null,
                input.etag,
                input.lastModified,
                input.completedAt,
                input.completedAt,
                latestEntryAt,
                latestEntryAt,
                latestEntryAt,
                Math.max(input.completedAt, input.nextRefreshAt),
                input.completedAt,
                input.claim.feedId,
                ...conditionBindings,
            ],
        });
        mutationKinds.push('exactlyOne');

        for (const entry of input.entries) {
            const contentStatus = entry.content.type;
            statements.push({
                sql: `INSERT INTO entries (
                        id, feed_id, deduplication_key, source_id, title, url,
                        author, published_at, source_updated_at, content_status,
                        created_at, updated_at
                    )
                    SELECT sequence.next_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                    FROM entry_id_sequence sequence
                    WHERE sequence.singleton = 1 AND EXISTS (
                        SELECT 1 FROM jobs j WHERE ${commitPredicate}
                    )
                    ON CONFLICT(feed_id, deduplication_key) DO UPDATE SET
                        source_id = COALESCE(excluded.source_id, entries.source_id),
                        title = CASE WHEN ? = 1
                            THEN excluded.title ELSE entries.title END,
                        url = CASE WHEN ? = 1
                            THEN excluded.url ELSE entries.url END,
                        author = CASE WHEN ? = 1
                            THEN excluded.author ELSE entries.author END,
                        published_at = CASE WHEN ? = 1
                            THEN excluded.published_at ELSE entries.published_at END,
                        source_updated_at = CASE WHEN ? = 1
                            THEN excluded.source_updated_at ELSE entries.source_updated_at END,
                        content_status = CASE WHEN ? = 1
                            THEN excluded.content_status ELSE entries.content_status END,
                        updated_at = excluded.updated_at`,
                bindings: [
                    input.claim.feedId,
                    entry.deduplicationKey,
                    entry.sourceId,
                    entry.title,
                    entry.url,
                    entry.author,
                    entry.publishedAt,
                    entry.sourceUpdatedAt,
                    contentStatus,
                    input.completedAt,
                    input.completedAt,
                    ...conditionBindings,
                    entry.updateMask.title ? 1 : 0,
                    entry.updateMask.url ? 1 : 0,
                    entry.updateMask.author ? 1 : 0,
                    entry.updateMask.publishedAt ? 1 : 0,
                    entry.updateMask.sourceUpdatedAt ? 1 : 0,
                    entry.updateMask.content ? 1 : 0,
                ],
            });
            mutationKinds.push('oneOrTwo');

            if (entry.updateMask.content && entry.content.type === 'stored') {
                const encodedSize = new TextEncoder().encode(
                    entry.content.html,
                ).byteLength;
                if (encodedSize > MAX_CONTENT_BYTES) {
                    throw new JobInvariantError(
                        operation,
                        'stored entry content exceeds D1 limit',
                    );
                }
                statements.push({
                    sql: `INSERT INTO entry_contents (
                            entry_id, content_html, content_hash,
                            encoded_size_bytes, created_at, updated_at
                        )
                        SELECT e.id, ?, ?, ?, ?, ? FROM entries e
                        WHERE e.feed_id = ? AND e.deduplication_key = ?
                            AND EXISTS (
                                SELECT 1 FROM jobs j WHERE ${commitPredicate}
                            )
                        ON CONFLICT(entry_id) DO UPDATE SET
                            content_html = excluded.content_html,
                            content_hash = excluded.content_hash,
                            encoded_size_bytes = excluded.encoded_size_bytes,
                            updated_at = excluded.updated_at`,
                    bindings: [
                        entry.content.html,
                        entry.content.hash,
                        encodedSize,
                        input.completedAt,
                        input.completedAt,
                        input.claim.feedId,
                        entry.deduplicationKey,
                        ...conditionBindings,
                    ],
                });
                mutationKinds.push('exactlyOne');
            } else if (entry.updateMask.content) {
                statements.push({
                    sql: `DELETE FROM entry_contents
                        WHERE entry_id = (
                            SELECT id FROM entries
                            WHERE feed_id = ? AND deduplication_key = ?
                        ) AND EXISTS (
                            SELECT 1 FROM jobs j WHERE ${commitPredicate}
                        )`,
                    bindings: [
                        input.claim.feedId,
                        entry.deduplicationKey,
                        ...conditionBindings,
                    ],
                });
                mutationKinds.push('atMostOne');
            }
        }

        if (input.entries.length > 0) {
            const filterMappings = JSON.stringify(
                input.entries.map((entry) => ({
                    deduplicationKey: Array.from(
                        entry.deduplicationKey,
                        (byte) => byte.toString(16).padStart(2, '0'),
                    )
                        .join('')
                        .toUpperCase(),
                    filteredUserIds: entry.filteredUserIds,
                })),
            );
            const refreshedEntryIds = `SELECT e.id
                FROM entries e
                JOIN json_each(?) mapping
                  ON hex(e.deduplication_key) = json_extract(mapping.value, '$.deduplicationKey')
                WHERE e.feed_id = ?`;
            const currentFilterRevision = `EXISTS (
                SELECT 1 FROM json_each(?) snapshot
                JOIN feed_subscriptions fs
                  ON fs.user_id = entry_interactions.user_id
                 AND fs.feed_id = entry_interactions.feed_id
                 AND fs.filter_revision = CAST(
                    json_extract(snapshot.value, '$.filterRevision') AS INTEGER
                 )
                WHERE CAST(json_extract(snapshot.value, '$.userId') AS INTEGER)
                    = entry_interactions.user_id
            )`;
            statements.push({
                sql: `DELETE FROM entry_interactions
                    WHERE feed_id = ? AND filtered_at IS NOT NULL
                      AND read_override IS NULL AND starred_at IS NULL
                      AND archived_at IS NULL
                      AND entry_id IN (${refreshedEntryIds})
                      AND ${currentFilterRevision}
                      AND EXISTS (
                        SELECT 1 FROM jobs j WHERE ${commitPredicate}
                      )`,
                bindings: [
                    input.claim.feedId,
                    filterMappings,
                    input.claim.feedId,
                    filterRevisionMappings,
                    ...conditionBindings,
                ],
            });
            mutationKinds.push('any');
            statements.push({
                sql: `UPDATE entry_interactions
                    SET filtered_at = NULL, updated_at = ?
                    WHERE feed_id = ? AND filtered_at IS NOT NULL
                      AND entry_id IN (${refreshedEntryIds})
                      AND ${currentFilterRevision}
                      AND EXISTS (
                        SELECT 1 FROM jobs j WHERE ${commitPredicate}
                      )`,
                bindings: [
                    input.completedAt,
                    input.claim.feedId,
                    filterMappings,
                    input.claim.feedId,
                    filterRevisionMappings,
                    ...conditionBindings,
                ],
            });
            mutationKinds.push('any');
            statements.push({
                sql: `INSERT INTO entry_interactions (
                        user_id, feed_id, entry_id, read_override,
                        read_changed_at, starred_at, archived_at,
                        filtered_at, created_at, updated_at
                    )
                    SELECT CAST(users.value AS INTEGER), ?, e.id,
                        NULL, NULL, NULL, NULL, ?, ?, ?
                    FROM json_each(?) mapping
                    JOIN entries e
                      ON e.feed_id = ?
                     AND hex(e.deduplication_key) = json_extract(mapping.value, '$.deduplicationKey')
                    JOIN json_each(mapping.value, '$.filteredUserIds') users
                    JOIN json_each(?) snapshot
                      ON CAST(json_extract(snapshot.value, '$.userId') AS INTEGER)
                       = CAST(users.value AS INTEGER)
                    JOIN feed_subscriptions fs
                      ON fs.user_id = CAST(users.value AS INTEGER)
                     AND fs.feed_id = e.feed_id
                     AND fs.filter_revision = CAST(
                        json_extract(snapshot.value, '$.filterRevision') AS INTEGER
                     )
                    WHERE EXISTS (
                        SELECT 1 FROM jobs j WHERE ${commitPredicate}
                    )
                    ON CONFLICT(user_id, entry_id) DO UPDATE SET
                        filtered_at = excluded.filtered_at,
                        updated_at = excluded.updated_at`,
                bindings: [
                    input.claim.feedId,
                    input.completedAt,
                    input.completedAt,
                    input.completedAt,
                    filterMappings,
                    input.claim.feedId,
                    filterRevisionMappings,
                    ...conditionBindings,
                ],
            });
            mutationKinds.push('any');
        }

        statements.push({
            sql: `INSERT INTO feed_refreshes (
                    id, feed_id, job_id, refreshed_at, was_successful,
                    was_not_modified, http_status, entries_seen,
                    entries_created, entries_updated, duration_ms, created_at
                )
                SELECT ?, ?, j.id, ?, 1, ?, ?, ?,
                    (SELECT COUNT(*) FROM entries
                     WHERE feed_id = ? AND created_at = ? AND updated_at = ?),
                    ? - (SELECT COUNT(*) FROM entries
                         WHERE feed_id = ? AND created_at = ? AND updated_at = ?),
                    ?, ?
                FROM jobs j WHERE ${commitPredicate}`,
            bindings: [
                input.historyId,
                input.claim.feedId,
                input.completedAt,
                input.notModified ? 1 : 0,
                input.httpStatus,
                input.entries.length,
                input.claim.feedId,
                input.completedAt,
                input.completedAt,
                input.entries.length,
                input.claim.feedId,
                input.completedAt,
                input.completedAt,
                input.durationMs,
                input.completedAt,
                ...conditionBindings,
            ],
        });
        mutationKinds.push('exactlyOne');
        statements.push(dailyRefreshAggregate(input.historyId, true));
        mutationKinds.push('exactlyOne');
        statements.push({
            sql: `UPDATE jobs
                SET state = 'succeeded', lease_owner = NULL,
                    lease_expires_at = NULL, completed_at = ?, updated_at = ?
                WHERE id = (
                    SELECT j.id FROM jobs j WHERE ${commitPredicate}
                )`,
            bindings: [
                input.completedAt,
                input.completedAt,
                ...conditionBindings,
            ],
        });
        mutationKinds.push('exactlyOne');

        const results = await run(operation, d1.batch(statements));
        results.forEach((result, index) => {
            const changes = changeCount(operation, result);
            const kind = mutationKinds[index];
            if (
                (kind === 'exactlyOne' && changes !== 1) ||
                (kind === 'oneOrTwo' && (changes < 1 || changes > 2)) ||
                (kind === 'atMostOne' && changes > 1)
            ) {
                throw new RefreshLeaseLostError(input.claim.operationId);
            }
        });
    },

    async recordRefreshFailure(input) {
        const operation = 'recordRefreshFailure';
        const terminal =
            !input.retryable ||
            input.claim.attemptCount >= input.claim.maxAttempts;
        const state = terminal ? 'dead_lettered' : 'failed';
        const nextRefreshAt = Math.max(input.failedAt, input.retryAt);
        const klass = errorClass(input.errorClass);
        const message = errorMessage(input.errorMessage);
        const conditionBindings = [
            input.claim.operationId,
            input.claim.leaseOwner,
            input.failedAt,
        ] as const;
        const statements: D1Statement[] = [
            {
                sql: `UPDATE feeds
                    SET consecutive_failures = consecutive_failures + 1,
                        consecutive_not_found_failures = CASE
                            WHEN ? = 1 THEN consecutive_not_found_failures + 1
                            ELSE 0 END,
                        is_gone = CASE
                            WHEN ? = 1 AND ? = 1
                              AND consecutive_not_found_failures + 1 >= 3
                            THEN 1 ELSE is_gone END,
                        last_attempt_at = ?, last_failed_refresh_at = ?,
                        next_refresh_at = CASE WHEN ? = 1 THEN
                            MAX(?, ? + CASE
                                WHEN consecutive_failures <= 0 THEN ?
                                WHEN consecutive_failures = 1 THEN ?
                                WHEN consecutive_failures = 2 THEN ?
                                WHEN consecutive_failures = 3 THEN ?
                                WHEN consecutive_failures = 4 THEN ?
                                ELSE ? END)
                            ELSE ? END,
                        last_error_class = ?, last_error_message = ?,
                        updated_at = ?
                    WHERE id = ? AND EXISTS (
                        SELECT 1 FROM jobs j WHERE ${leasePredicate}
                    )`,
                bindings: [
                    input.markGone === true ? 1 : 0,
                    input.markGone === true ? 1 : 0,
                    terminal ? 1 : 0,
                    input.failedAt,
                    input.failedAt,
                    terminal ? 1 : 0,
                    input.retryAt,
                    input.failedAt,
                    DEFAULT_REFRESH_INTERVAL_MS,
                    DEFAULT_REFRESH_INTERVAL_MS * 2,
                    DEFAULT_REFRESH_INTERVAL_MS * 4,
                    DEFAULT_REFRESH_INTERVAL_MS * 8,
                    DEFAULT_REFRESH_INTERVAL_MS * 16,
                    MAX_BACKOFF_MS,
                    nextRefreshAt,
                    klass,
                    message,
                    input.failedAt,
                    input.claim.feedId,
                    ...conditionBindings,
                ],
            },
        ];
        if (terminal) {
            statements.push({
                sql: `INSERT INTO feed_refreshes (
                        id, feed_id, job_id, refreshed_at, was_successful,
                        was_not_modified, http_status, duration_ms,
                        error_class, error_message, created_at
                    )
                    SELECT ?, ?, j.id, ?, 0, 0, ?, ?, ?, ?, ?
                    FROM jobs j WHERE ${leasePredicate}`,
                bindings: [
                    input.historyId,
                    input.claim.feedId,
                    input.failedAt,
                    input.httpStatus,
                    input.durationMs,
                    klass,
                    message,
                    input.failedAt,
                    ...conditionBindings,
                ],
            });
            statements.push(dailyRefreshAggregate(input.historyId, false));
        }
        statements.push({
            sql: `UPDATE jobs
                SET state = ?, available_at = ?, lease_owner = NULL,
                    lease_expires_at = NULL, completed_at = ?,
                    last_error_class = ?, last_error_message = ?, updated_at = ?
                WHERE ${directLeasePredicate}`,
            bindings: [
                state,
                terminal ? input.failedAt : nextRefreshAt,
                terminal ? input.failedAt : null,
                klass,
                message,
                input.failedAt,
                ...conditionBindings,
            ],
        });
        const results = await run(operation, d1.batch(statements));
        if (changeCount(operation, results[0]) !== 1) {
            throw new RefreshLeaseLostError(input.claim.operationId);
        }
        const jobIndex = statements.length - 1;
        if (
            terminal &&
            (changeCount(operation, results[1]) !== 1 ||
                changeCount(operation, results[2]) !== 1)
        ) {
            throw new RefreshLeaseLostError(input.claim.operationId);
        }
        if (changeCount(operation, results[jobIndex]) !== 1) {
            throw new RefreshLeaseLostError(input.claim.operationId);
        }
        return {
            terminal,
            availableAt: terminal
                ? null
                : Math.max(input.failedAt, input.retryAt),
        };
    },

    async recordDeadLetter(input) {
        const operation = 'recordDeadLetter';
        const klass = errorClass(input.errorClass);
        const message = errorMessage(input.errorMessage);
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'dead_lettered', sent_at = NULL,
                            lease_owner = NULL, lease_expires_at = NULL,
                            last_error_class = ?, last_error_message = ?,
                            updated_at = ?
                        WHERE job_id = (
                            SELECT id FROM jobs
                            WHERE operation_id = ? AND kind = ?
                        ) AND topic = ? AND state <> 'dead_lettered'`,
                    bindings: [
                        klass,
                        message,
                        input.now,
                        input.operationId,
                        FEED_REFRESH_JOB_KIND,
                        FEED_REFRESH_TOPIC,
                    ],
                },
                {
                    sql: `INSERT INTO feed_refreshes (
                            id, feed_id, job_id, refreshed_at, was_successful,
                            was_not_modified, error_class, error_message,
                            created_at
                        )
                        SELECT ?, json_extract(j.payload_json, '$.feedId'),
                            j.id, ?, 0, 0, ?, ?, ?
                        FROM jobs j WHERE j.operation_id = ? AND j.kind = ?
                        ON CONFLICT(job_id) DO NOTHING`,
                    bindings: [
                        input.historyId,
                        input.now,
                        klass,
                        message,
                        input.now,
                        input.operationId,
                        FEED_REFRESH_JOB_KIND,
                    ],
                },
                dailyRefreshAggregate(input.historyId, false),
                {
                    sql: `UPDATE feeds
                        SET consecutive_failures = consecutive_failures + 1,
                            last_attempt_at = ?, last_failed_refresh_at = ?,
                            next_refresh_at = CASE WHEN (
                                SELECT json_extract(j.payload_json, '$.trigger')
                                FROM jobs j
                                WHERE j.operation_id = ? AND j.kind = ?
                            ) = 'scheduled' THEN MAX(
                                next_refresh_at + 1,
                                ? + ${DEFAULT_REFRESH_INTERVAL_MS}
                            ) ELSE next_refresh_at END,
                            last_error_class = ?, last_error_message = ?,
                            updated_at = ?
                        WHERE id = (
                            SELECT json_extract(j.payload_json, '$.feedId')
                            FROM jobs j
                            WHERE j.operation_id = ? AND j.kind = ?
                        )`,
                    bindings: [
                        input.now,
                        input.now,
                        input.operationId,
                        FEED_REFRESH_JOB_KIND,
                        input.now,
                        klass,
                        message,
                        input.now,
                        input.operationId,
                        FEED_REFRESH_JOB_KIND,
                    ],
                },
                {
                    sql: `UPDATE jobs
                        SET state = 'dead_lettered', lease_owner = NULL,
                            lease_expires_at = NULL, completed_at = ?,
                            last_error_class = ?, last_error_message = ?,
                            updated_at = ?
                        WHERE operation_id = ? AND kind = ?
                            AND state NOT IN (
                                'succeeded', 'dead_lettered', 'canceled'
                            )`,
                    bindings: [
                        input.now,
                        klass,
                        message,
                        input.now,
                        input.operationId,
                        FEED_REFRESH_JOB_KIND,
                    ],
                },
            ]),
        );
        const outboxChanges = changeCount(operation, results[0]);
        const historyChanges = changeCount(operation, results[1]);
        const aggregateChanges = changeCount(operation, results[2]);
        const feedChanges = changeCount(operation, results[3]);
        const jobChanges = changeCount(operation, results[4]);
        if (
            outboxChanges > 1 ||
            historyChanges > 1 ||
            aggregateChanges > 1 ||
            feedChanges > 1 ||
            jobChanges > 1
        ) {
            throw new JobInvariantError(operation, 'updated multiple job rows');
        }
        return jobChanges === 1;
    },
});

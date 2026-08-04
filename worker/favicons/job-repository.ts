import { Effect } from 'effect';

import type { D1 } from '../infrastructure/d1';
import { JobInvariantError, JobStorageError } from '../jobs/errors';
import {
    type ClaimFaviconJobResult,
    FAVICON_MAX_DISPATCH,
    FAVICON_MAX_OUTBOX_ATTEMPTS,
    FAVICON_REFRESH_JOB_KIND,
    FAVICON_REFRESH_TOPIC,
    type FaviconJobClaim,
    type LeasedFaviconOutboxMessage,
} from './job-types';

interface JobRow {
    readonly id: number;
    readonly operation_id: string;
    readonly payload_json: string;
    readonly state:
        | 'pending'
        | 'queued'
        | 'running'
        | 'succeeded'
        | 'failed'
        | 'dead_lettered'
        | 'canceled';
    readonly attempt_count: number;
    readonly max_attempts: number;
    readonly available_at: number;
    readonly lease_expires_at: number | null;
}

interface OutboxRow {
    readonly id: number;
    readonly job_id: number;
    readonly payload_json: string;
    readonly attempt_count: number;
    readonly lease_owner: string;
    readonly lease_expires_at: number;
}

interface StateRow {
    readonly state: string;
}

interface StrandedRow {
    readonly id: number;
    readonly exhausted: number;
}

export interface FaviconJobRepository {
    readonly listStaleFeedIds: (
        cutoff: number,
        limit: number,
    ) => Promise<readonly number[]>;
    readonly createJob: (input: {
        readonly jobId: number;
        readonly outboxId: number;
        readonly operationId: string;
        readonly feedId: number;
        readonly cutoff: number;
        readonly force: boolean;
        readonly maxAttempts: number;
        readonly now: number;
    }) => Promise<boolean>;
    readonly leaseOutbox: (input: {
        readonly owner: string;
        readonly now: number;
        readonly leaseMs: number;
        readonly limit: number;
        readonly operationId?: string;
    }) => Promise<readonly LeasedFaviconOutboxMessage[]>;
    readonly markDispatched: (
        message: LeasedFaviconOutboxMessage,
        now: number,
    ) => Promise<void>;
    readonly releaseOutbox: (input: {
        readonly message: LeasedFaviconOutboxMessage;
        readonly now: number;
        readonly availableAt: number;
        readonly errorClass: string;
    }) => Promise<void>;
    readonly claimJob: (input: {
        readonly operationId: string;
        readonly owner: string;
        readonly now: number;
        readonly leaseMs: number;
    }) => Promise<ClaimFaviconJobResult>;
    readonly completeJob: (
        claim: FaviconJobClaim,
        now: number,
    ) => Promise<void>;
    readonly recordFailure: (input: {
        readonly claim: FaviconJobClaim;
        readonly now: number;
        readonly availableAt: number;
        readonly errorClass: string;
    }) => Promise<{ readonly terminal: boolean }>;
    readonly recoverStaleJobs: (now: number, limit: number) => Promise<number>;
    readonly reconcileStrandedJobs: (input: {
        readonly now: number;
        readonly staleBefore: number;
        readonly limit: number;
    }) => Promise<{ readonly redriven: number; readonly deadLettered: number }>;
}

const run = async <A>(operation: string, effect: Effect.Effect<A, unknown>) => {
    try {
        return await Effect.runPromise(effect);
    } catch (cause) {
        if (cause instanceof JobInvariantError) throw cause;
        throw new JobStorageError(operation, cause);
    }
};

const boundedLimit = (value: number): number =>
    Math.max(1, Math.min(FAVICON_MAX_DISPATCH, Math.trunc(value)));
const isSafeId = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isTimestamp = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const boundedClass = (value: string): string =>
    (value.trim() || 'favicon_refresh_error').slice(0, 64);

const changeCount = (
    operation: string,
    result: D1Result<unknown> | undefined,
): number => {
    const value = result?.meta.changes;
    if (typeof value !== 'number' || value < 0)
        throw new JobInvariantError(operation, 'missing D1 change metadata');
    return value;
};

const parseFeedId = (operation: string, payload: string): number => {
    let value: unknown;
    try {
        value = JSON.parse(payload);
    } catch {
        throw new JobInvariantError(operation, 'invalid job payload');
    }
    const feedId =
        typeof value === 'object' && value !== null
            ? Reflect.get(value, 'feedId')
            : undefined;
    if (!isSafeId(feedId) || Object.keys(value as object).length !== 1)
        throw new JobInvariantError(operation, 'unexpected job payload');
    return feedId;
};

const parseOperationId = (operation: string, payload: string): string => {
    let value: unknown;
    try {
        value = JSON.parse(payload);
    } catch {
        throw new JobInvariantError(operation, 'invalid outbox payload');
    }
    const operationId =
        typeof value === 'object' && value !== null
            ? Reflect.get(value, 'operationId')
            : undefined;
    if (
        typeof operationId !== 'string' ||
        operationId.length === 0 ||
        operationId.length > 256 ||
        Object.keys(value as object).length !== 1
    )
        throw new JobInvariantError(operation, 'unexpected outbox payload');
    return operationId;
};

const jobClaim = (
    operation: string,
    row: JobRow,
    owner: string,
    leaseExpiresAt: number,
): FaviconJobClaim => {
    if (
        !isSafeId(row.id) ||
        typeof row.operation_id !== 'string' ||
        !isTimestamp(row.attempt_count) ||
        !isSafeId(row.max_attempts)
    )
        throw new JobInvariantError(operation, 'invalid job row');
    return {
        jobId: row.id,
        operationId: row.operation_id,
        feedId: parseFeedId(operation, row.payload_json),
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        leaseOwner: owner,
        leaseExpiresAt,
    };
};

const terminalizeFeedSql = `UPDATE feeds
    SET favicon_updated_at = ?, updated_at = MAX(updated_at, ?)
    WHERE changes() = 1 AND id = (
        SELECT CAST(json_extract(payload_json, '$.feedId') AS INTEGER)
        FROM jobs WHERE operation_id = ? AND kind = ?
          AND state = 'dead_lettered'
    )`;

export const makeFaviconJobRepository = (d1: D1): FaviconJobRepository => ({
    async listStaleFeedIds(cutoff, requestedLimit) {
        const operation = 'faviconJobs.listStaleFeedIds';
        const result = await run(
            operation,
            d1.all<{ readonly id: number }>({
                sql: `SELECT f.id FROM feeds f
                    WHERE (f.favicon_updated_at IS NULL OR f.favicon_updated_at < ?)
                      AND EXISTS (
                        SELECT 1 FROM feed_subscriptions fs
                        WHERE fs.feed_id = f.id
                      )
                      AND NOT EXISTS (
                        SELECT 1 FROM jobs j
                        WHERE j.kind = ?
                          AND j.state IN ('pending', 'queued', 'running', 'failed')
                          AND CAST(json_extract(j.payload_json, '$.feedId') AS INTEGER) = f.id
                      )
                    ORDER BY COALESCE(f.favicon_updated_at, 0), f.id
                    LIMIT ?`,
                bindings: [
                    cutoff,
                    FAVICON_REFRESH_JOB_KIND,
                    boundedLimit(requestedLimit),
                ],
            }),
        );
        return result.results.map(({ id }) => {
            if (!isSafeId(id))
                throw new JobInvariantError(operation, 'invalid feed ID');
            return id;
        });
    },

    async createJob(input) {
        const operation = 'faviconJobs.createJob';
        const jobPayload = JSON.stringify({ feedId: input.feedId });
        const queuePayload = JSON.stringify({ operationId: input.operationId });
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `INSERT INTO jobs (
                            id, operation_id, kind, state, payload_json,
                            max_attempts, available_at, created_at, updated_at
                        )
                        SELECT ?, ?, ?, 'pending', ?, ?, ?, ?, ?
                        FROM feeds f WHERE f.id = ?
                          AND (
                            ? = 1 OR f.favicon_updated_at IS NULL
                            OR f.favicon_updated_at < ?
                          )
                          AND EXISTS (
                            SELECT 1 FROM feed_subscriptions fs
                            WHERE fs.feed_id = f.id
                          )
                          AND NOT EXISTS (
                            SELECT 1 FROM jobs active
                            WHERE active.kind = ?
                              AND active.state IN ('pending', 'queued', 'running', 'failed')
                              AND CAST(json_extract(active.payload_json, '$.feedId') AS INTEGER) = f.id
                          )
                        ON CONFLICT DO NOTHING`,
                    bindings: [
                        input.jobId,
                        input.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                        jobPayload,
                        input.maxAttempts,
                        input.now,
                        input.now,
                        input.now,
                        input.feedId,
                        input.force ? 1 : 0,
                        input.cutoff,
                        FAVICON_REFRESH_JOB_KIND,
                    ],
                },
                {
                    sql: `INSERT INTO outbox_messages (
                            id, job_id, topic, payload_json, state, available_at,
                            created_at, updated_at
                        )
                        SELECT ?, j.id, ?, ?, 'pending', ?, ?, ?
                        FROM jobs j
                        WHERE j.operation_id = ? AND j.kind = ?
                        ON CONFLICT(job_id) DO NOTHING`,
                    bindings: [
                        input.outboxId,
                        FAVICON_REFRESH_TOPIC,
                        queuePayload,
                        input.now,
                        input.now,
                        input.now,
                        input.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                    ],
                },
            ]),
        );
        const jobs = changeCount(operation, results[0]);
        const outbox = changeCount(operation, results[1]);
        if (jobs > 1 || outbox > 1 || jobs !== outbox)
            throw new JobInvariantError(
                operation,
                'job/outbox creation diverged',
            );
        return jobs === 1;
    },

    async leaseOutbox(input) {
        const operation = 'faviconJobs.leaseOutbox';
        const limit = boundedLimit(input.limit);
        const leaseExpiresAt = input.now + Math.max(1, input.leaseMs);
        const operationScope =
            input.operationId === undefined ? '' : ' AND j.operation_id = ?';
        const operationBindings =
            input.operationId === undefined ? [] : [input.operationId];
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
                            WHERE o.topic = ? AND j.kind = ?${operationScope}
                              AND j.state IN ('pending', 'failed')
                              AND o.state = 'leased' AND o.lease_expires_at <= ?
                            ORDER BY o.lease_expires_at, o.id LIMIT ?
                        )`,
                    bindings: [
                        input.now,
                        input.now,
                        FAVICON_REFRESH_TOPIC,
                        FAVICON_REFRESH_JOB_KIND,
                        ...operationBindings,
                        input.now,
                        limit,
                    ],
                },
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'leased', lease_owner = ?,
                            lease_expires_at = ?, updated_at = ?
                        WHERE id IN (
                            SELECT o.id FROM outbox_messages o
                            JOIN jobs j ON j.id = o.job_id
                            WHERE o.topic = ? AND j.kind = ?${operationScope}
                              AND j.state IN ('pending', 'failed')
                              AND o.state = 'pending' AND o.available_at <= ?
                            ORDER BY o.available_at, o.id LIMIT ?
                        )
                        RETURNING id, job_id, payload_json, attempt_count,
                            lease_owner, lease_expires_at`,
                    bindings: [
                        input.owner,
                        leaseExpiresAt,
                        input.now,
                        FAVICON_REFRESH_TOPIC,
                        FAVICON_REFRESH_JOB_KIND,
                        ...operationBindings,
                        input.now,
                        limit,
                    ],
                },
            ]),
        );
        if (changeCount(operation, results[0]) > limit)
            throw new JobInvariantError(operation, 'recovered beyond limit');
        const rows = results[1]?.results ?? [];
        if (changeCount(operation, results[1]) !== rows.length)
            throw new JobInvariantError(
                operation,
                'invalid outbox lease result',
            );
        return rows.map((row) => {
            if (
                !isSafeId(row.id) ||
                !isSafeId(row.job_id) ||
                !isTimestamp(row.attempt_count) ||
                row.lease_owner !== input.owner ||
                !isTimestamp(row.lease_expires_at)
            )
                throw new JobInvariantError(operation, 'invalid outbox row');
            return {
                id: row.id,
                jobId: row.job_id,
                operationId: parseOperationId(operation, row.payload_json),
                attemptCount: row.attempt_count,
                leaseOwner: row.lease_owner,
                leaseExpiresAt: row.lease_expires_at,
            };
        });
    },

    async markDispatched(message, now) {
        const operation = 'faviconJobs.markDispatched';
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
                              AND o.lease_owner = ? AND o.lease_expires_at >= ?
                          )`,
                    bindings: [
                        now,
                        message.jobId,
                        message.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                        message.id,
                        FAVICON_REFRESH_TOPIC,
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
                          AND lease_expires_at >= ?`,
                    bindings: [
                        now,
                        now,
                        message.id,
                        message.jobId,
                        FAVICON_REFRESH_TOPIC,
                        message.leaseOwner,
                        now,
                    ],
                },
            ]),
        );
        if (
            changeCount(operation, results[0]) !== 1 ||
            changeCount(operation, results[1]) !== 1
        )
            throw new JobInvariantError(operation, 'dispatch lease was lost');
    },

    async releaseOutbox(input) {
        const operation = 'faviconJobs.releaseOutbox';
        const klass = boundedClass(input.errorClass);
        const results = await run(
            operation,
            d1.batch<StateRow>([
                {
                    sql: `UPDATE outbox_messages
                        SET state = CASE WHEN attempt_count + 1 >= ?
                                THEN 'dead_lettered' ELSE 'pending' END,
                            attempt_count = attempt_count + 1,
                            available_at = ?, lease_owner = NULL,
                            lease_expires_at = NULL, last_error_class = ?,
                            last_error_message = 'Favicon Queue send failed',
                            updated_at = ?
                        WHERE id = ? AND job_id = ? AND topic = ?
                          AND state = 'leased' AND lease_owner = ?
                          AND lease_expires_at >= ?
                        RETURNING state`,
                    bindings: [
                        FAVICON_MAX_OUTBOX_ATTEMPTS,
                        Math.max(input.now, input.availableAt),
                        klass,
                        input.now,
                        input.message.id,
                        input.message.jobId,
                        FAVICON_REFRESH_TOPIC,
                        input.message.leaseOwner,
                        input.now,
                    ],
                },
                {
                    sql: `UPDATE jobs
                        SET state = 'dead_lettered', completed_at = ?,
                            last_error_class = ?,
                            last_error_message = 'Favicon Queue send attempts exhausted',
                            updated_at = ?
                        WHERE id = ? AND operation_id = ? AND kind = ?
                          AND state IN ('pending', 'failed')
                          AND EXISTS (
                            SELECT 1 FROM outbox_messages o
                            WHERE o.id = ? AND o.job_id = jobs.id
                              AND o.state = 'dead_lettered'
                          )`,
                    bindings: [
                        input.now,
                        klass,
                        input.now,
                        input.message.jobId,
                        input.message.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                        input.message.id,
                    ],
                },
                {
                    sql: terminalizeFeedSql,
                    bindings: [
                        input.now,
                        input.now,
                        input.message.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                    ],
                },
            ]),
        );
        if (changeCount(operation, results[0]) !== 1)
            throw new JobInvariantError(operation, 'outbox lease was lost');
        if (
            changeCount(operation, results[1]) > 1 ||
            changeCount(operation, results[2]) > 1
        )
            throw new JobInvariantError(
                operation,
                'terminalized multiple rows',
            );
    },

    async claimJob(input) {
        const operation = 'faviconJobs.claimJob';
        const leaseExpiresAt = input.now + Math.max(1, input.leaseMs);
        const results = await run(
            operation,
            d1.batch<JobRow>([
                {
                    sql: `UPDATE jobs
                        SET state = CASE WHEN attempt_count >= max_attempts
                                THEN 'dead_lettered' ELSE 'failed' END,
                            completed_at = CASE WHEN attempt_count >= max_attempts
                                THEN ? ELSE NULL END,
                            available_at = ?, lease_owner = NULL,
                            lease_expires_at = NULL,
                            last_error_class = 'stale_lease',
                            last_error_message = 'Favicon Worker lease expired',
                            updated_at = ?
                        WHERE operation_id = ? AND kind = ?
                          AND state = 'running' AND lease_expires_at <= ?`,
                    bindings: [
                        input.now,
                        input.now,
                        input.now,
                        input.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                        input.now,
                    ],
                },
                {
                    sql: terminalizeFeedSql,
                    bindings: [
                        input.now,
                        input.now,
                        input.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                    ],
                },
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'dead_lettered', sent_at = NULL,
                            lease_owner = NULL, lease_expires_at = NULL,
                            last_error_class = 'stale_lease',
                            last_error_message = 'Favicon Worker lease expired',
                            updated_at = ?
                        WHERE topic = ? AND state <> 'dead_lettered'
                          AND job_id = (SELECT id FROM jobs
                            WHERE operation_id = ? AND kind = ?
                              AND state = 'dead_lettered'
                              AND last_error_class = 'stale_lease'
                              AND updated_at = ?)`,
                    bindings: [
                        input.now,
                        FAVICON_REFRESH_TOPIC,
                        input.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                        input.now,
                    ],
                },
                {
                    sql: `UPDATE jobs
                        SET state = 'running', attempt_count = attempt_count + 1,
                            lease_owner = ?, lease_expires_at = ?,
                            started_at = COALESCE(started_at, ?), updated_at = ?
                        WHERE operation_id = ? AND kind = ?
                          AND state IN ('pending', 'queued', 'failed')
                          AND available_at <= ? AND attempt_count < max_attempts
                        RETURNING id, operation_id, payload_json, state,
                            attempt_count, max_attempts, available_at,
                            lease_expires_at`,
                    bindings: [
                        input.owner,
                        leaseExpiresAt,
                        input.now,
                        input.now,
                        input.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                        input.now,
                    ],
                },
            ]),
        );
        if (
            changeCount(operation, results[0]) > 1 ||
            changeCount(operation, results[1]) > 1 ||
            changeCount(operation, results[2]) > 1
        )
            throw new JobInvariantError(
                operation,
                'recovered multiple expired jobs',
            );
        const result = results[3];
        if (changeCount(operation, result) === 1 && result?.results[0])
            return {
                type: 'claimed',
                claim: jobClaim(
                    operation,
                    result.results[0],
                    input.owner,
                    leaseExpiresAt,
                ),
            };
        if (changeCount(operation, result) !== 0)
            throw new JobInvariantError(operation, 'claimed multiple jobs');
        const existing = await run(
            operation,
            d1.first<JobRow>({
                sql: `SELECT id, operation_id, payload_json, state,
                        attempt_count, max_attempts, available_at,
                        lease_expires_at
                    FROM jobs WHERE operation_id = ? AND kind = ?`,
                bindings: [input.operationId, FAVICON_REFRESH_JOB_KIND],
            }),
        );
        if (existing === null) return { type: 'missing' };
        if (existing.state === 'succeeded' || existing.state === 'canceled')
            return { type: 'completed', state: existing.state };
        if (existing.state === 'dead_lettered')
            return { type: 'dead', state: existing.state };
        if (existing.state === 'running')
            return {
                type: 'busy',
                retryAt: existing.lease_expires_at ?? input.now + 1_000,
            };
        return { type: 'unavailable', retryAt: existing.available_at };
    },

    async completeJob(claim, now) {
        const operation = 'faviconJobs.completeJob';
        const result = await run(
            operation,
            d1.run({
                sql: `UPDATE jobs
                    SET state = 'succeeded', completed_at = ?,
                        lease_owner = NULL, lease_expires_at = NULL,
                        last_error_class = NULL, last_error_message = NULL,
                        updated_at = ?
                    WHERE id = ? AND operation_id = ? AND kind = ?
                      AND state = 'running' AND lease_owner = ?
                      AND lease_expires_at >= ?`,
                bindings: [
                    now,
                    now,
                    claim.jobId,
                    claim.operationId,
                    FAVICON_REFRESH_JOB_KIND,
                    claim.leaseOwner,
                    now,
                ],
            }),
        );
        if (changeCount(operation, result) !== 1)
            throw new JobInvariantError(operation, 'job lease was lost');
    },

    async recordFailure(input) {
        const operation = 'faviconJobs.recordFailure';
        const terminal = input.claim.attemptCount >= input.claim.maxAttempts;
        const klass = boundedClass(input.errorClass);
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE jobs
                        SET state = ?, completed_at = ?, available_at = ?,
                            lease_owner = NULL, lease_expires_at = NULL,
                            last_error_class = ?,
                            last_error_message = 'Favicon refresh failed',
                            updated_at = ?
                        WHERE id = ? AND operation_id = ? AND kind = ?
                          AND state = 'running' AND lease_owner = ?
                          AND lease_expires_at >= ?`,
                    bindings: [
                        terminal ? 'dead_lettered' : 'failed',
                        terminal ? input.now : null,
                        Math.max(input.now, input.availableAt),
                        klass,
                        input.now,
                        input.claim.jobId,
                        input.claim.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                        input.claim.leaseOwner,
                        input.now,
                    ],
                },
                {
                    sql: terminalizeFeedSql,
                    bindings: [
                        input.now,
                        input.now,
                        input.claim.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                    ],
                },
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'dead_lettered', sent_at = NULL,
                            lease_owner = NULL, lease_expires_at = NULL,
                            last_error_class = ?,
                            last_error_message = 'Favicon refresh attempts exhausted',
                            updated_at = ?
                        WHERE ? = 1 AND topic = ? AND state <> 'dead_lettered'
                          AND job_id = (
                            SELECT id FROM jobs
                            WHERE operation_id = ? AND kind = ?
                              AND state = 'dead_lettered' AND updated_at = ?
                          )`,
                    bindings: [
                        klass,
                        input.now,
                        terminal ? 1 : 0,
                        FAVICON_REFRESH_TOPIC,
                        input.claim.operationId,
                        FAVICON_REFRESH_JOB_KIND,
                        input.now,
                    ],
                },
            ]),
        );
        if (changeCount(operation, results[0]) !== 1)
            throw new JobInvariantError(operation, 'job lease was lost');
        const feedChanges = changeCount(operation, results[1]);
        const outboxChanges = changeCount(operation, results[2]);
        if (feedChanges > 1 || outboxChanges !== (terminal ? 1 : 0))
            throw new JobInvariantError(operation, 'invalid failure state');
        return { terminal };
    },

    async recoverStaleJobs(now, requestedLimit) {
        const operation = 'faviconJobs.recoverStaleJobs';
        const limit = boundedLimit(requestedLimit);
        const rows = await run(
            operation,
            d1.all<{ readonly operation_id: string }>({
                sql: `SELECT operation_id FROM jobs
                    WHERE kind = ? AND state = 'running'
                      AND lease_expires_at <= ?
                    ORDER BY lease_expires_at, id LIMIT ?`,
                bindings: [FAVICON_REFRESH_JOB_KIND, now, limit],
            }),
        );
        let recovered = 0;
        for (const row of rows.results) {
            if (
                typeof row.operation_id !== 'string' ||
                row.operation_id.length === 0
            )
                throw new JobInvariantError(operation, 'invalid operation ID');
            const results = await run(
                operation,
                d1.batch([
                    {
                        sql: `UPDATE jobs
                            SET state = CASE WHEN attempt_count >= max_attempts
                                    THEN 'dead_lettered' ELSE 'failed' END,
                                completed_at = CASE WHEN attempt_count >= max_attempts
                                    THEN ? ELSE NULL END,
                                available_at = ?, lease_owner = NULL,
                                lease_expires_at = NULL,
                                last_error_class = 'stale_lease',
                                last_error_message = 'Favicon Worker lease expired',
                                updated_at = ?
                            WHERE operation_id = ? AND kind = ?
                              AND state = 'running' AND lease_expires_at <= ?`,
                        bindings: [
                            now,
                            now,
                            now,
                            row.operation_id,
                            FAVICON_REFRESH_JOB_KIND,
                            now,
                        ],
                    },
                    {
                        sql: terminalizeFeedSql,
                        bindings: [
                            now,
                            now,
                            row.operation_id,
                            FAVICON_REFRESH_JOB_KIND,
                        ],
                    },
                    {
                        sql: `UPDATE outbox_messages
                            SET state = 'dead_lettered', sent_at = NULL,
                                lease_owner = NULL, lease_expires_at = NULL,
                                last_error_class = 'stale_lease',
                                last_error_message = 'Favicon Worker lease expired',
                                updated_at = ?
                            WHERE topic = ? AND state <> 'dead_lettered'
                              AND job_id = (SELECT id FROM jobs
                                WHERE operation_id = ? AND kind = ?
                                  AND state = 'dead_lettered'
                                  AND last_error_class = 'stale_lease'
                                  AND updated_at = ?)`,
                        bindings: [
                            now,
                            FAVICON_REFRESH_TOPIC,
                            row.operation_id,
                            FAVICON_REFRESH_JOB_KIND,
                            now,
                        ],
                    },
                ]),
            );
            const jobs = changeCount(operation, results[0]);
            const feeds = changeCount(operation, results[1]);
            const outbox = changeCount(operation, results[2]);
            if (jobs > 1 || feeds > 1 || outbox > 1)
                throw new JobInvariantError(
                    operation,
                    'recovered multiple rows',
                );
            recovered += jobs;
        }
        return recovered;
    },

    async reconcileStrandedJobs(input) {
        const operation = 'faviconJobs.reconcileStrandedJobs';
        const limit = boundedLimit(input.limit);
        const candidates = await run(
            operation,
            d1.all<StrandedRow>({
                sql: `SELECT o.id,
                        CASE WHEN o.attempt_count >= ?
                                  OR j.attempt_count >= j.max_attempts
                            THEN 1 ELSE 0 END AS exhausted
                    FROM outbox_messages o
                    JOIN jobs j ON j.id = o.job_id
                    WHERE o.topic = ? AND o.state = 'sent'
                      AND o.updated_at <= ? AND j.kind = ?
                      AND j.state IN ('queued', 'failed')
                      AND j.updated_at <= ? AND j.available_at <= ?
                    ORDER BY o.updated_at, o.id LIMIT ?`,
                bindings: [
                    FAVICON_MAX_OUTBOX_ATTEMPTS,
                    FAVICON_REFRESH_TOPIC,
                    input.staleBefore,
                    FAVICON_REFRESH_JOB_KIND,
                    input.staleBefore,
                    input.now,
                    limit,
                ],
            }),
        );
        let redriven = 0;
        let deadLettered = 0;
        for (const candidate of candidates.results) {
            if (!isSafeId(candidate.id))
                throw new JobInvariantError(operation, 'invalid outbox ID');
            if (candidate.exhausted === 1) {
                const results = await run(
                    operation,
                    d1.batch([
                        {
                            sql: `UPDATE jobs
                                SET state = 'dead_lettered', completed_at = ?,
                                    last_error_class = 'queue_redrive_exhausted',
                                    last_error_message = 'Favicon Queue redrive exhausted',
                                    updated_at = ?
                                WHERE id = (
                                    SELECT job_id FROM outbox_messages
                                    WHERE id = ? AND topic = ? AND state = 'sent'
                                ) AND kind = ?
                                  AND state IN ('queued', 'failed')`,
                            bindings: [
                                input.now,
                                input.now,
                                candidate.id,
                                FAVICON_REFRESH_TOPIC,
                                FAVICON_REFRESH_JOB_KIND,
                            ],
                        },
                        {
                            sql: `UPDATE feeds
                                SET favicon_updated_at = ?,
                                    updated_at = MAX(updated_at, ?)
                                WHERE id = (
                                    SELECT CAST(json_extract(j.payload_json, '$.feedId') AS INTEGER)
                                    FROM jobs j
                                    JOIN outbox_messages o ON o.job_id = j.id
                                    WHERE o.id = ? AND o.topic = ?
                                      AND j.kind = ? AND j.state = 'dead_lettered'
                                )`,
                            bindings: [
                                input.now,
                                input.now,
                                candidate.id,
                                FAVICON_REFRESH_TOPIC,
                                FAVICON_REFRESH_JOB_KIND,
                            ],
                        },
                        {
                            sql: `UPDATE outbox_messages
                                SET state = 'dead_lettered', sent_at = NULL,
                                    last_error_class = 'queue_redrive_exhausted',
                                    last_error_message = 'Favicon Queue redrive exhausted',
                                    updated_at = ?
                                WHERE id = ? AND topic = ? AND state = 'sent'`,
                            bindings: [
                                input.now,
                                candidate.id,
                                FAVICON_REFRESH_TOPIC,
                            ],
                        },
                    ]),
                );
                if (
                    changeCount(operation, results[0]) !== 1 ||
                    changeCount(operation, results[1]) > 1 ||
                    changeCount(operation, results[2]) !== 1
                )
                    throw new JobInvariantError(
                        operation,
                        'redrive terminalization diverged',
                    );
                deadLettered += 1;
                continue;
            }
            const results = await run(
                operation,
                d1.batch([
                    {
                        sql: `UPDATE outbox_messages
                            SET state = 'pending', sent_at = NULL,
                                attempt_count = attempt_count + 1,
                                available_at = ?,
                                last_error_class = 'queue_delivery_lost',
                                last_error_message = 'Favicon Queue delivery was not observed',
                                updated_at = ?
                            WHERE id = ? AND topic = ? AND state = 'sent'`,
                        bindings: [
                            input.now,
                            input.now,
                            candidate.id,
                            FAVICON_REFRESH_TOPIC,
                        ],
                    },
                    {
                        sql: `UPDATE jobs
                            SET state = 'pending', available_at = ?, updated_at = ?
                            WHERE id = (
                                SELECT job_id FROM outbox_messages
                                WHERE id = ? AND topic = ? AND state = 'pending'
                            ) AND kind = ? AND state IN ('queued', 'failed')`,
                        bindings: [
                            input.now,
                            input.now,
                            candidate.id,
                            FAVICON_REFRESH_TOPIC,
                            FAVICON_REFRESH_JOB_KIND,
                        ],
                    },
                ]),
            );
            if (
                changeCount(operation, results[0]) !== 1 ||
                changeCount(operation, results[1]) !== 1
            )
                throw new JobInvariantError(
                    operation,
                    'redrive state diverged',
                );
            redriven += 1;
        }
        return { redriven, deadLettered };
    },
});

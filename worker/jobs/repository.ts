import { Effect } from 'effect';

import type { D1, D1Statement } from '../infrastructure/d1';
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
    type DueFeed,
    FEED_REFRESH_JOB_KIND,
    FEED_REFRESH_TOPIC,
    type FeedRefreshInput,
    type JobState,
    type LeasedOutboxMessage,
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
    readonly etag: string | null;
    readonly last_modified: string | null;
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
    readonly recoverStaleJobLeases: (
        now: number,
        limit: number,
    ) => Promise<number>;
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

const leasePredicate = `j.operation_id = ? AND j.state = 'running'
    AND j.lease_owner = ? AND j.lease_expires_at >= ?`;
const directLeasePredicate = `operation_id = ? AND state = 'running'
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
                        WHERE j.operation_id = ? AND o.topic = ?
                            AND o.payload_json = ?`,
                    bindings: [
                        input.operationId,
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
                            SELECT id FROM outbox_messages
                            WHERE state = 'leased' AND lease_expires_at <= ?
                            ORDER BY lease_expires_at, id LIMIT ?
                        )`,
                    bindings: [
                        input.now,
                        input.now,
                        input.now,
                        boundedLimit(input.limit, MAX_OUTBOX_MESSAGES),
                    ],
                },
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'leased', lease_owner = ?,
                            lease_expires_at = ?, updated_at = ?
                        WHERE id IN (
                            SELECT id FROM outbox_messages
                            WHERE state = 'pending' AND available_at <= ?
                            ORDER BY available_at, id LIMIT ?
                        )
                        RETURNING id, job_id, payload_json, attempt_count,
                            lease_owner, lease_expires_at`,
                    bindings: [
                        input.owner,
                        leaseExpiresAt,
                        input.now,
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
                        WHERE id = ? AND operation_id = ?
                            AND state IN ('pending', 'failed')`,
                    bindings: [now, message.jobId, message.operationId],
                },
                {
                    sql: `UPDATE outbox_messages
                        SET state = 'sent', sent_at = ?, lease_owner = NULL,
                            lease_expires_at = NULL, updated_at = ?
                        WHERE id = ? AND job_id = ? AND state = 'leased'
                            AND lease_owner = ? AND lease_expires_at >= ?`,
                    bindings: [
                        now,
                        now,
                        message.id,
                        message.jobId,
                        message.leaseOwner,
                        now,
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
                        WHERE id = ? AND job_id = ? AND state = 'leased'
                            AND lease_owner = ? AND lease_expires_at >= ?`,
                    bindings: [
                        MAX_OUTBOX_ATTEMPTS,
                        Math.max(input.now, input.availableAt),
                        klass,
                        message,
                        input.now,
                        input.message.id,
                        input.message.jobId,
                        input.message.leaseOwner,
                        input.now,
                    ],
                },
                {
                    sql: `UPDATE jobs
                        SET state = 'dead_lettered', completed_at = ?,
                            last_error_class = ?, last_error_message = ?,
                            updated_at = ?
                        WHERE id = ? AND state IN ('pending', 'failed')
                          AND EXISTS (
                              SELECT 1 FROM outbox_messages
                              WHERE id = ? AND job_id = jobs.id
                                AND state = 'dead_lettered'
                          )`,
                    bindings: [
                        input.now,
                        klass,
                        message,
                        input.now,
                        input.message.jobId,
                        input.message.id,
                    ],
                },
            ]),
        );
        if (changeCount(operation, results[0]) !== 1) {
            throw new JobInvariantError(operation, 'outbox lease was lost');
        }
        if (changeCount(operation, results[1]) > 1) {
            throw new JobInvariantError(operation, 'updated multiple jobs');
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
                sql: `SELECT f.feed_url, f.etag, f.last_modified
                    FROM jobs j
                    JOIN feeds f ON f.id = json_extract(j.payload_json, '$.feedId')
                    WHERE ${leasePredicate} AND f.id = ? AND f.is_gone = 0`,
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
            etag: row.etag,
            lastModified: row.last_modified,
        };
    },

    async recoverStaleJobLeases(now, limit) {
        const operation = 'recoverStaleJobLeases';
        const result = await run(
            operation,
            d1.run({
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
                        WHERE state = 'running' AND lease_expires_at <= ?
                        ORDER BY lease_expires_at, id LIMIT ?
                    )`,
                bindings: [
                    now,
                    now,
                    now,
                    now,
                    boundedLimit(limit, MAX_DUE_FEEDS),
                ],
            }),
        );
        const recovered = changeCount(operation, result);
        if (recovered > boundedLimit(limit, MAX_DUE_FEEDS)) {
            throw new JobInvariantError(
                operation,
                'recovered beyond job limit',
            );
        }
        return recovered;
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
        const conditionBindings = [
            input.claim.operationId,
            input.claim.leaseOwner,
            input.completedAt,
        ] as const;
        const statements: D1Statement[] = [];
        const mutationKinds: ('exactlyOne' | 'atMostOne')[] = [];
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
                    etag = ?, last_modified = ?, consecutive_failures = 0,
                    is_gone = 0,
                    last_attempt_at = ?, last_successful_refresh_at = ?,
                    latest_entry_at = CASE
                        WHEN ? IS NULL THEN latest_entry_at
                        WHEN latest_entry_at IS NULL THEN ?
                        ELSE MAX(latest_entry_at, ?) END,
                    next_refresh_at = ?, last_error_class = NULL,
                    last_error_message = NULL, updated_at = ?
                WHERE id = ? AND EXISTS (
                    SELECT 1 FROM jobs j WHERE ${leasePredicate}
                )`,
            bindings: [
                input.feedName ?? null,
                input.siteUrl === undefined ? 0 : 1,
                input.siteUrl ?? null,
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
                    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                    WHERE EXISTS (
                        SELECT 1 FROM jobs j WHERE ${leasePredicate}
                    )
                    ON CONFLICT(feed_id, deduplication_key) DO UPDATE SET
                        source_id = excluded.source_id,
                        title = excluded.title, url = excluded.url,
                        author = excluded.author,
                        published_at = excluded.published_at,
                        source_updated_at = excluded.source_updated_at,
                        content_status = excluded.content_status,
                        updated_at = excluded.updated_at`,
                bindings: [
                    entry.id,
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
                ],
            });
            mutationKinds.push('exactlyOne');

            if (entry.content.type === 'stored') {
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
                                SELECT 1 FROM jobs j WHERE ${leasePredicate}
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
            } else {
                statements.push({
                    sql: `DELETE FROM entry_contents
                        WHERE entry_id = (
                            SELECT id FROM entries
                            WHERE feed_id = ? AND deduplication_key = ?
                        ) AND EXISTS (
                            SELECT 1 FROM jobs j WHERE ${leasePredicate}
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
                FROM jobs j WHERE ${leasePredicate}`,
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
        statements.push({
            sql: `UPDATE jobs
                SET state = 'succeeded', lease_owner = NULL,
                    lease_expires_at = NULL, completed_at = ?, updated_at = ?
                WHERE ${directLeasePredicate}`,
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
                        is_gone = CASE WHEN ? = 1 THEN 1 ELSE is_gone END,
                        last_attempt_at = ?, next_refresh_at = ?,
                        last_error_class = ?, last_error_message = ?,
                        updated_at = ?
                    WHERE id = ? AND EXISTS (
                        SELECT 1 FROM jobs j WHERE ${leasePredicate}
                    )`,
                bindings: [
                    input.markGone === true ? 1 : 0,
                    input.failedAt,
                    Math.max(input.failedAt, input.retryAt),
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
        }
        statements.push({
            sql: `UPDATE jobs
                SET state = ?, available_at = ?, lease_owner = NULL,
                    lease_expires_at = NULL, completed_at = ?,
                    last_error_class = ?, last_error_message = ?, updated_at = ?
                WHERE ${directLeasePredicate}`,
            bindings: [
                state,
                terminal
                    ? input.failedAt
                    : Math.max(input.failedAt, input.retryAt),
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
        if (terminal && changeCount(operation, results[1]) !== 1) {
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
                            SELECT id FROM jobs WHERE operation_id = ?
                        ) AND state <> 'dead_lettered'`,
                    bindings: [klass, message, input.now, input.operationId],
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
        const jobChanges = changeCount(operation, results[2]);
        if (outboxChanges > 1 || historyChanges > 1 || jobChanges > 1) {
            throw new JobInvariantError(operation, 'updated multiple job rows');
        }
        return jobChanges === 1;
    },
});

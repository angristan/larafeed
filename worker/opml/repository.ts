import type { OpmlImportResponse } from '@shared/http';
import { Effect } from 'effect';

import type { D1, D1Statement } from '../infrastructure/d1';
import {
    DEFAULT_MAX_ATTEMPTS as DEFAULT_REFRESH_MAX_ATTEMPTS,
    FEED_REFRESH_JOB_KIND,
    FEED_REFRESH_TOPIC,
} from '../jobs/types';
import {
    OpmlInvariantError,
    OpmlLeaseLostError,
    OpmlNotFoundError,
    OpmlStorageError,
} from './errors';
import {
    type ClaimOpmlJobResult,
    type CreateImportInput,
    type LeasedOpmlOutboxMessage,
    MAX_FLATTENED_CATEGORY_LENGTH,
    MAX_IMPORT_ERRORS,
    MAX_OUTBOX_ATTEMPTS,
    MAX_OUTBOX_BATCH,
    MAX_RECENT_IMPORTS,
    MAX_RECOVERY_BATCH,
    OPML_IMPORT_JOB_KIND,
    OPML_IMPORT_TOPIC,
    type OpmlExportSubscription,
    type OpmlFailureRecord,
    type OpmlItemClaim,
} from './types';

interface ImportRow {
    readonly id: number;
    readonly state: OpmlImportResponse['state'];
    readonly source_filename: string | null;
    readonly total_items: number;
    readonly succeeded_items: number;
    readonly failed_items: number;
    readonly skipped_items: number;
    readonly started_at: number | null;
    readonly completed_at: number | null;
    readonly created_at: number;
    readonly updated_at: number;
}

interface ErrorRow {
    readonly position: number;
    readonly title: string | null;
    readonly feed_url: string;
    readonly error_class: string;
}

interface JobRow {
    readonly id: number;
    readonly operation_id: string;
    readonly state: string;
    readonly attempt_count: number;
    readonly max_attempts: number;
    readonly available_at: number;
    readonly lease_expires_at: number | null;
}

interface ClaimRow extends JobRow {
    readonly item_id: number;
    readonly import_id: number;
    readonly user_id: number;
    readonly title: string | null;
    readonly custom_title: string | null;
    readonly feed_url: string;
    readonly normalized_feed_url: string;
    readonly site_url: string | null;
    readonly category_path_json: string;
    readonly lease_owner: string;
}

interface OutboxRow {
    readonly id: number;
    readonly job_id: number;
    readonly payload_json: string;
    readonly attempt_count: number;
    readonly lease_owner: string;
    readonly lease_expires_at: number;
}

const MAX_ERROR_CLASS_LENGTH = 64;
const MAX_ERROR_MESSAGE_LENGTH = 512;
const CREATE_CHUNK_SIZE = 20;

const run = async <A>(operation: string, effect: Effect.Effect<A, unknown>) => {
    try {
        return await Effect.runPromise(effect);
    } catch (cause) {
        if (
            cause instanceof OpmlInvariantError ||
            cause instanceof OpmlLeaseLostError ||
            cause instanceof OpmlNotFoundError
        ) {
            throw cause;
        }
        throw new OpmlStorageError(operation, cause);
    }
};

const changes = (operation: string, result: D1Result<unknown> | undefined) => {
    const count = result?.meta.changes;
    if (typeof count !== 'number' || count < 0) {
        throw new OpmlInvariantError(operation, 'missing D1 change metadata');
    }
    return count;
};

const rows = <T>(result: D1Result<unknown> | undefined): readonly T[] =>
    result !== undefined && Array.isArray(result.results)
        ? (result.results as T[])
        : [];

const boundedLimit = (value: number, maximum: number) =>
    Math.max(1, Math.min(maximum, Math.trunc(value)));
const boundedText = (value: string, maximum: number) =>
    (value.trim() || 'unknown').slice(0, maximum);
const isSafeId = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const decodeOperationId = (operation: string, payload: string): string => {
    let value: unknown;
    try {
        value = JSON.parse(payload);
    } catch {
        throw new OpmlInvariantError(operation, 'invalid outbox JSON');
    }
    if (
        typeof value !== 'object' ||
        value === null ||
        !('operationId' in value) ||
        typeof value.operationId !== 'string' ||
        value.operationId.length === 0 ||
        Object.keys(value).length !== 1
    ) {
        throw new OpmlInvariantError(operation, 'invalid outbox payload');
    }
    return value.operationId;
};

const decodeCategoryPath = (
    operation: string,
    payload: string,
): readonly string[] => {
    let value: unknown;
    try {
        value = JSON.parse(payload);
    } catch {
        throw new OpmlInvariantError(operation, 'invalid category path JSON');
    }
    if (
        !Array.isArray(value) ||
        value.some((part) => typeof part !== 'string')
    ) {
        throw new OpmlInvariantError(operation, 'invalid category path');
    }
    return value;
};

export const flattenCategoryPath = (path: readonly string[]): string => {
    const flattened = path
        .map((part) => part.replace(/\s+/gu, ' ').trim())
        .filter((part) => part !== '')
        .join(' / ');
    return (flattened || 'Uncategorized').slice(
        0,
        MAX_FLATTENED_CATEGORY_LENGTH,
    );
};

const importResponse = (
    operation: string,
    row: ImportRow,
    errors: readonly ErrorRow[],
): OpmlImportResponse => {
    if (
        !isSafeId(row.id) ||
        !isCount(row.total_items) ||
        !isCount(row.succeeded_items) ||
        !isCount(row.failed_items) ||
        !isCount(row.skipped_items) ||
        !isCount(row.created_at) ||
        !isCount(row.updated_at)
    ) {
        throw new OpmlInvariantError(operation, 'invalid import row');
    }
    return {
        id: row.id,
        state: row.state,
        filename: row.source_filename,
        totalItems: row.total_items,
        succeededItems: row.succeeded_items,
        failedItems: row.failed_items,
        skippedItems: row.skipped_items,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        errors: errors.map((error) => ({
            position: error.position,
            title: error.title,
            feedUrl: error.feed_url,
            errorClass: error.error_class,
        })),
    };
};

const importColumns = `id, state, source_filename, total_items,
    succeeded_items, failed_items, skipped_items, started_at, completed_at,
    created_at, updated_at`;

const leasePredicate = `j.operation_id = ? AND j.kind = '${OPML_IMPORT_JOB_KIND}'
    AND j.state = 'running' AND j.lease_owner = ? AND j.lease_expires_at >= ?`;
const directLeasePredicate = `operation_id = ? AND kind = '${OPML_IMPORT_JOB_KIND}'
    AND state = 'running' AND lease_owner = ? AND lease_expires_at >= ?`;

export interface OpmlRepository {
    readonly createImport: (
        input: CreateImportInput,
    ) => Promise<OpmlImportResponse>;
    readonly listImports: (
        userId: number,
        limit?: number,
    ) => Promise<readonly OpmlImportResponse[]>;
    readonly getImport: (
        userId: number,
        importId: number,
    ) => Promise<OpmlImportResponse | null>;
    readonly listExportSubscriptions: (
        userId: number,
    ) => Promise<readonly OpmlExportSubscription[]>;
    readonly leaseOutbox: (input: {
        readonly owner: string;
        readonly now: number;
        readonly leaseMs: number;
        readonly limit: number;
    }) => Promise<readonly LeasedOpmlOutboxMessage[]>;
    readonly markDispatched: (
        message: LeasedOpmlOutboxMessage,
        now: number,
    ) => Promise<void>;
    readonly releaseOutbox: (input: {
        readonly message: LeasedOpmlOutboxMessage;
        readonly now: number;
        readonly availableAt: number;
        readonly errorClass: string;
        readonly errorMessage: string;
    }) => Promise<boolean>;
    readonly claimJob: (input: {
        readonly operationId: string;
        readonly owner: string;
        readonly now: number;
        readonly leaseMs: number;
    }) => Promise<ClaimOpmlJobResult>;
    readonly completeItem: (input: {
        readonly claim: OpmlItemClaim;
        readonly feedId: number;
        readonly categoryId: number;
        readonly refreshJobId: number;
        readonly refreshOutboxId: number;
        readonly feedUrl: string;
        readonly feedName: string;
        readonly categoryName: string;
        readonly siteUrl: string | null;
        readonly faviconUrl: string | null;
        readonly completedAt: number;
    }) => Promise<'succeeded' | 'skipped'>;
    readonly recordFailure: (input: {
        readonly claim: OpmlItemClaim;
        readonly failedAt: number;
        readonly retryable: boolean;
        readonly retryAt: number;
        readonly errorClass: string;
        readonly errorMessage: string;
    }) => Promise<OpmlFailureRecord>;
    readonly recordDeadLetter: (input: {
        readonly operationId: string;
        readonly now: number;
        readonly errorClass: string;
        readonly errorMessage: string;
    }) => Promise<boolean>;
    readonly recoverStaleJobs: (now: number, limit: number) => Promise<number>;
    readonly recoverActiveImports: (
        now: number,
        staleBefore: number,
        limit: number,
    ) => Promise<{ readonly imports: number; readonly jobs: number }>;
}

const loadErrors = async (d1: D1, operation: string, importId: number) => {
    const result = await run(
        operation,
        d1.all<ErrorRow>({
            sql: `SELECT position, title, feed_url,
                COALESCE(error_class, 'unknown') AS error_class
            FROM opml_import_items
            WHERE import_id = ? AND state = 'failed' AND completed_at IS NOT NULL
            ORDER BY position, id LIMIT ?`,
            bindings: [importId, MAX_IMPORT_ERRORS],
        }),
    );
    return result.results;
};

// Repeated placeholders need explicit bindings, so authoritative progress updates
// are generated in one place instead of incrementing counters optimistically.
const recountImport = (importId: number, now: number): D1Statement => ({
    sql: `UPDATE opml_imports
        SET succeeded_items = (SELECT COUNT(*) FROM opml_import_items WHERE import_id = ? AND state = 'succeeded' AND completed_at IS NOT NULL),
            failed_items = (SELECT COUNT(*) FROM opml_import_items WHERE import_id = ? AND state = 'failed' AND completed_at IS NOT NULL),
            skipped_items = (SELECT COUNT(*) FROM opml_import_items WHERE import_id = ? AND state = 'skipped' AND completed_at IS NOT NULL),
            state = CASE WHEN total_items = (SELECT COUNT(*) FROM opml_import_items WHERE import_id = ? AND completed_at IS NOT NULL)
                THEN 'completed' ELSE 'processing' END,
            completed_at = CASE WHEN total_items = (SELECT COUNT(*) FROM opml_import_items WHERE import_id = ? AND completed_at IS NOT NULL)
                THEN ? ELSE NULL END,
            started_at = COALESCE(started_at, ?), updated_at = ?
        WHERE id = ? AND state IN ('pending', 'processing')`,
    bindings: [
        importId,
        importId,
        importId,
        importId,
        importId,
        now,
        now,
        now,
        importId,
    ],
});

export const makeOpmlRepository = (d1: D1): OpmlRepository => ({
    async createImport(input) {
        const operation = 'opml.createImport';
        try {
            const created = await run(
                operation,
                d1.run({
                    sql: `INSERT INTO opml_imports (
                        id, user_id, source_filename, state, total_items,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
                    bindings: [
                        input.id,
                        input.userId,
                        input.filename,
                        input.items.length,
                        input.now,
                        input.now,
                    ],
                }),
            );
            if (changes(operation, created) !== 1) {
                throw new OpmlInvariantError(
                    operation,
                    'import was not created',
                );
            }

            for (
                let offset = 0;
                offset < input.items.length;
                offset += CREATE_CHUNK_SIZE
            ) {
                const chunk = input.items.slice(
                    offset,
                    offset + CREATE_CHUNK_SIZE,
                );
                const statements: D1Statement[] = [];
                for (const item of chunk) {
                    const jobPayload = JSON.stringify({
                        itemId: item.id,
                        importId: input.id,
                        userId: input.userId,
                    });
                    const queuePayload = JSON.stringify({
                        operationId: item.operationId,
                    });
                    statements.push(
                        {
                            sql: `INSERT INTO jobs (id, operation_id, kind, state, payload_json, max_attempts, available_at, created_at, updated_at)
                                VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
                            bindings: [
                                item.jobId,
                                item.operationId,
                                OPML_IMPORT_JOB_KIND,
                                jobPayload,
                                input.maxAttempts,
                                input.now,
                                input.now,
                                input.now,
                            ],
                        },
                        {
                            sql: `INSERT INTO outbox_messages (id, job_id, topic, payload_json, state, available_at, created_at, updated_at)
                                VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
                            bindings: [
                                item.outboxId,
                                item.jobId,
                                OPML_IMPORT_TOPIC,
                                queuePayload,
                                input.now,
                                input.now,
                                input.now,
                            ],
                        },
                        {
                            sql: `INSERT INTO opml_import_items (
                                    id, import_id, user_id, position, operation_id,
                                    job_id, title, custom_title, feed_url,
                                    normalized_feed_url, site_url,
                                    category_path_json, state, max_attempts,
                                    created_at, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
                            bindings: [
                                item.id,
                                input.id,
                                input.userId,
                                item.position,
                                item.operationId,
                                item.jobId,
                                item.title,
                                item.customTitle,
                                item.feedUrl,
                                item.normalizedFeedUrl,
                                item.siteUrl,
                                JSON.stringify(item.categoryPath),
                                input.maxAttempts,
                                input.now,
                                input.now,
                            ],
                        },
                    );
                }
                const results = await run(operation, d1.batch(statements));
                if (
                    results.some((result) => changes(operation, result) !== 1)
                ) {
                    throw new OpmlInvariantError(
                        operation,
                        'item command batch was incomplete',
                    );
                }
            }

            const final = await run(
                operation,
                d1.run({
                    sql: `UPDATE opml_imports
                    SET state = CASE WHEN total_items = 0 THEN 'completed' ELSE 'processing' END,
                        started_at = CASE WHEN total_items = 0 THEN NULL ELSE ? END,
                        completed_at = CASE WHEN total_items = 0 THEN ? ELSE NULL END,
                        updated_at = ?
                    WHERE id = ? AND user_id = ? AND state = 'pending'`,
                    bindings: [
                        input.now,
                        input.now,
                        input.now,
                        input.id,
                        input.userId,
                    ],
                }),
            );
            if (changes(operation, final) !== 1) {
                throw new OpmlInvariantError(
                    operation,
                    'import activation failed',
                );
            }
        } catch (cause) {
            await Effect.runPromise(
                d1.run({
                    sql: `UPDATE opml_imports SET state = 'failed', completed_at = ?,
                        error_class = 'creation_failed', error_message = ?, updated_at = ?
                    WHERE id = ? AND user_id = ? AND state = 'pending'`,
                    bindings: [
                        input.now,
                        boundedText(
                            cause instanceof Error
                                ? cause.message
                                : 'Import creation failed',
                            MAX_ERROR_MESSAGE_LENGTH,
                        ),
                        input.now,
                        input.id,
                        input.userId,
                    ],
                }),
            ).catch(() => undefined);
            throw cause;
        }

        const response = await this.getImport(input.userId, input.id);
        if (response === null)
            throw new OpmlInvariantError(operation, 'created import missing');
        return response;
    },

    async listImports(userId, requestedLimit = MAX_RECENT_IMPORTS) {
        const operation = 'opml.listImports';
        const result = await run(
            operation,
            d1.all<ImportRow>({
                sql: `SELECT ${importColumns} FROM opml_imports
                WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
                bindings: [
                    userId,
                    boundedLimit(requestedLimit, MAX_RECENT_IMPORTS),
                ],
            }),
        );
        return Promise.all(
            result.results.map(async (row) =>
                importResponse(
                    operation,
                    row,
                    await loadErrors(d1, operation, row.id),
                ),
            ),
        );
    },

    async getImport(userId, importId) {
        const operation = 'opml.getImport';
        const row = await run(
            operation,
            d1.first<ImportRow>({
                sql: `SELECT ${importColumns} FROM opml_imports WHERE id = ? AND user_id = ?`,
                bindings: [importId, userId],
            }),
        );
        return row === null
            ? null
            : importResponse(
                  operation,
                  row,
                  await loadErrors(d1, operation, row.id),
              );
    },

    async listExportSubscriptions(userId) {
        const operation = 'opml.listExportSubscriptions';
        const result = await run(
            operation,
            d1.all<{
                category: string;
                canonical_title: string;
                custom_title: string | null;
                feed_url: string;
                site_url: string | null;
            }>({
                sql: `SELECT c.name AS category, f.name AS canonical_title,
                    fs.custom_feed_name AS custom_title, f.feed_url, f.site_url
                FROM feed_subscriptions fs
                JOIN feeds f ON f.id = fs.feed_id
                JOIN subscription_categories c ON c.id = fs.category_id AND c.user_id = fs.user_id
                WHERE fs.user_id = ?
                ORDER BY c.name COLLATE NOCASE, c.id,
                    COALESCE(fs.custom_feed_name, f.name) COLLATE NOCASE, f.id`,
                bindings: [userId],
            }),
        );
        return result.results.map((row) => ({
            category: row.category,
            canonicalTitle: row.canonical_title,
            customTitle: row.custom_title,
            feedUrl: row.feed_url,
            siteUrl: row.site_url,
        }));
    },

    async leaseOutbox(input) {
        const operation = 'opml.leaseOutbox';
        const limit = boundedLimit(input.limit, MAX_OUTBOX_BATCH);
        const leaseExpiresAt = input.now + Math.max(1, input.leaseMs);
        const results = await run(
            operation,
            d1.batch<OutboxRow>([
                {
                    sql: `UPDATE outbox_messages SET state = 'pending', lease_owner = NULL,
                        lease_expires_at = NULL, available_at = MIN(available_at, ?), updated_at = ?
                    WHERE id IN (SELECT o.id FROM outbox_messages o
                        JOIN jobs j ON j.id = o.job_id
                        JOIN opml_import_items i ON i.job_id = j.id
                        JOIN opml_imports p ON p.id = i.import_id
                        WHERE o.topic = ? AND j.kind = ? AND p.state = 'processing'
                            AND o.state = 'leased' AND o.lease_expires_at <= ?
                        ORDER BY o.lease_expires_at, o.id LIMIT ?)`,
                    bindings: [
                        input.now,
                        input.now,
                        OPML_IMPORT_TOPIC,
                        OPML_IMPORT_JOB_KIND,
                        input.now,
                        limit,
                    ],
                },
                {
                    sql: `UPDATE outbox_messages SET state = 'leased', lease_owner = ?, lease_expires_at = ?, updated_at = ?
                    WHERE id IN (SELECT o.id FROM outbox_messages o
                        JOIN jobs j ON j.id = o.job_id
                        JOIN opml_import_items i ON i.job_id = j.id
                        JOIN opml_imports p ON p.id = i.import_id
                        WHERE o.topic = ? AND j.kind = ? AND p.state = 'processing'
                            AND o.state = 'pending' AND o.available_at <= ?
                        ORDER BY o.available_at, o.id LIMIT ?)
                    RETURNING id, job_id, payload_json, attempt_count, lease_owner, lease_expires_at`,
                    bindings: [
                        input.owner,
                        leaseExpiresAt,
                        input.now,
                        OPML_IMPORT_TOPIC,
                        OPML_IMPORT_JOB_KIND,
                        input.now,
                        limit,
                    ],
                },
            ]),
        );
        const leased = rows<OutboxRow>(results[1]);
        if (
            changes(operation, results[1]) !== leased.length ||
            leased.length > limit
        ) {
            throw new OpmlInvariantError(operation, 'invalid lease batch');
        }
        return leased.map((row) => ({
            id: row.id,
            jobId: row.job_id,
            operationId: decodeOperationId(operation, row.payload_json),
            attemptCount: row.attempt_count,
            leaseOwner: row.lease_owner,
            leaseExpiresAt: row.lease_expires_at,
        }));
    },

    async markDispatched(message, now) {
        const operation = 'opml.markDispatched';
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE jobs SET state = 'queued', updated_at = ?
                    WHERE id = ? AND operation_id = ? AND kind = ? AND state IN ('pending', 'failed')`,
                    bindings: [
                        now,
                        message.jobId,
                        message.operationId,
                        OPML_IMPORT_JOB_KIND,
                    ],
                },
                {
                    sql: `UPDATE opml_import_items SET state = 'queued', updated_at = ?
                    WHERE job_id = ? AND operation_id = ? AND state IN ('pending', 'failed') AND completed_at IS NULL`,
                    bindings: [now, message.jobId, message.operationId],
                },
                {
                    sql: `UPDATE outbox_messages SET state = 'sent', sent_at = ?, lease_owner = NULL,
                        lease_expires_at = NULL, updated_at = ?
                    WHERE id = ? AND job_id = ? AND topic = ? AND state = 'leased'
                        AND lease_owner = ? AND lease_expires_at >= ?`,
                    bindings: [
                        now,
                        now,
                        message.id,
                        message.jobId,
                        OPML_IMPORT_TOPIC,
                        message.leaseOwner,
                        now,
                    ],
                },
            ]),
        );
        if (
            changes(operation, results[0]) > 1 ||
            changes(operation, results[1]) > 1 ||
            changes(operation, results[2]) !== 1
        ) {
            throw new OpmlInvariantError(operation, 'dispatch lease lost');
        }
    },

    async releaseOutbox(input) {
        const operation = 'opml.releaseOutbox';
        const klass = boundedText(input.errorClass, MAX_ERROR_CLASS_LENGTH);
        const message = boundedText(
            input.errorMessage,
            MAX_ERROR_MESSAGE_LENGTH,
        );
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE outbox_messages SET
                        state = CASE WHEN attempt_count + 1 >= ? THEN 'dead_lettered' ELSE 'pending' END,
                        attempt_count = attempt_count + 1, available_at = ?, lease_owner = NULL,
                        lease_expires_at = NULL, last_error_class = ?, last_error_message = ?, updated_at = ?
                    WHERE id = ? AND job_id = ? AND topic = ? AND state = 'leased'
                        AND lease_owner = ? AND lease_expires_at >= ?`,
                    bindings: [
                        MAX_OUTBOX_ATTEMPTS,
                        Math.max(input.now, input.availableAt),
                        klass,
                        message,
                        input.now,
                        input.message.id,
                        input.message.jobId,
                        OPML_IMPORT_TOPIC,
                        input.message.leaseOwner,
                        input.now,
                    ],
                },
                {
                    sql: `UPDATE jobs SET state = 'dead_lettered', completed_at = ?,
                        last_error_class = ?, last_error_message = ?, updated_at = ?
                    WHERE id = ? AND kind = ? AND state NOT IN ('succeeded', 'dead_lettered', 'canceled')
                        AND EXISTS (SELECT 1 FROM outbox_messages WHERE id = ? AND state = 'dead_lettered')`,
                    bindings: [
                        input.now,
                        klass,
                        message,
                        input.now,
                        input.message.jobId,
                        OPML_IMPORT_JOB_KIND,
                        input.message.id,
                    ],
                },
                {
                    sql: `UPDATE opml_import_items SET state = 'failed', completed_at = ?,
                        error_class = ?, error_message = ?, updated_at = ?
                    WHERE job_id = ? AND completed_at IS NULL
                        AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND state = 'dead_lettered')`,
                    bindings: [
                        input.now,
                        klass,
                        message,
                        input.now,
                        input.message.jobId,
                        input.message.jobId,
                    ],
                },
                {
                    sql: `UPDATE opml_imports SET
                        succeeded_items = (SELECT COUNT(*) FROM opml_import_items WHERE import_id = opml_imports.id AND state = 'succeeded' AND completed_at IS NOT NULL),
                        failed_items = (SELECT COUNT(*) FROM opml_import_items WHERE import_id = opml_imports.id AND state = 'failed' AND completed_at IS NOT NULL),
                        skipped_items = (SELECT COUNT(*) FROM opml_import_items WHERE import_id = opml_imports.id AND state = 'skipped' AND completed_at IS NOT NULL),
                        state = CASE WHEN total_items = (SELECT COUNT(*) FROM opml_import_items WHERE import_id = opml_imports.id AND completed_at IS NOT NULL) THEN 'completed' ELSE state END,
                        completed_at = CASE WHEN total_items = (SELECT COUNT(*) FROM opml_import_items WHERE import_id = opml_imports.id AND completed_at IS NOT NULL) THEN ? ELSE completed_at END,
                        updated_at = ?
                    WHERE id = (SELECT import_id FROM opml_import_items WHERE job_id = ?)
                        AND state IN ('pending', 'processing')`,
                    bindings: [input.now, input.now, input.message.jobId],
                },
            ]),
        );
        if (changes(operation, results[0]) !== 1)
            throw new OpmlInvariantError(operation, 'outbox lease lost');
        return changes(operation, results[1]) === 1;
    },

    async claimJob(input) {
        const operation = 'opml.claimJob';
        const leaseExpiresAt = input.now + Math.max(1, input.leaseMs);
        const results = await run(
            operation,
            d1.batch<ClaimRow>([
                {
                    sql: `UPDATE jobs SET state = 'running', attempt_count = attempt_count + 1,
                        lease_owner = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?), updated_at = ?
                    WHERE operation_id = ? AND kind = ? AND state IN ('pending', 'queued', 'failed')
                        AND available_at <= ? AND attempt_count < max_attempts
                        AND EXISTS (SELECT 1 FROM opml_import_items i JOIN opml_imports p ON p.id = i.import_id
                            WHERE i.job_id = jobs.id AND i.completed_at IS NULL AND p.state IN ('pending', 'processing'))`,
                    bindings: [
                        input.owner,
                        leaseExpiresAt,
                        input.now,
                        input.now,
                        input.operationId,
                        OPML_IMPORT_JOB_KIND,
                        input.now,
                    ],
                },
                {
                    sql: `UPDATE opml_import_items SET state = 'running',
                        attempt_count = (SELECT attempt_count FROM jobs WHERE id = job_id),
                        started_at = COALESCE(started_at, ?), updated_at = ?
                    WHERE operation_id = ? AND completed_at IS NULL
                        AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_id AND ${leasePredicate})`,
                    bindings: [
                        input.now,
                        input.now,
                        input.operationId,
                        input.operationId,
                        input.owner,
                        input.now,
                    ],
                },
                {
                    sql: `SELECT j.id, j.operation_id, j.state, j.attempt_count, j.max_attempts,
                        j.available_at, j.lease_expires_at, j.lease_owner,
                        i.id AS item_id, i.import_id, i.user_id, i.title,
                        i.custom_title, i.feed_url, i.normalized_feed_url,
                        i.site_url, i.category_path_json
                    FROM jobs j JOIN opml_import_items i ON i.job_id = j.id
                    WHERE j.operation_id = ? AND j.kind = ?`,
                    bindings: [input.operationId, OPML_IMPORT_JOB_KIND],
                },
            ]),
        );
        const claimed = changes(operation, results[0]);
        const itemChanges = changes(operation, results[1]);
        const row = rows<ClaimRow>(results[2])[0];
        if (claimed === 1 && itemChanges === 1 && row !== undefined) {
            return {
                type: 'claimed',
                claim: {
                    itemId: row.item_id,
                    importId: row.import_id,
                    userId: row.user_id,
                    jobId: row.id,
                    operationId: row.operation_id,
                    title: row.title,
                    customTitle: row.custom_title,
                    feedUrl: row.feed_url,
                    normalizedFeedUrl: row.normalized_feed_url,
                    siteUrl: row.site_url,
                    categoryPath: decodeCategoryPath(
                        operation,
                        row.category_path_json,
                    ),
                    attemptCount: row.attempt_count,
                    maxAttempts: row.max_attempts,
                    leaseOwner: row.lease_owner,
                    leaseExpiresAt: row.lease_expires_at ?? leaseExpiresAt,
                },
            };
        }
        if (claimed !== 0 || itemChanges !== 0)
            throw new OpmlInvariantError(operation, 'partial claim');
        if (row === undefined) return { type: 'missing' };
        if (row.state === 'succeeded' || row.state === 'canceled')
            return { type: 'completed', state: row.state };
        if (row.state === 'dead_lettered')
            return { type: 'dead', state: row.state };
        if (row.state === 'running')
            return {
                type: 'busy',
                retryAt: row.lease_expires_at ?? input.now + 1_000,
            };
        return { type: 'unavailable', retryAt: row.available_at };
    },

    async completeItem(input) {
        const operation = 'opml.completeItem';
        const refreshOperationId = `feed-refresh:opml:${input.claim.operationId}`;
        const refreshQueuePayload = JSON.stringify({
            operationId: refreshOperationId,
        });
        const condition = [
            input.claim.operationId,
            input.claim.leaseOwner,
            input.completedAt,
        ] as const;
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `INSERT INTO subscription_categories (id, user_id, name, created_at, updated_at)
                    SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM jobs j WHERE ${leasePredicate})
                    ON CONFLICT(user_id, name COLLATE NOCASE) DO NOTHING`,
                    bindings: [
                        input.categoryId,
                        input.claim.userId,
                        input.categoryName,
                        input.completedAt,
                        input.completedAt,
                        ...condition,
                    ],
                },
                {
                    sql: `INSERT INTO feeds (id, name, feed_url, site_url, favicon_url, next_refresh_at, created_at, updated_at)
                    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM jobs j WHERE ${leasePredicate})
                    ON CONFLICT(feed_url) DO NOTHING`,
                    bindings: [
                        input.feedId,
                        input.feedName,
                        input.feedUrl,
                        input.siteUrl,
                        input.faviconUrl,
                        input.completedAt,
                        input.completedAt,
                        input.completedAt,
                        ...condition,
                    ],
                },
                {
                    sql: `INSERT INTO jobs (
                            id, operation_id, kind, state, payload_json,
                            max_attempts, available_at, created_at, updated_at
                        )
                        SELECT ?, ?, ?, 'pending',
                            json_object('feedId', f.id, 'trigger', 'scheduled'),
                            ?, ?, ?, ?
                        FROM feeds f
                        WHERE f.feed_url = ?
                            AND f.last_successful_refresh_at IS NULL
                            AND EXISTS (SELECT 1 FROM jobs j WHERE ${leasePredicate})
                            AND NOT EXISTS (
                                SELECT 1 FROM jobs active
                                WHERE active.kind = ?
                                    AND active.state IN ('pending', 'queued', 'running', 'failed')
                                    AND json_extract(active.payload_json, '$.feedId') = f.id
                            )
                        ON CONFLICT(operation_id) DO NOTHING`,
                    bindings: [
                        input.refreshJobId,
                        refreshOperationId,
                        FEED_REFRESH_JOB_KIND,
                        DEFAULT_REFRESH_MAX_ATTEMPTS,
                        input.completedAt,
                        input.completedAt,
                        input.completedAt,
                        input.feedUrl,
                        ...condition,
                        FEED_REFRESH_JOB_KIND,
                    ],
                },
                {
                    sql: `INSERT INTO outbox_messages (
                            id, job_id, topic, payload_json, state,
                            available_at, created_at, updated_at
                        )
                        SELECT ?, j.id, ?, ?, 'pending', ?, ?, ?
                        FROM jobs j
                        WHERE j.operation_id = ? AND j.kind = ?
                            AND changes() = 1
                            AND EXISTS (SELECT 1 FROM jobs lease WHERE ${leasePredicate.replaceAll('j.', 'lease.')})
                            AND NOT EXISTS (SELECT 1 FROM outbox_messages o
                                WHERE o.job_id = j.id)
                        ON CONFLICT(job_id) DO NOTHING`,
                    bindings: [
                        input.refreshOutboxId,
                        FEED_REFRESH_TOPIC,
                        refreshQueuePayload,
                        input.completedAt,
                        input.completedAt,
                        input.completedAt,
                        refreshOperationId,
                        FEED_REFRESH_JOB_KIND,
                        ...condition,
                    ],
                },
                {
                    sql: `INSERT INTO feed_subscriptions (user_id, feed_id, category_id, custom_feed_name, created_at, updated_at)
                    SELECT ?, f.id, c.id, ?, ?, ? FROM feeds f, subscription_categories c
                    WHERE f.feed_url = ? AND c.user_id = ? AND c.name = ? COLLATE NOCASE
                        AND EXISTS (SELECT 1 FROM jobs j WHERE ${leasePredicate})
                    ON CONFLICT(user_id, feed_id) DO NOTHING`,
                    bindings: [
                        input.claim.userId,
                        input.claim.customTitle,
                        input.completedAt,
                        input.completedAt,
                        input.feedUrl,
                        input.claim.userId,
                        input.categoryName,
                        ...condition,
                    ],
                },
                {
                    sql: `UPDATE opml_import_items SET
                        state = CASE WHEN changes() = 1 THEN 'succeeded' ELSE 'skipped' END,
                        feed_id = (SELECT id FROM feeds WHERE feed_url = ?),
                        category_id = (SELECT id FROM subscription_categories WHERE user_id = ? AND name = ? COLLATE NOCASE),
                        completed_at = ?, error_class = NULL, error_message = NULL, updated_at = ?
                    WHERE id = ? AND operation_id = ? AND state = 'running' AND completed_at IS NULL
                        AND EXISTS (SELECT 1 FROM jobs j WHERE ${leasePredicate})`,
                    bindings: [
                        input.feedUrl,
                        input.claim.userId,
                        input.categoryName,
                        input.completedAt,
                        input.completedAt,
                        input.claim.itemId,
                        input.claim.operationId,
                        ...condition,
                    ],
                },
                recountImport(input.claim.importId, input.completedAt),
                {
                    sql: `UPDATE jobs SET state = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
                        completed_at = ?, updated_at = ? WHERE ${directLeasePredicate}`,
                    bindings: [
                        input.completedAt,
                        input.completedAt,
                        ...condition,
                    ],
                },
                {
                    sql: `SELECT state FROM opml_import_items WHERE id = ?`,
                    bindings: [input.claim.itemId],
                },
            ]),
        );
        const bootstrappedJobs = changes(operation, results[2]);
        if (
            changes(operation, results[0]) > 1 ||
            changes(operation, results[1]) > 1 ||
            bootstrappedJobs > 1 ||
            changes(operation, results[3]) !== bootstrappedJobs ||
            changes(operation, results[4]) > 1 ||
            changes(operation, results[5]) !== 1 ||
            changes(operation, results[6]) !== 1 ||
            changes(operation, results[7]) !== 1
        ) {
            throw new OpmlLeaseLostError(input.claim.operationId);
        }
        const state = rows<{ state: string }>(results[8])[0]?.state;
        if (state !== 'succeeded' && state !== 'skipped')
            throw new OpmlInvariantError(
                operation,
                'invalid terminal item state',
            );
        return state;
    },

    async recordFailure(input) {
        const operation = 'opml.recordFailure';
        const terminal =
            !input.retryable ||
            input.claim.attemptCount >= input.claim.maxAttempts;
        const state = terminal ? 'dead_lettered' : 'failed';
        const klass = boundedText(input.errorClass, MAX_ERROR_CLASS_LENGTH);
        const message = boundedText(
            input.errorMessage,
            MAX_ERROR_MESSAGE_LENGTH,
        );
        const condition = [
            input.claim.operationId,
            input.claim.leaseOwner,
            input.failedAt,
        ] as const;
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE opml_import_items SET state = 'failed', completed_at = ?,
                        error_class = ?, error_message = ?, updated_at = ?
                    WHERE id = ? AND operation_id = ? AND state = 'running' AND completed_at IS NULL
                        AND EXISTS (SELECT 1 FROM jobs j WHERE ${leasePredicate})`,
                    bindings: [
                        terminal ? input.failedAt : null,
                        klass,
                        message,
                        input.failedAt,
                        input.claim.itemId,
                        input.claim.operationId,
                        ...condition,
                    ],
                },
                recountImport(input.claim.importId, input.failedAt),
                {
                    sql: `UPDATE jobs SET state = ?, available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
                        completed_at = ?, last_error_class = ?, last_error_message = ?, updated_at = ?
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
                        ...condition,
                    ],
                },
            ]),
        );
        if (
            changes(operation, results[0]) !== 1 ||
            changes(operation, results[1]) !== 1 ||
            changes(operation, results[2]) !== 1
        ) {
            throw new OpmlLeaseLostError(input.claim.operationId);
        }
        return {
            terminal,
            availableAt: terminal
                ? null
                : Math.max(input.failedAt, input.retryAt),
        };
    },

    async recordDeadLetter(input) {
        const operation = 'opml.recordDeadLetter';
        const klass = boundedText(input.errorClass, MAX_ERROR_CLASS_LENGTH);
        const message = boundedText(
            input.errorMessage,
            MAX_ERROR_MESSAGE_LENGTH,
        );
        const result = await run(
            operation,
            d1.first<{ import_id: number; item_id: number }>({
                sql: `SELECT i.import_id, i.id AS item_id FROM opml_import_items i JOIN jobs j ON j.id = i.job_id
                WHERE j.operation_id = ? AND j.kind = ?`,
                bindings: [input.operationId, OPML_IMPORT_JOB_KIND],
            }),
        );
        if (result === null) return false;
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE outbox_messages SET state = 'dead_lettered', sent_at = NULL,
                        lease_owner = NULL, lease_expires_at = NULL, last_error_class = ?, last_error_message = ?, updated_at = ?
                    WHERE job_id = (SELECT id FROM jobs WHERE operation_id = ? AND kind = ?) AND state <> 'dead_lettered'`,
                    bindings: [
                        klass,
                        message,
                        input.now,
                        input.operationId,
                        OPML_IMPORT_JOB_KIND,
                    ],
                },
                {
                    sql: `UPDATE opml_import_items SET state = 'failed', completed_at = ?, error_class = ?, error_message = ?, updated_at = ?
                    WHERE id = ? AND completed_at IS NULL`,
                    bindings: [
                        input.now,
                        klass,
                        message,
                        input.now,
                        result.item_id,
                    ],
                },
                recountImport(result.import_id, input.now),
                {
                    sql: `UPDATE jobs SET state = 'dead_lettered', lease_owner = NULL, lease_expires_at = NULL,
                        completed_at = ?, last_error_class = ?, last_error_message = ?, updated_at = ?
                    WHERE operation_id = ? AND kind = ? AND state NOT IN ('succeeded', 'dead_lettered', 'canceled')`,
                    bindings: [
                        input.now,
                        klass,
                        message,
                        input.now,
                        input.operationId,
                        OPML_IMPORT_JOB_KIND,
                    ],
                },
            ]),
        );
        return changes(operation, results[3]) === 1;
    },

    async recoverStaleJobs(now, requestedLimit) {
        const operation = 'opml.recoverStaleJobs';
        const limit = boundedLimit(requestedLimit, MAX_RECOVERY_BATCH);
        const stale = await run(
            operation,
            d1.all<{
                operation_id: string;
                import_id: number;
                item_id: number;
            }>({
                sql: `SELECT j.operation_id, i.import_id, i.id AS item_id
                FROM jobs j JOIN opml_import_items i ON i.job_id = j.id
                WHERE j.kind = ? AND j.state = 'running' AND j.lease_expires_at <= ?
                ORDER BY j.lease_expires_at, j.id LIMIT ?`,
                bindings: [OPML_IMPORT_JOB_KIND, now, limit],
            }),
        );
        let recovered = 0;
        for (const item of stale.results) {
            const results = await run(
                operation,
                d1.batch([
                    {
                        sql: `UPDATE jobs SET state = CASE WHEN attempt_count >= max_attempts THEN 'dead_lettered' ELSE 'failed' END,
                            available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
                            completed_at = CASE WHEN attempt_count >= max_attempts THEN ? ELSE NULL END,
                            last_error_class = 'stale_lease', last_error_message = 'Worker lease expired', updated_at = ?
                        WHERE operation_id = ? AND kind = ? AND state = 'running' AND lease_expires_at <= ?`,
                        bindings: [
                            now,
                            now,
                            now,
                            item.operation_id,
                            OPML_IMPORT_JOB_KIND,
                            now,
                        ],
                    },
                    {
                        sql: `UPDATE opml_import_items SET state = 'failed',
                            completed_at = CASE WHEN (SELECT state FROM jobs WHERE operation_id = ?) = 'dead_lettered' THEN ? ELSE NULL END,
                            error_class = 'stale_lease', error_message = 'Worker lease expired', updated_at = ?
                        WHERE id = ? AND state = 'running'`,
                        bindings: [item.operation_id, now, now, item.item_id],
                    },
                    recountImport(item.import_id, now),
                ]),
            );
            if (changes(operation, results[0]) === 1) recovered += 1;
        }
        return recovered;
    },

    async recoverActiveImports(now, staleBefore, requestedLimit) {
        const operation = 'opml.recoverActiveImports';
        const limit = boundedLimit(requestedLimit, MAX_RECOVERY_BATCH);
        const results = await run(
            operation,
            d1.batch([
                {
                    sql: `UPDATE opml_imports SET state = 'failed', completed_at = ?,
                        error_class = 'incomplete_creation', error_message = 'Import creation did not complete', updated_at = ?
                    WHERE id IN (SELECT id FROM opml_imports WHERE state = 'pending' AND updated_at <= ? ORDER BY updated_at, id LIMIT ?)`,
                    bindings: [now, now, staleBefore, limit],
                },
                {
                    sql: `UPDATE outbox_messages SET state = 'pending', sent_at = NULL,
                        lease_owner = NULL, lease_expires_at = NULL, available_at = ?, updated_at = ?
                    WHERE id IN (SELECT o.id FROM outbox_messages o
                        JOIN jobs j ON j.id = o.job_id JOIN opml_import_items i ON i.job_id = j.id
                        JOIN opml_imports p ON p.id = i.import_id
                        WHERE o.topic = ? AND j.kind = ? AND p.state = 'processing'
                            AND i.completed_at IS NULL AND j.state IN ('pending', 'queued', 'failed')
                            AND j.updated_at <= ? AND o.state IN ('sent', 'dead_lettered')
                        ORDER BY j.updated_at, j.id LIMIT ?)`,
                    bindings: [
                        now,
                        now,
                        OPML_IMPORT_TOPIC,
                        OPML_IMPORT_JOB_KIND,
                        staleBefore,
                        limit,
                    ],
                },
                {
                    sql: `UPDATE jobs SET state = 'pending', available_at = ?, completed_at = NULL, updated_at = ?
                    WHERE kind = ? AND state IN ('queued', 'failed')
                        AND EXISTS (SELECT 1 FROM outbox_messages o WHERE o.job_id = jobs.id AND o.topic = ? AND o.state = 'pending' AND o.updated_at = ?)`,
                    bindings: [
                        now,
                        now,
                        OPML_IMPORT_JOB_KIND,
                        OPML_IMPORT_TOPIC,
                        now,
                    ],
                },
                {
                    sql: `UPDATE opml_import_items SET state = 'pending', completed_at = NULL, updated_at = ?
                    WHERE completed_at IS NULL AND job_id IN (SELECT id FROM jobs WHERE kind = ? AND state = 'pending' AND updated_at = ?)`,
                    bindings: [now, OPML_IMPORT_JOB_KIND, now],
                },
            ]),
        );
        return {
            imports: changes(operation, results[0]),
            jobs: changes(operation, results[2]),
        };
    },
});

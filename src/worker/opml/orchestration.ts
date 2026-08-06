import type { OpmlImportResponse } from '@shared/http';
import { Effect } from 'effect';

import { generateRandomToken, generateSafeId } from '../auth/crypto';
import { isFeedRefreshError } from '../feeds/errors';
import { validateFeedUrl } from '../feeds/policy';
import {
    type FeedUpdatedResult,
    makeFeedRefreshService,
} from '../feeds/service';
import {
    DEFAULT_REFRESH_INTERVAL_MS,
    UNCHANGED_REFRESH_INTERVALS_MS,
} from '../jobs';
import {
    recordHandledFailure,
    safeErrorClass,
    spanNames,
} from '../observability';
import { prepareRefreshEntry } from '../refresh/entries';
import { OpmlValidationError } from './errors';
import { parseOpml } from './parser';
import { flattenCategoryPath, type OpmlRepository } from './repository';
import {
    DEFAULT_ITEM_MAX_ATTEMPTS,
    DEFAULT_JOB_LEASE_MS,
    DEFAULT_OUTBOX_LEASE_MS,
    type DispatchResult,
    MAX_BACKOFF_MS,
    MAX_OUTBOX_BATCH,
    MAX_QUEUE_SEND_BATCH,
    MAX_RECOVERY_BATCH,
    type OpmlCronResult,
    type OpmlQueueDecision,
    type OpmlQueueMessage,
    type OpmlQueueSender,
} from './types';

const ACTIVE_RECOVERY_AGE_MS = 10 * 60_000;

const defaultGenerateId = () => Effect.runPromise(generateSafeId());
const defaultGenerateToken = () => Effect.runPromise(generateRandomToken());
const defaultDiscoverFeed = (url: string) =>
    Effect.runPromise(makeFeedRefreshService().discover(url));
const limit = (value: number | undefined, maximum: number) =>
    Math.max(1, Math.min(maximum, Math.trunc(value ?? maximum)));

export const opmlRetryBackoffMs = (attempt: number): number => {
    const exponent = Math.max(0, Math.min(20, Math.trunc(attempt) - 1));
    return Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** exponent);
};

export const decodeOpmlQueueMessage = (
    body: unknown,
): OpmlQueueMessage | null => {
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

const retryDecision = (
    reason: string,
    now: number,
    retryAt: number,
): OpmlQueueDecision => ({
    action: 'retry',
    reason,
    retryDelaySeconds: Math.max(1, Math.ceil((retryAt - now) / 1_000)),
});

const safeSiteUrl = (value: string | null): string | null => {
    if (value === null) return null;
    try {
        const url = new URL(value);
        if (
            (url.protocol !== 'http:' && url.protocol !== 'https:') ||
            url.username !== '' ||
            url.password !== '' ||
            (url.protocol === 'http:' &&
                url.port !== '' &&
                url.port !== '80') ||
            (url.protocol === 'https:' && url.port !== '' && url.port !== '443')
        ) {
            return null;
        }
        url.hash = '';
        return url.href.slice(0, 16_384);
    } catch {
        return null;
    }
};

const shouldTrySiteUrl = (cause: unknown): boolean => {
    if (!isFeedRefreshError(cause)) return false;
    switch (cause._tag) {
        case 'FeedNetworkError':
        case 'FeedTimeoutError':
            return true;
        case 'FeedHttpError':
            return (
                cause.status === 404 ||
                cause.status === 410 ||
                cause.status >= 500
            );
        default:
            return false;
    }
};

const classifyFailure = (cause: unknown) => {
    if (isFeedRefreshError(cause)) {
        return {
            retryable: cause.retryable,
            errorClass: cause._tag,
            errorMessage:
                'reason' in cause
                    ? cause.reason
                    : 'status' in cause
                      ? `HTTP ${cause.status}`
                      : 'Feed verification failed',
        };
    }
    if (cause instanceof OpmlValidationError) {
        return {
            retryable: false,
            errorClass: cause._tag,
            errorMessage: cause.reason,
        };
    }
    return {
        retryable: true,
        errorClass:
            cause instanceof Error && cause.name
                ? cause.name
                : 'opml_processing_error',
        errorMessage:
            cause instanceof Error
                ? cause.message
                : 'OPML item processing failed',
    };
};

const xmlEscape = (value: string): string =>
    value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');

export interface OpmlOrchestratorDependencies {
    readonly repository: OpmlRepository;
    readonly queue: OpmlQueueSender;
    readonly now?: () => number;
    readonly generateId?: () => Promise<number>;
    readonly generateToken?: () => Promise<string>;
    readonly discoverFeed?: (url: string) => Promise<FeedUpdatedResult>;
    readonly maxAttempts?: number;
    readonly jobLeaseMs?: number;
    readonly outboxLeaseMs?: number;
}

export interface OpmlOrchestrator {
    readonly createImport: (
        userId: number,
        source: string,
        filename?: string,
    ) => Promise<OpmlImportResponse>;
    readonly listImports: (
        userId: number,
    ) => Promise<readonly OpmlImportResponse[]>;
    readonly getImport: (
        userId: number,
        importId: number,
    ) => Promise<OpmlImportResponse | null>;
    readonly exportOpml: (userId: number) => Promise<string>;
    readonly dispatchOutbox: (
        limit?: number,
        importId?: number,
    ) => Promise<DispatchResult>;
    readonly processQueueMessage: (
        body: unknown,
        owner?: string,
    ) => Promise<OpmlQueueDecision>;
    readonly runCron: (input?: {
        readonly dispatch?: boolean;
        readonly dispatchLimit?: number;
        readonly recoveryLimit?: number;
    }) => Promise<OpmlCronResult>;
}

export const makeOpmlOrchestrator = (
    dependencies: OpmlOrchestratorDependencies,
): OpmlOrchestrator => {
    const {
        repository,
        queue,
        now = Date.now,
        generateId = defaultGenerateId,
        generateToken = defaultGenerateToken,
        discoverFeed = defaultDiscoverFeed,
        maxAttempts = DEFAULT_ITEM_MAX_ATTEMPTS,
        jobLeaseMs = DEFAULT_JOB_LEASE_MS,
        outboxLeaseMs = DEFAULT_OUTBOX_LEASE_MS,
    } = dependencies;

    const createImport = async (
        userId: number,
        source: string,
        filename?: string,
    ): Promise<OpmlImportResponse> => {
        const parsed = parseOpml(source);
        const importId = await generateId();
        const items = [];
        for (const item of parsed) {
            const [id, jobId, outboxId] = await Promise.all([
                generateId(),
                generateId(),
                generateId(),
            ]);
            items.push({
                ...item,
                id,
                jobId,
                outboxId,
                operationId: `opml-import:${importId}:${item.position}:${id}`,
            });
        }
        return repository.createImport({
            id: importId,
            userId,
            filename: filename?.trim() || null,
            items,
            maxAttempts: Math.max(1, Math.trunc(maxAttempts)),
            now: now(),
        });
    };

    const dispatchOutbox = async (
        requestedLimit = MAX_OUTBOX_BATCH,
        importId?: number,
    ): Promise<DispatchResult> => {
        const currentTime = now();
        const owner = `opml-outbox:${await generateToken()}`;
        const leased = await repository.leaseOutbox({
            owner,
            now: currentTime,
            leaseMs: outboxLeaseMs,
            limit: limit(requestedLimit, MAX_OUTBOX_BATCH),
            importId,
        });
        let sent = 0;
        let released = 0;
        let ambiguous = 0;
        for (
            let offset = 0;
            offset < leased.length;
            offset += MAX_QUEUE_SEND_BATCH
        ) {
            const batch = leased.slice(offset, offset + MAX_QUEUE_SEND_BATCH);
            try {
                // Operation IDs are the complete wire contract. D1 remains
                // authoritative for user, URL, and category data.
                await queue.sendBatch(
                    batch.map((message) => ({
                        operationId: message.operationId,
                    })),
                );
            } catch (cause) {
                recordHandledFailure(
                    spanNames.dispatchFailure,
                    {
                        'app.subsystem': 'opml',
                        'app.failure.stage': 'queue_send',
                        'app.queue.batch_size': batch.length,
                    },
                    {
                        errorClass: safeErrorClass(cause),
                        stage: 'queue_send',
                        retryable: true,
                    },
                );
                try {
                    await repository.releaseOutboxBatch({
                        messages: batch,
                        now: currentTime,
                        availableAt:
                            currentTime +
                            opmlRetryBackoffMs(
                                Math.max(
                                    ...batch.map(
                                        (message) => message.attemptCount + 1,
                                    ),
                                ),
                            ),
                        errorClass:
                            cause instanceof Error
                                ? cause.name
                                : 'queue_send_error',
                        errorMessage:
                            cause instanceof Error
                                ? cause.message
                                : 'Queue batch send failed',
                    });
                    released += batch.length;
                } catch (releaseCause) {
                    recordHandledFailure(
                        spanNames.dispatchFailure,
                        {
                            'app.subsystem': 'opml',
                            'app.failure.stage': 'outbox_release',
                            'app.queue.batch_size': batch.length,
                        },
                        {
                            errorClass: safeErrorClass(releaseCause),
                            stage: 'outbox_release',
                            retryable: true,
                        },
                    );
                    // A failed send followed by a failed D1 transition is
                    // ambiguous. Lease recovery safely retries stable IDs.
                    ambiguous += batch.length;
                }
                continue;
            }
            try {
                await repository.markDispatchedBatch(batch, currentTime);
                sent += batch.length;
            } catch (markCause) {
                recordHandledFailure(
                    spanNames.dispatchFailure,
                    {
                        'app.subsystem': 'opml',
                        'app.failure.stage': 'outbox_mark_dispatched',
                        'app.queue.batch_size': batch.length,
                    },
                    {
                        errorClass: safeErrorClass(markCause),
                        stage: 'outbox_mark_dispatched',
                        retryable: true,
                    },
                );
                // Keep an ambiguous send leased. Lease expiry produces safe
                // duplicates with the same idempotent operation IDs.
                ambiguous += batch.length;
            }
        }
        return { leased: leased.length, sent, released, ambiguous };
    };

    const processQueueMessage = async (
        body: unknown,
        requestedOwner?: string,
    ): Promise<OpmlQueueDecision> => {
        const message = decodeOpmlQueueMessage(body);
        if (message === null)
            return { action: 'dead', reason: 'invalid_message' };
        const currentTime = now();
        try {
            const owner =
                requestedOwner ?? `opml-item:${await generateToken()}`;
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

            const claim = result.claim;
            try {
                const validated = validateFeedUrl(claim.normalizedFeedUrl);
                if (validated.href !== claim.normalizedFeedUrl) {
                    throw new OpmlValidationError('noncanonical_feed_url');
                }

                const startedAt = now();
                let discovered: FeedUpdatedResult;
                try {
                    discovered = await discoverFeed(validated.href);
                } catch (cause) {
                    if (!shouldTrySiteUrl(cause) || claim.siteUrl === null) {
                        throw cause;
                    }
                    let siteUrl: URL;
                    try {
                        siteUrl = validateFeedUrl(claim.siteUrl);
                    } catch {
                        throw cause;
                    }
                    if (siteUrl.href === validated.href) throw cause;
                    discovered = await discoverFeed(siteUrl.href);
                }

                const canonicalFeedUrl = validateFeedUrl(
                    discovered.finalUrl,
                ).href;
                const entries = await Effect.runPromise(
                    Effect.forEach(discovered.entries, (entry) =>
                        prepareRefreshEntry(entry, []),
                    ),
                );
                const completedAt = now();
                const baseInterval =
                    entries.length === 0
                        ? UNCHANGED_REFRESH_INTERVALS_MS[0]
                        : DEFAULT_REFRESH_INTERVAL_MS;
                const refreshInterval =
                    discovered.entryWindowTruncated === true
                        ? DEFAULT_REFRESH_INTERVAL_MS
                        : Math.max(
                              baseInterval,
                              discovered.publisherRefreshIntervalMs ?? 0,
                          );
                const [categoryId, historyId] = await Promise.all([
                    generateId(),
                    generateId(),
                ]);
                const completion = await repository.completeItem({
                    claim,
                    categoryId,
                    historyId,
                    feedUrl: canonicalFeedUrl,
                    feedName:
                        discovered.feed.title ||
                        claim.title?.trim() ||
                        validated.hostname,
                    categoryName: flattenCategoryPath(claim.categoryPath),
                    siteUrl: safeSiteUrl(
                        discovered.feed.siteUrl ?? claim.siteUrl,
                    ),
                    faviconUrl: safeSiteUrl(discovered.feed.faviconUrl),
                    etag: discovered.etag,
                    lastModified: discovered.lastModified,
                    publisherRefreshIntervalMs:
                        discovered.publisherRefreshIntervalMs ?? null,
                    entryWindowTruncated:
                        discovered.entryWindowTruncated ?? false,
                    httpStatus: discovered.httpStatus,
                    durationMs: Math.max(0, completedAt - startedAt),
                    entries,
                    completedAt,
                    nextRefreshAt: completedAt + refreshInterval,
                });
                return { action: 'ack', reason: completion.state };
            } catch (cause) {
                const failure = classifyFailure(cause);
                recordHandledFailure(
                    spanNames.jobFailure,
                    {
                        'app.subsystem': 'opml',
                        'app.opml.import_id': result.claim.importId,
                        'app.opml.item_id': result.claim.itemId,
                        'app.job.attempt': result.claim.attemptCount,
                        'app.job.max_attempts': result.claim.maxAttempts,
                    },
                    {
                        errorClass: failure.errorClass,
                        stage: 'discovery',
                        retryable: failure.retryable,
                    },
                );
                const failedAt = now();
                const retryAt =
                    failedAt + opmlRetryBackoffMs(result.claim.attemptCount);
                const recorded = await repository.recordFailure({
                    claim: result.claim,
                    failedAt,
                    retryable: failure.retryable,
                    retryAt,
                    errorClass: failure.errorClass,
                    errorMessage: failure.errorMessage,
                });
                return recorded.terminal
                    ? { action: 'dead', reason: 'terminal_failure' }
                    : retryDecision(
                          'retryable_failure',
                          failedAt,
                          recorded.availableAt ?? retryAt,
                      );
            }
        } catch (cause) {
            recordHandledFailure(
                spanNames.jobFailure,
                {
                    'app.subsystem': 'opml',
                    'app.failure.stage': 'orchestration',
                },
                {
                    errorClass: safeErrorClass(cause),
                    stage: 'orchestration',
                    retryable: true,
                },
            );
            return retryDecision(
                'orchestration_error',
                currentTime,
                currentTime + 30_000,
            );
        }
    };

    const exportOpml = async (userId: number): Promise<string> => {
        const subscriptions = await repository.listExportSubscriptions(userId);
        const grouped = new Map<string, typeof subscriptions>();
        for (const subscription of subscriptions) {
            grouped.set(subscription.category, [
                ...(grouped.get(subscription.category) ?? []),
                subscription,
            ]);
        }
        const outlines = [...grouped.entries()]
            .map(
                ([category, feeds]) =>
                    `    <outline text="${xmlEscape(category)}" title="${xmlEscape(category)}">\n${feeds
                        .map((feed) => {
                            const displayTitle =
                                feed.customTitle ?? feed.canonicalTitle;
                            return `      <outline type="rss" text="${xmlEscape(displayTitle)}" title="${xmlEscape(displayTitle)}"${
                                feed.customTitle === null
                                    ? ''
                                    : ` customTitle="${xmlEscape(feed.customTitle)}"`
                            } xmlUrl="${xmlEscape(feed.feedUrl)}"${
                                feed.siteUrl === null
                                    ? ''
                                    : ` htmlUrl="${xmlEscape(feed.siteUrl)}"`
                            } />`;
                        })
                        .join('\n')}\n    </outline>`,
            )
            .join('\n');
        return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Larafeed subscriptions</title></head>\n  <body>\n${outlines}\n  </body>\n</opml>\n`;
    };

    const runCron = async (
        input: {
            readonly dispatch?: boolean;
            readonly dispatchLimit?: number;
            readonly recoveryLimit?: number;
        } = {},
    ): Promise<OpmlCronResult> => {
        const currentTime = now();
        const recoveryLimit = limit(input.recoveryLimit, MAX_RECOVERY_BATCH);
        const recoveredJobs = await repository.recoverStaleJobs(
            currentTime,
            recoveryLimit,
        );
        const recovery = await repository.recoverActiveImports(
            currentTime,
            Math.max(0, currentTime - ACTIVE_RECOVERY_AGE_MS),
            recoveryLimit,
        );
        const dispatched =
            input.dispatch === false
                ? { leased: 0, sent: 0, released: 0, ambiguous: 0 }
                : await dispatchOutbox(input.dispatchLimit);
        return {
            recoveredJobs,
            recoveredImports: recovery.imports,
            redispatchedJobs: recovery.jobs,
            dispatched,
        };
    };

    return {
        createImport,
        listImports: (userId) => repository.listImports(userId),
        getImport: (userId, importId) => repository.getImport(userId, importId),
        exportOpml,
        dispatchOutbox,
        processQueueMessage,
        runCron,
    };
};

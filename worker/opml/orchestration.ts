import type { OpmlImportResponse } from '@shared/http';
import { Effect } from 'effect';

import { generateRandomToken, generateSafeId } from '../auth/crypto';
import { isFeedRefreshError } from '../feeds/errors';
import { validateFeedUrl } from '../feeds/policy';
import {
    type FeedUpdatedResult,
    makeFeedRefreshService,
} from '../feeds/service';
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
    readonly dispatchOutbox: (limit?: number) => Promise<DispatchResult>;
    readonly processQueueMessage: (
        body: unknown,
        owner?: string,
    ) => Promise<OpmlQueueDecision>;
    readonly recordDeadLetter: (
        body: unknown,
        errorClass?: string,
        errorMessage?: string,
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
    ): Promise<DispatchResult> => {
        const currentTime = now();
        const owner = `opml-outbox:${await generateToken()}`;
        const leased = await repository.leaseOutbox({
            owner,
            now: currentTime,
            leaseMs: outboxLeaseMs,
            limit: limit(requestedLimit, MAX_OUTBOX_BATCH),
        });
        let sent = 0;
        let released = 0;
        let ambiguous = 0;
        for (const message of leased) {
            try {
                // The operation ID is the complete wire contract. D1 remains
                // authoritative for user, URL, and category data.
                await queue.send({ operationId: message.operationId });
            } catch (cause) {
                await repository.releaseOutbox({
                    message,
                    now: currentTime,
                    availableAt:
                        currentTime +
                        opmlRetryBackoffMs(message.attemptCount + 1),
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
                // Keep an ambiguous send leased. Lease expiry produces a safe
                // duplicate with the same idempotent operation ID.
                ambiguous += 1;
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
                const discovered = await discoverFeed(validated.href);
                const canonicalFeedUrl = validateFeedUrl(
                    discovered.finalUrl,
                ).href;
                const completedAt = now();
                const [feedId, categoryId] = await Promise.all([
                    generateId(),
                    generateId(),
                ]);
                const outcome = await repository.completeItem({
                    claim,
                    feedId,
                    categoryId,
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
                    completedAt,
                });
                return { action: 'ack', reason: outcome };
            } catch (cause) {
                const failure = classifyFailure(cause);
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
        errorClass = 'queue_dead_letter',
        errorMessage = 'Queue delivery attempts exhausted',
    ): Promise<OpmlQueueDecision> => {
        const message = decodeOpmlQueueMessage(body);
        if (message === null)
            return { action: 'dead', reason: 'invalid_message' };
        try {
            const changed = await repository.recordDeadLetter({
                operationId: message.operationId,
                now: now(),
                errorClass,
                errorMessage,
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
                        .map(
                            (feed) =>
                                `      <outline type="rss" text="${xmlEscape(feed.title)}" title="${xmlEscape(feed.title)}" xmlUrl="${xmlEscape(feed.feedUrl)}"${
                                    feed.siteUrl === null
                                        ? ''
                                        : ` htmlUrl="${xmlEscape(feed.siteUrl)}"`
                                } />`,
                        )
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
        recordDeadLetter,
        runCron,
    };
};

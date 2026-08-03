import { Effect } from 'effect';

import { sha256Bytes } from '../auth/crypto';
import {
    FeedHttpError,
    isFeedRefreshError,
    makeFeedRefreshService,
    type NormalizedFeedEntry,
    validateFeedUrl,
} from '../feeds';
import { makeD1 } from '../infrastructure/d1';
import {
    makeJobOrchestrator,
    makeJobRepository,
    type ProcessedRefreshEntry,
    type RefreshFailure,
    type RefreshProcessor,
} from '../jobs';
import {
    compileFilterRules,
    matchesSubscriptionFilter,
} from '../subscriptions/filter';

export interface RefreshRuntimeConfig {
    readonly schedulerEnabled: boolean;
    readonly dispatchEnabled: boolean;
    readonly dueLimit: number;
}

export interface RefreshRuntime {
    readonly config: RefreshRuntimeConfig;
    readonly orchestrator: ReturnType<typeof makeJobOrchestrator>;
}

export interface RefreshRuntimeOptions {
    readonly fetch?: typeof globalThis.fetch;
    readonly now?: () => number;
}

const parseBoolean = (name: string, value: string): boolean => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${name} must be true or false`);
};

const parseDueLimit = (value: string): number => {
    if (!/^[1-9]\d*$/u.test(value)) {
        throw new Error('REFRESH_DUE_LIMIT must be a positive integer');
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > 100) {
        throw new Error('REFRESH_DUE_LIMIT must be at most 100');
    }
    return parsed;
};

export const parseRefreshRuntimeConfig = (env: Env): RefreshRuntimeConfig => ({
    schedulerEnabled: parseBoolean(
        'REFRESH_SCHEDULER_ENABLED',
        env.REFRESH_SCHEDULER_ENABLED,
    ),
    dispatchEnabled: parseBoolean(
        'REFRESH_DISPATCH_ENABLED',
        env.REFRESH_DISPATCH_ENABLED,
    ),
    dueLimit: parseDueLimit(env.REFRESH_DUE_LIMIT),
});

interface CompiledFeedSubscriptionFilter {
    readonly userId: number;
    readonly rules: ReturnType<typeof compileFilterRules>;
}

const normalizedEntry = async (
    entry: NormalizedFeedEntry,
    subscriptionFilters: readonly CompiledFeedSubscriptionFilter[],
): Promise<ProcessedRefreshEntry> => {
    const candidate = {
        title: entry.title,
        author: entry.author,
        contentHtml: entry.contentHtml,
    };
    const filteredUserIds = subscriptionFilters
        .filter(({ rules }) => matchesSubscriptionFilter(candidate, rules))
        .map(({ userId }) => userId);
    return {
        deduplicationKey: entry.deduplicationKey,
        sourceId: entry.sourceId,
        title: entry.title,
        url: entry.url,
        author: entry.author,
        publishedAt: entry.publishedAt,
        sourceUpdatedAt: entry.sourceUpdatedAt,
        content:
            entry.contentStatus === 'stored' && entry.contentHtml !== null
                ? {
                      type: 'stored',
                      html: entry.contentHtml,
                      hash: await Effect.runPromise(
                          sha256Bytes(entry.contentHtml),
                      ),
                  }
                : entry.contentStatus === 'oversized'
                  ? { type: 'oversized' }
                  : { type: 'empty' },
        filteredUserIds,
    };
};

export const resolveFeedFaviconUrl = (
    metadataUrl: string | null,
    siteUrl: string | null,
): string | null => {
    if (metadataUrl !== null) {
        try {
            return validateFeedUrl(metadataUrl).href;
        } catch {
            // Invalid feed-controlled icon metadata falls back to the site origin.
        }
    }
    if (siteUrl === null) return null;
    try {
        const site = validateFeedUrl(siteUrl);
        return new URL('/favicon.ico', site.origin).href;
    } catch {
        return null;
    }
};

const classifiedFailure = (
    cause: unknown,
    durationMs: number,
): RefreshFailure => {
    if (!isFeedRefreshError(cause)) {
        return {
            type: 'failure',
            retryable: true,
            errorClass: 'refresh_unknown',
            errorMessage: 'Feed refresh failed',
            durationMs,
        };
    }

    const status = cause instanceof FeedHttpError ? cause.status : undefined;
    return {
        type: 'failure',
        retryable: cause.retryable,
        ...(status === 404 || status === 410 ? { markGone: true } : {}),
        ...(cause instanceof FeedHttpError && cause.retryAfterMs !== undefined
            ? { retryAfterMs: cause.retryAfterMs }
            : {}),
        errorClass: cause._tag,
        errorMessage:
            status === undefined
                ? `Feed refresh failed: ${cause._tag}`
                : `Feed returned HTTP ${status}`,
        ...(status === undefined ? {} : { httpStatus: status }),
        durationMs,
    };
};

export const makeRefreshProcessor = (
    options: RefreshRuntimeOptions,
): RefreshProcessor => {
    const now = options.now ?? Date.now;
    const feedService = makeFeedRefreshService({
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        now,
    });

    return async (input) => {
        const startedAt = now();
        try {
            const result = await Effect.runPromise(
                feedService.refresh({
                    url: input.feedUrl,
                    etag: input.etag,
                    lastModified: input.lastModified,
                }),
            );
            const durationMs = Math.max(0, now() - startedAt);
            if (result.kind === 'not-modified') {
                return {
                    type: 'not_modified',
                    etag: result.etag,
                    lastModified: result.lastModified,
                    httpStatus: 304,
                    durationMs,
                };
            }

            const siteUrl = result.feed.siteUrl ?? input.siteUrl;
            const subscriptionFilters = input.subscriptionFilters.map(
                ({ userId, rules }) => ({
                    userId,
                    rules: compileFilterRules(rules),
                }),
            );
            return {
                type: 'success',
                etag: result.etag,
                lastModified: result.lastModified,
                httpStatus: result.httpStatus,
                durationMs,
                feedName: result.feed.title,
                siteUrl,
                faviconUrl: resolveFeedFaviconUrl(
                    result.feed.faviconUrl,
                    siteUrl,
                ),
                entries: await Promise.all(
                    result.entries.map((entry) =>
                        normalizedEntry(entry, subscriptionFilters),
                    ),
                ),
            };
        } catch (cause) {
            return classifiedFailure(cause, Math.max(0, now() - startedAt));
        }
    };
};

export const makeRefreshRuntime = (
    env: Env,
    options: RefreshRuntimeOptions = {},
): RefreshRuntime => {
    const config = parseRefreshRuntimeConfig(env);
    const repository = makeJobRepository(makeD1(env.DB));
    const orchestrator = makeJobOrchestrator({
        repository,
        queue: {
            send: async (message) => {
                await env.FEED_REFRESH_QUEUE.send(message, {
                    contentType: 'json',
                });
            },
        },
        processor: makeRefreshProcessor(options),
        ...(options.now === undefined ? {} : { now: options.now }),
    });

    return { config, orchestrator };
};

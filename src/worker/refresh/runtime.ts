import { Effect } from 'effect';

import { faviconRefreshEnabled } from '../favicons/cron';
import { makeFaviconRuntime } from '../favicons/runtime';
import {
    FeedHttpError,
    type FeedRefreshError,
    isFeedRefreshError,
    makeFeedRefreshService,
    validateFeedUrl,
} from '../feeds';
import { makeD1 } from '../infrastructure/d1';
import {
    makeJobOrchestrator,
    makeJobRepository,
    type RefreshFailure,
    type RefreshProcessor,
} from '../jobs';
import {
    compileFilterRules,
    matchesSubscriptionFilter,
} from '../subscriptions/filter';
import { prepareRefreshEntry } from './entries';

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

const parseErrorMessages = {
    empty_document: 'Feed URL returned an empty document',
    forbidden_declaration:
        'Feed uses XML DOCTYPE or ENTITY declarations, which are not allowed',
    html_page:
        'Feed URL returned a web page instead of a feed. The site may block automated readers, or the feed may have moved.',
    malformed_json: 'Feed is not valid JSON',
    malformed_xml: 'Feed is not valid XML',
    too_many_entries: 'Feed has too many entries',
    unsupported_feed: 'Document is not an RSS, Atom, RDF or JSON feed',
} as const;

/** A message the subscriber can act on, stored with the failed refresh. */
const refreshErrorMessage = (cause: FeedRefreshError): string => {
    switch (cause._tag) {
        case 'FeedHttpError':
            return `Feed returned HTTP ${cause.status}`;
        case 'FeedParseError':
            return parseErrorMessages[cause.reason];
        case 'FeedSizeError':
            return `Feed is larger than ${Math.floor(cause.limitBytes / 1_048_576)} MB`;
        case 'FeedTimeoutError':
            return `Feed did not respond within ${Math.round(cause.timeoutMs / 1_000)} seconds`;
        case 'FeedNetworkError':
            return 'Could not connect to the feed server';
        case 'FeedPolicyError':
            return `Feed URL is not allowed (${cause.reason.replaceAll('_', ' ')})`;
    }
};

const isHtmlPage = (cause: unknown): boolean =>
    isFeedRefreshError(cause) &&
    cause._tag === 'FeedParseError' &&
    cause.reason === 'html_page';

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
    const missing = status === 404 || status === 410;
    return {
        type: 'failure',
        retryable: missing || cause.retryable,
        ...(missing ? { markGone: true } : {}),
        ...(cause instanceof FeedHttpError && cause.retryAfterMs !== undefined
            ? { retryAfterMs: cause.retryAfterMs }
            : {}),
        errorClass: cause._tag,
        errorMessage: refreshErrorMessage(cause),
        ...(status === undefined ? {} : { httpStatus: status }),
        durationMs,
    };
};

const sameFeedUrl = (left: string, right: string): boolean => {
    try {
        return validateFeedUrl(left).href === validateFeedUrl(right).href;
    } catch {
        return left === right;
    }
};

export const makeRefreshProcessor = (
    options: RefreshRuntimeOptions,
): RefreshProcessor => {
    const now = options.now ?? Date.now;
    const feedService = makeFeedRefreshService({
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        now,
    });

    /**
     * A feed URL that answers 404 or 410, or a web page, has often moved. Look for the feeds
     * its site advertises, or serves at common paths, and return the first
     * one that is a different feed.
     */
    const findMovedFeed = async (input: {
        readonly feedUrl: string;
        readonly siteUrl: string | null;
    }): Promise<string | null> => {
        let siteUrl: string;
        try {
            siteUrl = input.siteUrl ?? new URL(input.feedUrl).origin;
        } catch {
            return null;
        }
        const discovery = await Effect.runPromise(
            feedService
                .discoverCandidates(siteUrl)
                .pipe(Effect.orElseSucceed(() => null)),
        );
        const candidate = discovery?.candidates.find(
            ({ result }) => !sameFeedUrl(result.finalUrl, input.feedUrl),
        );
        return candidate?.result.finalUrl ?? null;
    };

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
                    publisherRefreshIntervalMs:
                        result.publisherRefreshIntervalMs,
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
                publisherRefreshIntervalMs: result.publisherRefreshIntervalMs,
                httpStatus: result.httpStatus,
                durationMs,
                feedName: result.feed.title,
                siteUrl,
                faviconUrl: resolveFeedFaviconUrl(
                    result.feed.faviconUrl,
                    siteUrl,
                ),
                entries: await Effect.runPromise(
                    Effect.forEach(result.entries, (entry) => {
                        const candidate = {
                            title: entry.title,
                            author: entry.author,
                            contentHtml: entry.contentHtml,
                        };
                        const filteredUserIds = subscriptionFilters
                            .filter(({ rules }) =>
                                matchesSubscriptionFilter(candidate, rules),
                            )
                            .map(({ userId }) => userId);
                        return prepareRefreshEntry(entry, filteredUserIds);
                    }),
                ),
            };
        } catch (cause) {
            const failure = classifiedFailure(
                cause,
                Math.max(0, now() - startedAt),
            );
            return failure.markGone === true || isHtmlPage(cause)
                ? { ...failure, movedToUrl: await findMovedFeed(input) }
                : failure;
        }
    };
};

export const makeRefreshRuntime = (
    env: Env,
    options: RefreshRuntimeOptions = {},
): RefreshRuntime => {
    const config = parseRefreshRuntimeConfig(env);
    const d1 = makeD1(env.DB);
    const repository = makeJobRepository(d1);
    const favicon = faviconRefreshEnabled(env)
        ? makeFaviconRuntime(env, options).orchestrator
        : null;
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
        ...(favicon === null
            ? {}
            : {
                  scheduleFavicon: (feedId: number) =>
                      favicon.scheduleFeed(feedId),
              }),
        ...(options.now === undefined ? {} : { now: options.now }),
    });

    return { config, orchestrator };
};

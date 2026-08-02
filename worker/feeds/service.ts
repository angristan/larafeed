import { Effect } from 'effect';

import {
    FeedHttpError,
    FeedNetworkError,
    FeedParseError,
    FeedPolicyError,
    type FeedRefreshError,
    FeedSizeError,
    FeedTimeoutError,
    isFeedRefreshError,
} from './errors';
import {
    type NormalizedFeedEntry,
    type NormalizedFeedMetadata,
    parseFeedDocument,
} from './parser';
import { validateFeedUrl } from './policy';

export const FEED_FETCH_TIMEOUT_MS = 15_000;
export const MAX_FEED_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MAX_FEED_REDIRECTS = 5;
export const MAX_FEED_DISCOVERY_CANDIDATES = 4;
export const FEED_USER_AGENT =
    'Larafeed/1.0 (+https://larafeed.stanislas.cloud)';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);
const BINARY_MIME_PREFIXES = ['audio/', 'font/', 'image/', 'video/'];
const BINARY_MIME_TYPES = new Set([
    'application/gzip',
    'application/octet-stream',
    'application/pdf',
    'application/rar',
    'application/vnd.rar',
    'application/x-7z-compressed',
    'application/x-bzip',
    'application/x-bzip2',
    'application/x-rar-compressed',
    'application/zip',
]);

export interface AuthoritativeFeedSource {
    readonly url: string;
    readonly etag: string | null;
    readonly lastModified: string | null;
}

interface FeedResponseMetadata {
    readonly finalUrl: string;
    readonly etag: string | null;
    readonly lastModified: string | null;
    readonly httpStatus: number;
}

export interface FeedNotModifiedResult extends FeedResponseMetadata {
    readonly kind: 'not-modified';
}

export interface FeedUpdatedResult extends FeedResponseMetadata {
    readonly kind: 'updated';
    readonly feed: NormalizedFeedMetadata;
    readonly entries: readonly NormalizedFeedEntry[];
}

export type FeedRefreshResult = FeedNotModifiedResult | FeedUpdatedResult;

export interface FeedRefreshServiceDependencies {
    readonly fetch?: (
        input: RequestInfo | URL,
        init?: RequestInit,
    ) => Promise<Response>;
    readonly now?: () => number;
    readonly webCrypto?: Crypto;
}

const safeConditionalHeader = (value: string | null): string | undefined =>
    value !== null &&
    value.length <= 1_024 &&
    !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint === 0 || codePoint === 10 || codePoint === 13;
    })
        ? value
        : undefined;

const requestHeaders = (feed: AuthoritativeFeedSource): Headers => {
    const headers = new Headers({
        accept: 'application/feed+json, application/json;q=0.9, application/atom+xml, application/rss+xml, application/rdf+xml, application/xml, text/xml, */*;q=0.1',
        'user-agent': FEED_USER_AGENT,
    });
    const etag = safeConditionalHeader(feed.etag);
    const lastModified = safeConditionalHeader(feed.lastModified);
    if (etag !== undefined) {
        headers.set('if-none-match', etag);
    }
    if (lastModified !== undefined) {
        headers.set('if-modified-since', lastModified);
    }
    return headers;
};

const responseMetadata = (
    response: Response,
    finalUrl: URL,
    previous: AuthoritativeFeedSource,
): FeedResponseMetadata => {
    const etag = safeConditionalHeader(response.headers.get('etag'));
    const lastModified = safeConditionalHeader(
        response.headers.get('last-modified'),
    );
    return {
        finalUrl: finalUrl.href,
        etag: etag ?? (response.status === 304 ? previous.etag : null),
        lastModified:
            lastModified ??
            (response.status === 304 ? previous.lastModified : null),
        httpStatus: response.status,
    };
};

const isObviousBinary = (contentType: string | null): boolean => {
    if (contentType === null) {
        return false;
    }
    const mime = contentType.split(';', 1)[0].trim().toLowerCase();
    return (
        BINARY_MIME_TYPES.has(mime) ||
        BINARY_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
    );
};

const readBoundedBody = async (response: Response): Promise<Uint8Array> => {
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && /^\d+$/u.test(contentLength.trim())) {
        const length = Number(contentLength);
        if (length > MAX_FEED_RESPONSE_BYTES) {
            await response.body?.cancel();
            throw new FeedSizeError({ limitBytes: MAX_FEED_RESPONSE_BYTES });
        }
    }

    if (response.body === null) {
        return new Uint8Array();
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            total += value.byteLength;
            if (total > MAX_FEED_RESPONSE_BYTES) {
                await reader.cancel();
                throw new FeedSizeError({
                    limitBytes: MAX_FEED_RESPONSE_BYTES,
                });
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
};

const htmlLinkAttributes = (tag: string): ReadonlyMap<string, string> => {
    const attributes = new Map<string, string>();
    const pattern =
        /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;
    for (const match of tag.matchAll(pattern)) {
        const name = match[1]?.toLocaleLowerCase();
        const value = match[2] ?? match[3] ?? match[4];
        if (name !== undefined && value !== undefined) {
            attributes.set(name, value);
        }
    }
    return attributes;
};

export const discoverFeedLinks = (
    body: Uint8Array,
    pageUrl: URL,
): readonly URL[] => {
    const html = new TextDecoder().decode(body);
    const tags = html.match(/<link\b[^>]{0,4096}>/giu) ?? [];
    const candidates: URL[] = [];
    const seen = new Set<string>();
    for (const tag of tags.slice(0, 50)) {
        const attributes = htmlLinkAttributes(tag);
        const rel = (attributes.get('rel') ?? '')
            .toLocaleLowerCase()
            .split(/\s+/u);
        const type = (attributes.get('type') ?? '').toLocaleLowerCase();
        const href = attributes.get('href');
        if (
            !rel.includes('alternate') ||
            href === undefined ||
            ![
                'application/atom+xml',
                'application/feed+json',
                'application/json',
                'application/rss+xml',
                'application/rdf+xml',
                'application/xml',
                'text/xml',
            ].includes(type)
        ) {
            continue;
        }
        try {
            const candidate = validateFeedUrl(new URL(href, pageUrl));
            if (!seen.has(candidate.href)) {
                seen.add(candidate.href);
                candidates.push(candidate);
            }
        } catch {
            // Publisher-controlled invalid candidates are ignored.
        }
        if (candidates.length === MAX_FEED_DISCOVERY_CANDIDATES) break;
    }
    return candidates;
};

const fetchDiscoveryPage = async (
    rawUrl: string,
    dependencies: Required<FeedRefreshServiceDependencies>,
    callerSignal: AbortSignal,
): Promise<{ readonly finalUrl: URL; readonly links: readonly URL[] }> => {
    let currentUrl = validateFeedUrl(rawUrl);
    let redirects = 0;
    let timedOut = false;
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(callerSignal.reason);
    callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(
            new DOMException('Feed discovery timed out', 'TimeoutError'),
        );
    }, FEED_FETCH_TIMEOUT_MS);

    try {
        while (true) {
            let response: Response;
            try {
                response = await dependencies.fetch(currentUrl, {
                    method: 'GET',
                    headers: {
                        accept: 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1',
                        'user-agent': FEED_USER_AGENT,
                    },
                    redirect: 'manual',
                    signal: controller.signal,
                });
            } catch {
                if (timedOut) {
                    throw new FeedTimeoutError({
                        timeoutMs: FEED_FETCH_TIMEOUT_MS,
                    });
                }
                throw new FeedNetworkError();
            }

            if (REDIRECT_STATUSES.has(response.status)) {
                if (redirects === MAX_FEED_REDIRECTS) {
                    await response.body?.cancel();
                    throw new FeedPolicyError({
                        reason: 'too_many_redirects',
                    });
                }
                const location = response.headers.get('location');
                await response.body?.cancel();
                if (location === null) {
                    throw new FeedPolicyError({
                        reason: 'redirect_location_missing',
                    });
                }
                try {
                    currentUrl = validateFeedUrl(new URL(location, currentUrl));
                } catch {
                    throw new FeedPolicyError({ reason: 'invalid_url' });
                }
                redirects += 1;
                continue;
            }
            if (response.status < 200 || response.status >= 300) {
                await response.body?.cancel();
                throw new FeedHttpError({
                    status: response.status,
                    retryable: retryableHttpStatus(response.status),
                });
            }
            const contentType = response.headers
                .get('content-type')
                ?.split(';', 1)[0]
                .trim()
                .toLocaleLowerCase();
            if (
                contentType !== undefined &&
                contentType !== 'text/html' &&
                contentType !== 'application/xhtml+xml'
            ) {
                await response.body?.cancel();
                throw new FeedParseError({ reason: 'unsupported_feed' });
            }
            const body = await readBoundedBody(response);
            return {
                finalUrl: currentUrl,
                links: discoverFeedLinks(body, currentUrl),
            };
        }
    } finally {
        clearTimeout(timeout);
        callerSignal.removeEventListener('abort', abortFromCaller);
    }
};

const retryableHttpStatus = (status: number): boolean =>
    RETRYABLE_HTTP_STATUSES.has(status) || status >= 500;

const retryAfterMs = (
    value: string | null,
    now: number,
): number | undefined => {
    if (value === null || value.length > 128) return undefined;
    const seconds = /^\d+$/u.test(value.trim()) ? Number(value.trim()) : NaN;
    const delay = Number.isFinite(seconds)
        ? seconds * 1_000
        : Date.parse(value) - now;
    return Number.isFinite(delay) && delay > 0
        ? Math.min(24 * 60 * 60_000, Math.trunc(delay))
        : undefined;
};

const fetchFeed = async (
    feed: AuthoritativeFeedSource,
    dependencies: Required<FeedRefreshServiceDependencies>,
    callerSignal: AbortSignal,
): Promise<FeedRefreshResult> => {
    let currentUrl = validateFeedUrl(feed.url);
    let redirects = 0;
    let timedOut = false;
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(callerSignal.reason);
    callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(
            new DOMException('Feed fetch timed out', 'TimeoutError'),
        );
    }, FEED_FETCH_TIMEOUT_MS);

    try {
        while (true) {
            let response: Response;
            try {
                response = await dependencies.fetch(currentUrl, {
                    method: 'GET',
                    headers: requestHeaders(feed),
                    redirect: 'manual',
                    signal: controller.signal,
                });
            } catch (cause) {
                if (timedOut) {
                    throw new FeedTimeoutError({
                        timeoutMs: FEED_FETCH_TIMEOUT_MS,
                    });
                }
                if (isFeedRefreshError(cause)) {
                    throw cause;
                }
                throw new FeedNetworkError();
            }

            if (REDIRECT_STATUSES.has(response.status)) {
                if (redirects === MAX_FEED_REDIRECTS) {
                    await response.body?.cancel();
                    throw new FeedPolicyError({
                        reason: 'too_many_redirects',
                    });
                }
                const location = response.headers.get('location');
                await response.body?.cancel();
                if (location === null) {
                    throw new FeedPolicyError({
                        reason: 'redirect_location_missing',
                    });
                }
                let redirectUrl: URL;
                try {
                    redirectUrl = new URL(location, currentUrl);
                } catch {
                    throw new FeedPolicyError({ reason: 'invalid_url' });
                }
                currentUrl = validateFeedUrl(redirectUrl);
                redirects += 1;
                continue;
            }

            if (response.status === 304) {
                await response.body?.cancel();
                return {
                    kind: 'not-modified',
                    ...responseMetadata(response, currentUrl, feed),
                };
            }

            if (response.status < 200 || response.status >= 300) {
                await response.body?.cancel();
                const retryAfter = retryAfterMs(
                    response.headers.get('retry-after'),
                    dependencies.now(),
                );
                throw new FeedHttpError({
                    status: response.status,
                    retryable: retryableHttpStatus(response.status),
                    ...(retryAfter === undefined
                        ? {}
                        : { retryAfterMs: retryAfter }),
                });
            }
            if (isObviousBinary(response.headers.get('content-type'))) {
                await response.body?.cancel();
                throw new FeedPolicyError({ reason: 'binary_content_type' });
            }

            let body: Uint8Array;
            try {
                body = await readBoundedBody(response);
            } catch (cause) {
                if (timedOut) {
                    throw new FeedTimeoutError({
                        timeoutMs: FEED_FETCH_TIMEOUT_MS,
                    });
                }
                if (isFeedRefreshError(cause)) {
                    throw cause;
                }
                throw new FeedNetworkError();
            }

            const parsed = await parseFeedDocument(body, {
                finalUrl: currentUrl,
                fetchedAt: dependencies.now(),
                contentType: response.headers.get('content-type'),
                webCrypto: dependencies.webCrypto,
            });
            return {
                kind: 'updated',
                ...responseMetadata(response, currentUrl, feed),
                feed: parsed.metadata,
                entries: parsed.entries,
            };
        }
    } finally {
        clearTimeout(timeout);
        callerSignal.removeEventListener('abort', abortFromCaller);
    }
};

export const makeFeedRefreshService = (
    provided: FeedRefreshServiceDependencies = {},
) => {
    const dependencies: Required<FeedRefreshServiceDependencies> = {
        fetch: provided.fetch ?? globalThis.fetch.bind(globalThis),
        now: provided.now ?? Date.now,
        webCrypto: provided.webCrypto ?? globalThis.crypto,
    };

    const refresh = (
        feed: AuthoritativeFeedSource,
    ): Effect.Effect<FeedRefreshResult, FeedRefreshError> =>
        Effect.tryPromise({
            try: (signal) => fetchFeed(feed, dependencies, signal),
            catch: (cause) =>
                isFeedRefreshError(cause) ? cause : new FeedNetworkError(),
        });

    const discover = (
        url: string,
    ): Effect.Effect<FeedUpdatedResult, FeedRefreshError> =>
        refresh({ url, etag: null, lastModified: null }).pipe(
            Effect.flatMap((result) =>
                result.kind === 'updated'
                    ? Effect.succeed(result)
                    : Effect.fail(
                          new FeedParseError({ reason: 'unsupported_feed' }),
                      ),
            ),
            Effect.catchTag('FeedParseError', () =>
                Effect.tryPromise({
                    try: async (signal) => {
                        const page = await fetchDiscoveryPage(
                            url,
                            dependencies,
                            signal,
                        );
                        let lastError: FeedRefreshError = new FeedParseError({
                            reason: 'unsupported_feed',
                        });
                        const candidates =
                            page.links.length > 0
                                ? page.links
                                : [
                                      '/feed',
                                      '/rss',
                                      '/atom.xml',
                                      '/feed.json',
                                  ].map((path) =>
                                      validateFeedUrl(
                                          new URL(path, page.finalUrl.origin),
                                      ),
                                  );
                        for (const candidate of candidates) {
                            try {
                                const result = await Effect.runPromise(
                                    refresh({
                                        url: candidate.href,
                                        etag: null,
                                        lastModified: null,
                                    }),
                                    { signal },
                                );
                                if (result.kind === 'updated') return result;
                            } catch (cause) {
                                if (isFeedRefreshError(cause)) {
                                    lastError = cause;
                                }
                            }
                        }
                        throw lastError;
                    },
                    catch: (cause) =>
                        isFeedRefreshError(cause)
                            ? cause
                            : new FeedNetworkError(),
                }),
            ),
        );

    return { refresh, discover };
};

export type FeedRefreshService = ReturnType<typeof makeFeedRefreshService>;

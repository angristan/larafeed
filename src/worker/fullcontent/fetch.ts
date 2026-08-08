import { Effect } from 'effect';

import { MAX_FEED_RESPONSE_BYTES } from '../feeds/limits';
import { validateFeedUrl } from '../feeds/policy';
import { FEED_USER_AGENT } from '../feeds/service';
import { FullContentFetchError } from './errors';

export const ARTICLE_FETCH_TIMEOUT_MS = 15_000;
export const MAX_ARTICLE_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export interface FetchedArticlePage {
    readonly html: string;
    readonly finalUrl: URL;
}

export interface ArticlePageFetcherDependencies {
    readonly fetch?: (
        input: RequestInfo | URL,
        init?: RequestInit,
    ) => Promise<Response>;
}

const charsetFromContentType = (value: string | null): string | undefined => {
    if (value === null) return undefined;
    const match = /charset\s*=\s*"?([A-Za-z0-9_.:-]{1,40})"?/iu.exec(value);
    return match?.[1];
};

const charsetFromMeta = (bytes: Uint8Array): string | undefined => {
    // Lossy ASCII-compatible sniff over the document head is sufficient for
    // locating a <meta charset> declaration.
    const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 2_048));
    const charset =
        /<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9_.:-]{1,40})/iu.exec(head);
    return charset?.[1];
};

export const decodeHtmlBytes = (
    bytes: Uint8Array,
    contentType: string | null,
): string => {
    const label =
        charsetFromContentType(contentType) ??
        charsetFromMeta(bytes) ??
        'utf-8';
    try {
        return new TextDecoder(label).decode(bytes);
    } catch {
        return new TextDecoder('utf-8').decode(bytes);
    }
};

const readBoundedBody = async (response: Response): Promise<Uint8Array> => {
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && /^\d+$/u.test(contentLength.trim())) {
        if (Number(contentLength) > MAX_FEED_RESPONSE_BYTES) {
            await response.body?.cancel();
            throw new FullContentFetchError({ kind: 'too_large' });
        }
    }
    if (response.body === null) return new Uint8Array();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_FEED_RESPONSE_BYTES) {
                await reader.cancel();
                throw new FullContentFetchError({ kind: 'too_large' });
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

const isFullContentFetchError = (
    value: unknown,
): value is FullContentFetchError =>
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, '_tag') === 'FullContentFetchError';

const fetchPage = async (
    rawUrl: string,
    dependencies: Required<ArticlePageFetcherDependencies>,
    callerSignal: AbortSignal,
): Promise<FetchedArticlePage> => {
    let currentUrl: URL;
    try {
        currentUrl = validateFeedUrl(rawUrl);
    } catch {
        throw new FullContentFetchError({ kind: 'policy' });
    }

    let redirects = 0;
    let timedOut = false;
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(callerSignal.reason);
    callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(
            new DOMException('Article fetch timed out', 'TimeoutError'),
        );
    }, ARTICLE_FETCH_TIMEOUT_MS);

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
                throw new FullContentFetchError({
                    kind: timedOut ? 'timeout' : 'network',
                });
            }

            if (REDIRECT_STATUSES.has(response.status)) {
                if (redirects === MAX_ARTICLE_REDIRECTS) {
                    await response.body?.cancel();
                    throw new FullContentFetchError({ kind: 'policy' });
                }
                const location = response.headers.get('location');
                await response.body?.cancel();
                if (location === null) {
                    throw new FullContentFetchError({ kind: 'policy' });
                }
                try {
                    currentUrl = validateFeedUrl(new URL(location, currentUrl));
                } catch {
                    throw new FullContentFetchError({ kind: 'policy' });
                }
                redirects += 1;
                continue;
            }

            if (response.status < 200 || response.status >= 300) {
                await response.body?.cancel();
                throw new FullContentFetchError({
                    kind: 'http',
                    status: response.status,
                });
            }

            const contentType = response.headers
                .get('content-type')
                ?.split(';', 1)[0]
                .trim()
                .toLowerCase();
            if (
                contentType !== undefined &&
                !HTML_CONTENT_TYPES.has(contentType)
            ) {
                await response.body?.cancel();
                throw new FullContentFetchError({
                    kind: 'unsupported_content',
                });
            }

            let body: Uint8Array;
            try {
                body = await readBoundedBody(response);
            } catch (cause) {
                if (isFullContentFetchError(cause)) throw cause;
                throw new FullContentFetchError({
                    kind: timedOut ? 'timeout' : 'network',
                });
            }

            return {
                html: decodeHtmlBytes(
                    body,
                    response.headers.get('content-type'),
                ),
                finalUrl: currentUrl,
            };
        }
    } finally {
        clearTimeout(timeout);
        callerSignal.removeEventListener('abort', abortFromCaller);
    }
};

export type ArticlePageFetcher = (
    url: string,
) => Effect.Effect<FetchedArticlePage, FullContentFetchError>;

export const makeArticlePageFetcher = (
    provided: ArticlePageFetcherDependencies = {},
): ArticlePageFetcher => {
    const dependencies: Required<ArticlePageFetcherDependencies> = {
        fetch: provided.fetch ?? globalThis.fetch.bind(globalThis),
    };

    return (url) =>
        Effect.tryPromise({
            try: (signal) => fetchPage(url, dependencies, signal),
            catch: (cause) =>
                isFullContentFetchError(cause)
                    ? cause
                    : new FullContentFetchError({ kind: 'network' }),
        });
};

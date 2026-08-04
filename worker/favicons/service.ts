import { Effect, Schema } from 'effect';

import { validateFeedUrl } from '../feeds/policy';
import { FeedImageUnavailable, fetchImageBytes } from '../images/service';
import type { FaviconAssetStore } from './assets';
import type { FaviconDarknessAnalyzer } from './darkness';
import type { FaviconRepository, FaviconTarget } from './repository';

const MAX_HTML_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_HTML_CANDIDATES = 4;
const FETCH_TIMEOUT_MS = 5_000;
export const FAVICON_STALE_AFTER_MS = 30 * 24 * 60 * 60_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export class FaviconDiscoveryError extends Schema.TaggedErrorClass<FaviconDiscoveryError>()(
    'FaviconDiscoveryError',
    {},
) {}

class FaviconPageUnavailable extends Error {
    constructor(readonly retryable: boolean) {
        super('Favicon page is unavailable');
        this.name = 'FaviconPageUnavailable';
    }
}

export interface FaviconServiceDependencies {
    readonly repository: FaviconRepository;
    readonly fetch?: typeof globalThis.fetch;
    readonly assetStore?: FaviconAssetStore;
    readonly analyzeDarkness?: FaviconDarknessAnalyzer;
    readonly now?: () => number;
}

const attributes = (tag: string): ReadonlyMap<string, string> => {
    const values = new Map<string, string>();
    const pattern =
        /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;
    for (const match of tag.matchAll(pattern)) {
        const key = match[1]?.toLocaleLowerCase();
        const value = match[2] ?? match[3] ?? match[4];
        if (key !== undefined && value !== undefined) values.set(key, value);
    }
    return values;
};
const sizeScore = (value: string): number => {
    if (value.trim().toLocaleLowerCase() === 'any') return 5;
    let best = 0;
    for (const token of value.split(/\s+/u)) {
        const match = /^(\d{1,4})x(\d{1,4})$/u.exec(token.toLocaleLowerCase());
        const width = Number(match?.[1]);
        const height = Number(match?.[2]);
        if (width > 0 && width === height)
            best = Math.max(best, Math.max(0, 64 - Math.abs(width - 32)));
    }
    return best;
};
export const discoverFaviconLinks = (
    html: Uint8Array,
    pageUrl: URL,
): readonly URL[] => {
    const source = new TextDecoder().decode(html);
    const ranked: { readonly url: URL; readonly score: number }[] = [];
    const seen = new Set<string>();
    for (const tag of (source.match(/<link\b[^>]{0,4096}>/giu) ?? []).slice(
        0,
        50,
    )) {
        const values = attributes(tag);
        const rel = (values.get('rel') ?? '').toLocaleLowerCase().split(/\s+/u);
        const href = values.get('href');
        const icon = rel.includes('icon');
        const apple =
            rel.includes('apple-touch-icon') ||
            rel.includes('apple-touch-icon-precomposed');
        if (href === undefined || (!icon && !apple)) continue;
        try {
            const url = validateFeedUrl(new URL(href, pageUrl));
            if (seen.has(url.href)) continue;
            seen.add(url.href);
            const type = (values.get('type') ?? '').toLocaleLowerCase();
            if (type.includes('svg')) continue;
            const score =
                (icon ? 300 : 200) +
                (type.includes('png') ? 30 : type.includes('icon') ? 25 : 0) +
                sizeScore(values.get('sizes') ?? '');
            ranked.push({ url, score });
        } catch {
            // Invalid publisher-controlled candidates are ignored.
        }
    }
    return ranked
        .toSorted((left, right) => right.score - left.score)
        .slice(0, MAX_HTML_CANDIDATES)
        .map(({ url }) => url);
};

const boundedBody = async (response: Response): Promise<Uint8Array> => {
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
        if (
            !/^\d+$/u.test(contentLength) ||
            Number(contentLength) > MAX_HTML_BYTES
        )
            throw new FaviconDiscoveryError();
    }
    if (response.body === null) throw new FaviconDiscoveryError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_HTML_BYTES) {
                await reader.cancel();
                throw new FaviconDiscoveryError();
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
const fetchPage = async (
    rawUrl: URL,
    fetchImplementation: typeof globalThis.fetch,
): Promise<{ readonly url: URL; readonly body: Uint8Array }> => {
    let url = validateFeedUrl(rawUrl);
    let redirects = 0;
    const controller = new AbortController();
    const timeout = setTimeout(
        () =>
            controller.abort(
                new DOMException('Favicon discovery timed out', 'TimeoutError'),
            ),
        FETCH_TIMEOUT_MS,
    );
    try {
        while (true) {
            const response = await fetchImplementation(url, {
                method: 'GET',
                redirect: 'manual',
                signal: controller.signal,
                headers: {
                    accept: 'text/html,application/xhtml+xml;q=0.9',
                    'user-agent':
                        'Larafeed/1.0 (+https://larafeed.stanislas.cloud)',
                },
            });
            if (REDIRECTS.has(response.status)) {
                const location = response.headers.get('location');
                await response.body?.cancel();
                if (location === null || redirects === MAX_REDIRECTS)
                    throw new FaviconDiscoveryError();
                try {
                    url = validateFeedUrl(new URL(location, url));
                } catch {
                    throw new FaviconDiscoveryError();
                }
                redirects += 1;
                continue;
            }
            const mime = response.headers
                .get('content-type')
                ?.split(';', 1)[0]
                ?.trim()
                .toLocaleLowerCase();
            if (!response.ok) {
                const retryable =
                    response.status === 408 ||
                    response.status === 425 ||
                    response.status === 429 ||
                    response.status >= 500;
                await response.body?.cancel();
                throw new FaviconPageUnavailable(retryable);
            }
            if (mime !== 'text/html' && mime !== 'application/xhtml+xml') {
                await response.body?.cancel();
                throw new FaviconDiscoveryError();
            }
            return { url, body: await boundedBody(response) };
        }
    } catch (cause) {
        if (
            cause instanceof FaviconDiscoveryError ||
            cause instanceof FaviconPageUnavailable
        )
            throw cause;
        throw new FaviconPageUnavailable(true);
    } finally {
        clearTimeout(timeout);
    }
};
const targetPage = (target: FaviconTarget): URL => {
    if (target.siteUrl !== null) {
        try {
            return validateFeedUrl(target.siteUrl);
        } catch {
            // Imported invalid site metadata falls back to the feed origin.
        }
    }
    try {
        const feed = validateFeedUrl(target.feedUrl);
        return new URL('/', feed.origin);
    } catch {
        throw new FaviconDiscoveryError();
    }
};

export const makeFaviconService = (
    dependencies: FaviconServiceDependencies,
) => {
    const fetchImplementation =
        dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    const now = dependencies.now ?? Date.now;
    const refreshTarget = (target: FaviconTarget) =>
        Effect.tryPromise({
            try: async () => {
                const site = targetPage(target);
                let links: readonly URL[] = [];
                let fallbackSite = site;
                let retryablePageFailure = false;
                try {
                    const page = await fetchPage(site, fetchImplementation);
                    fallbackSite = page.url;
                    links = discoverFaviconLinks(page.body, page.url);
                } catch (cause) {
                    // Common same-origin candidates still provide a safe fallback.
                    retryablePageFailure =
                        cause instanceof FaviconPageUnavailable &&
                        cause.retryable;
                }
                const candidates = [
                    ...links,
                    new URL('/favicon.ico', fallbackSite),
                    new URL('/favicon.png', fallbackSite),
                    new URL('/apple-touch-icon.png', fallbackSite),
                ];
                let selected: {
                    readonly url: string;
                    readonly bytes: Uint8Array;
                } | null = null;
                let retryableImageFailure = false;
                const seen = new Set<string>();
                for (const candidate of candidates) {
                    if (seen.has(candidate.href)) continue;
                    seen.add(candidate.href);
                    try {
                        const image = await fetchImageBytes(
                            candidate.href,
                            fetchImplementation,
                        );
                        selected = { url: candidate.href, bytes: image };
                        break;
                    } catch (cause) {
                        if (!(cause instanceof FeedImageUnavailable))
                            throw cause;
                        retryableImageFailure ||= cause.retryable;
                    }
                }
                if (
                    selected === null &&
                    (retryablePageFailure || retryableImageFailure)
                )
                    throw new FaviconDiscoveryError();
                const faviconUrl = selected?.url ?? target.faviconUrl;
                let faviconAssetHash = target.faviconAssetHash;
                let faviconIsDark = target.faviconIsDark;
                if (selected !== null) {
                    if (dependencies.assetStore !== undefined) {
                        const asset = await dependencies.assetStore.persist(
                            selected.bytes,
                        );
                        faviconAssetHash = asset.hash;
                        if (asset.isDark !== null) faviconIsDark = asset.isDark;
                        else if (selected.url !== target.faviconUrl)
                            faviconIsDark = null;
                    } else {
                        const analyzed =
                            dependencies.analyzeDarkness === undefined
                                ? null
                                : await dependencies
                                      .analyzeDarkness(selected.bytes)
                                      .catch(() => null);
                        if (analyzed !== null) faviconIsDark = analyzed;
                        else if (selected.url !== target.faviconUrl)
                            faviconIsDark = null;
                        if (selected.url !== target.faviconUrl)
                            faviconAssetHash = null;
                    }
                }
                await Effect.runPromise(
                    dependencies.repository.update(
                        target.feedId,
                        faviconUrl,
                        faviconAssetHash,
                        faviconIsDark,
                        now(),
                        target.faviconUrl,
                        target.faviconUpdatedAt,
                    ),
                );
                return {
                    feedId: target.feedId,
                    faviconUrl,
                    faviconAssetHash,
                };
            },
            catch: (cause) =>
                cause instanceof FaviconDiscoveryError ||
                (typeof cause === 'object' && cause !== null && '_tag' in cause)
                    ? cause
                    : new FaviconDiscoveryError(),
        });
    return {
        refreshOwned: (userId: number, feedId: number) =>
            dependencies.repository
                .findOwnedTarget(userId, feedId)
                .pipe(Effect.flatMap(refreshTarget)),
        refreshIfStale: (feedId: number) =>
            dependencies.repository
                .findStaleTarget(feedId, now() - FAVICON_STALE_AFTER_MS)
                .pipe(
                    Effect.flatMap((target) =>
                        target === null
                            ? Effect.succeed(null)
                            : refreshTarget(target),
                    ),
                ),
        refreshStale: (limit = 1) =>
            dependencies.repository
                .listStaleTargets(
                    now() - FAVICON_STALE_AFTER_MS,
                    Math.max(1, Math.min(limit, 5)),
                )
                .pipe(
                    Effect.flatMap((targets) =>
                        Effect.forEach(targets, refreshTarget, {
                            concurrency: 1,
                        }),
                    ),
                ),
    };
};

export type FaviconService = ReturnType<typeof makeFaviconService>;

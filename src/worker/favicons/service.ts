import { Effect, Schema } from 'effect';

import { validateFeedUrl } from '../feeds/policy';
import { FeedImageUnavailable, fetchImageResource } from '../images/service';
import { spanNames, type TelemetryFailure, traceAsync } from '../observability';
import {
    FaviconAssetCandidateError,
    FaviconAssetStorageError,
    type FaviconAssetStore,
} from './assets';
import type { FaviconDarknessAnalyzer } from './darkness';
import type { FaviconRepository, FaviconTarget } from './repository';

const MAX_HTML_HEAD_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_INLINE_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const MAX_HTML_CANDIDATES = 6;
const MAX_MANIFEST_CANDIDATES = 3;
const MAX_TOTAL_CANDIDATES = 16;
const FETCH_TIMEOUT_MS = 5_000;
export const FAVICON_STALE_AFTER_MS = 30 * 24 * 60 * 60_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export class FaviconDiscoveryError extends Schema.TaggedError<FaviconDiscoveryError>()(
    'FaviconDiscoveryError',
    {},
) {}

class FaviconPageUnavailable extends Error {
    constructor(
        readonly retryable: boolean,
        readonly status?: number,
    ) {
        super('Favicon page is unavailable');
        this.name = 'FaviconPageUnavailable';
    }
}

const discoveryFailure =
    (stage: 'candidate_fetch' | 'manifest_fetch' | 'page_fetch') =>
    (cause: unknown): TelemetryFailure => {
        if (cause instanceof FaviconPageUnavailable) {
            return {
                errorClass: cause.name,
                stage,
                retryable: cause.retryable,
                ...(cause.status === undefined
                    ? {}
                    : { httpStatus: cause.status }),
            };
        }
        if (cause instanceof FeedImageUnavailable) {
            return {
                errorClass: cause._tag,
                stage,
                retryable: cause.retryable,
            };
        }
        return {
            errorClass:
                cause instanceof FaviconDiscoveryError ? cause._tag : 'Unknown',
            stage,
            retryable: false,
        };
    };

export interface FaviconServiceDependencies {
    readonly repository: FaviconRepository;
    readonly fetch?: typeof globalThis.fetch;
    readonly assetStore?: FaviconAssetStore;
    readonly analyzeDarkness?: FaviconDarknessAnalyzer;
    readonly now?: () => number;
}

type FaviconCandidate =
    | {
          readonly key: string;
          readonly score: number;
          readonly url: URL;
          readonly bytes: null;
      }
    | {
          readonly key: string;
          readonly score: number;
          readonly url: null;
          readonly bytes: Uint8Array;
      };

interface FetchedPage {
    readonly url: URL;
    readonly body: Uint8Array;
}

type XmlRecord = ReadonlyMap<string, string>;

const attributes = (tag: string): XmlRecord => {
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

const dataCandidate = (
    href: string,
    score: number,
): FaviconCandidate | null => {
    if (href.length > MAX_INLINE_BYTES * 2) return null;
    const match = /^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/iu.exec(
        href,
    );
    if (match === null) return null;
    try {
        const bytes = match[2]
            ? Uint8Array.from(atob(match[3] ?? ''), (value) =>
                  value.charCodeAt(0),
              )
            : new TextEncoder().encode(decodeURIComponent(match[3] ?? ''));
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_INLINE_BYTES)
            return null;
        return {
            key: href,
            score,
            url: null,
            bytes,
        };
    } catch {
        return null;
    }
};

const linkCandidates = (
    html: Uint8Array,
    pageUrl: URL,
): readonly FaviconCandidate[] => {
    const source = new TextDecoder().decode(html);
    const ranked: FaviconCandidate[] = [];
    const seen = new Set<string>();
    for (const tag of (source.match(/<link\b[^>]{0,4096}>/giu) ?? []).slice(
        0,
        100,
    )) {
        const values = attributes(tag);
        const rel = (values.get('rel') ?? '').toLocaleLowerCase().split(/\s+/u);
        const href = values.get('href');
        const icon = rel.includes('icon');
        const apple =
            rel.includes('apple-touch-icon') ||
            rel.includes('apple-touch-icon-precomposed');
        const mask = rel.includes('mask-icon');
        if (href === undefined || (!icon && !apple && !mask)) continue;
        const type = (values.get('type') ?? '').toLocaleLowerCase();
        const score =
            (icon ? 300 : apple ? 200 : 150) +
            (type.includes('png')
                ? 30
                : type.includes('icon')
                  ? 25
                  : type.includes('svg')
                    ? 10
                    : 0) +
            sizeScore(values.get('sizes') ?? '');
        const inline = dataCandidate(href, score);
        if (inline !== null) {
            if (!seen.has(inline.key)) {
                seen.add(inline.key);
                ranked.push(inline);
            }
            continue;
        }
        try {
            const url = validateFeedUrl(new URL(href, pageUrl));
            if (seen.has(url.href)) continue;
            seen.add(url.href);
            ranked.push({ key: url.href, score, url, bytes: null });
        } catch {
            // Invalid publisher-controlled candidates are ignored.
        }
    }
    return ranked
        .toSorted((left, right) => right.score - left.score)
        .slice(0, MAX_HTML_CANDIDATES);
};

export const discoverFaviconLinks = (
    html: Uint8Array,
    pageUrl: URL,
): readonly URL[] =>
    linkCandidates(html, pageUrl)
        .filter(
            (
                candidate,
            ): candidate is Extract<FaviconCandidate, { readonly url: URL }> =>
                candidate.url !== null,
        )
        .map(({ url }) => url);

const concatenateBytes = (
    chunks: readonly Uint8Array[],
    total: number,
): Uint8Array => {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
};

const boundedBody = async (
    response: Response,
    maximum: number,
): Promise<Uint8Array> => {
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
        if (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximum)
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
            if (total > maximum) {
                await reader.cancel();
                throw new FaviconDiscoveryError();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return concatenateBytes(chunks, total);
};

const boundedHtmlHead = async (
    response: Response,
    maximum: number,
): Promise<Uint8Array> => {
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && !/^\d+$/u.test(contentLength))
        throw new FaviconDiscoveryError();
    if (response.body === null) throw new FaviconDiscoveryError();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: Uint8Array[] = [];
    let decoded = '';
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return concatenateBytes(chunks, total);

            const remaining = maximum - total;
            const accepted = value.subarray(0, remaining);
            if (accepted.byteLength > 0) {
                chunks.push(accepted);
                total += accepted.byteLength;
                decoded += decoder.decode(accepted, { stream: true });
            }

            if (/<\/head\s*>/iu.test(decoded)) {
                await reader.cancel();
                return concatenateBytes(chunks, total);
            }
            if (accepted.byteLength < value.byteLength || total === maximum) {
                await reader.cancel();
                throw new FaviconDiscoveryError();
            }
        }
    } finally {
        reader.releaseLock();
    }
};

const fetchResource = async (
    rawUrl: URL,
    fetchImplementation: typeof globalThis.fetch,
    input: {
        readonly accept: string;
        readonly maximum: number;
        readonly acceptedMimes: ReadonlySet<string>;
        readonly readHtmlHead?: boolean;
    },
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
                    accept: input.accept,
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
            const mime =
                response.headers
                    .get('content-type')
                    ?.split(';', 1)[0]
                    ?.trim()
                    .toLocaleLowerCase() ?? '';
            if (!response.ok) {
                const retryable =
                    response.status === 408 ||
                    response.status === 425 ||
                    response.status === 429 ||
                    response.status >= 500;
                await response.body?.cancel();
                throw new FaviconPageUnavailable(retryable, response.status);
            }
            if (!input.acceptedMimes.has(mime)) {
                await response.body?.cancel();
                throw new FaviconDiscoveryError();
            }
            return {
                url,
                body:
                    input.readHtmlHead === true
                        ? await boundedHtmlHead(response, input.maximum)
                        : await boundedBody(response, input.maximum),
            };
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

const fetchPage = (
    url: URL,
    fetchImplementation: typeof globalThis.fetch,
): Promise<FetchedPage> =>
    traceAsync(
        spanNames.faviconPageFetch,
        {},
        async () =>
            fetchResource(url, fetchImplementation, {
                accept: 'text/html,application/xhtml+xml;q=0.9',
                maximum: MAX_HTML_HEAD_BYTES,
                acceptedMimes: new Set(['text/html', 'application/xhtml+xml']),
                readHtmlHead: true,
            }),
        discoveryFailure('page_fetch'),
    );

const manifestCandidates = async (
    page: FetchedPage,
    fetchImplementation: typeof globalThis.fetch,
): Promise<readonly FaviconCandidate[]> => {
    const source = new TextDecoder().decode(page.body);
    const candidates: FaviconCandidate[] = [];
    let manifestsFetched = 0;
    for (const tag of (source.match(/<link\b[^>]{0,4096}>/giu) ?? []).slice(
        0,
        100,
    )) {
        const values = attributes(tag);
        const rel = (values.get('rel') ?? '').toLocaleLowerCase().split(/\s+/u);
        const href = values.get('href');
        if (!rel.includes('manifest') || href === undefined) continue;
        if (manifestsFetched >= 2) break;
        manifestsFetched += 1;
        try {
            const url = validateFeedUrl(new URL(href, page.url));
            const manifest = await traceAsync(
                spanNames.faviconManifestFetch,
                {},
                async () =>
                    fetchResource(url, fetchImplementation, {
                        accept: 'application/manifest+json,application/json;q=0.9',
                        maximum: MAX_MANIFEST_BYTES,
                        acceptedMimes: new Set([
                            'application/manifest+json',
                            'application/json',
                            'application/octet-stream',
                            'text/json',
                            'text/plain',
                        ]),
                    }),
                discoveryFailure('manifest_fetch'),
            );
            const parsed: unknown = JSON.parse(
                new TextDecoder().decode(manifest.body),
            );
            const icons =
                typeof parsed === 'object' && parsed !== null
                    ? Reflect.get(parsed, 'icons')
                    : undefined;
            if (!Array.isArray(icons)) continue;
            for (const icon of icons.slice(0, 20)) {
                const sourceUrl =
                    typeof icon === 'object' && icon !== null
                        ? Reflect.get(icon, 'src')
                        : undefined;
                if (typeof sourceUrl !== 'string') continue;
                try {
                    const iconUrl = validateFeedUrl(
                        new URL(sourceUrl, manifest.url),
                    );
                    candidates.push({
                        key: iconUrl.href,
                        score: 180,
                        url: iconUrl,
                        bytes: null,
                    });
                } catch {
                    // Invalid manifest entries are ignored.
                }
            }
        } catch {
            // A manifest is optional and must not make page discovery fail.
        }
    }
    return candidates.slice(0, MAX_MANIFEST_CANDIDATES);
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

const addCandidate = (
    candidates: Map<string, FaviconCandidate>,
    candidate: FaviconCandidate,
): void => {
    const existing = candidates.get(candidate.key);
    if (existing === undefined || candidate.score > existing.score)
        candidates.set(candidate.key, candidate);
};

const conventionalCandidates = (site: URL): readonly FaviconCandidate[] =>
    [
        ['/favicon.ico', 100],
        ['/favicon.png', 90],
        ['/favicon-32x32.png', 89],
        ['/favicon-16x16.png', 88],
        ['/apple-touch-icon.png', 87],
        ['/apple-touch-icon-precomposed.png', 86],
        ['/android-chrome-192x192.png', 85],
    ].map(([path, score]) => {
        const url = new URL(path as string, site);
        return {
            key: url.href,
            score: score as number,
            url,
            bytes: null,
        };
    });

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
                const pages: FetchedPage[] = [];
                let retryablePageFailure = false;
                try {
                    pages.push(await fetchPage(site, fetchImplementation));
                } catch (cause) {
                    retryablePageFailure =
                        cause instanceof FaviconPageUnavailable &&
                        cause.retryable;
                }
                const root = new URL('/', pages[0]?.url ?? site);
                if (
                    root.href !== site.href &&
                    !pages.some((page) => page.url.href === root.href)
                ) {
                    try {
                        pages.push(await fetchPage(root, fetchImplementation));
                    } catch (cause) {
                        retryablePageFailure ||=
                            cause instanceof FaviconPageUnavailable &&
                            cause.retryable;
                    }
                }

                const candidates = new Map<string, FaviconCandidate>();
                for (const page of pages) {
                    for (const candidate of linkCandidates(page.body, page.url))
                        addCandidate(candidates, candidate);
                    for (const candidate of await manifestCandidates(
                        page,
                        fetchImplementation,
                    ))
                        addCandidate(candidates, candidate);
                }
                for (const candidate of conventionalCandidates(root))
                    addCandidate(candidates, candidate);
                if (target.faviconUrl !== null) {
                    try {
                        const url = validateFeedUrl(target.faviconUrl);
                        addCandidate(candidates, {
                            key: url.href,
                            score: 70,
                            url,
                            bytes: null,
                        });
                    } catch {
                        // Invalid historical metadata is ignored.
                    }
                }

                let selected: {
                    readonly url: string | null;
                    readonly hash: string | null;
                    readonly isDark: boolean | null;
                } | null = null;
                let retryableCandidateFailure = false;
                const rankedCandidates = [...candidates.values()]
                    .toSorted((left, right) => right.score - left.score)
                    .slice(0, MAX_TOTAL_CANDIDATES);
                for (const [
                    candidateIndex,
                    candidate,
                ] of rankedCandidates.entries()) {
                    let bytes: Uint8Array;
                    try {
                        if (candidate.bytes !== null) {
                            bytes = candidate.bytes;
                        } else {
                            const resource = await traceAsync(
                                spanNames.faviconCandidateFetch,
                                {
                                    'app.favicon.candidate_rank':
                                        candidateIndex + 1,
                                    'app.favicon.candidate_score':
                                        candidate.score,
                                },
                                async (span) => {
                                    const fetched = await fetchImageResource(
                                        candidate.url.href,
                                        fetchImplementation,
                                        { allowSvg: true, allowGeneric: true },
                                    );
                                    span.setAttribute(
                                        'app.favicon.source_mime',
                                        fetched.mime,
                                    );
                                    span.setAttribute(
                                        'app.favicon.source_bytes',
                                        fetched.bytes.byteLength,
                                    );
                                    return fetched;
                                },
                                discoveryFailure('candidate_fetch'),
                            );
                            bytes = resource.bytes;
                        }
                    } catch (cause) {
                        if (cause instanceof FeedImageUnavailable)
                            retryableCandidateFailure ||= cause.retryable;
                        continue;
                    }

                    if (dependencies.assetStore !== undefined) {
                        try {
                            const asset =
                                await dependencies.assetStore.persist(bytes);
                            selected = {
                                url: candidate.url?.href ?? target.faviconUrl,
                                hash: asset.hash,
                                isDark: asset.isDark,
                            };
                            break;
                        } catch (cause) {
                            if (cause instanceof FaviconAssetCandidateError) {
                                retryableCandidateFailure ||= cause.retryable;
                                continue;
                            }
                            if (cause instanceof FaviconAssetStorageError)
                                throw cause;
                            retryableCandidateFailure = true;
                            continue;
                        }
                    }

                    const analyzed =
                        dependencies.analyzeDarkness === undefined
                            ? null
                            : await dependencies
                                  .analyzeDarkness(bytes)
                                  .catch(() => null);
                    selected = {
                        url: candidate.url?.href ?? target.faviconUrl,
                        hash: null,
                        isDark: analyzed,
                    };
                    break;
                }

                if (
                    selected === null &&
                    (retryablePageFailure || retryableCandidateFailure)
                )
                    throw new FaviconDiscoveryError();
                const faviconUrl = selected?.url ?? target.faviconUrl;
                const faviconAssetHash =
                    selected === null ? target.faviconAssetHash : selected.hash;
                const faviconIsDark =
                    selected === null
                        ? target.faviconIsDark
                        : selected.isDark !== null
                          ? selected.isDark
                          : selected.url === target.faviconUrl
                            ? target.faviconIsDark
                            : null;
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

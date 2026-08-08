import { EntrySummaryResponse } from '@shared/schemas/summaries';
import { Effect } from 'effect';

import { generateSafeId } from '../auth/crypto';
import { sanitizeArticleHtml } from '../feeds/sanitize';
import type { SummaryConfig } from './config';
import {
    SummaryContentChanged,
    SummaryContentUnavailable,
    SummaryFeatureDisabled,
    SummaryGenerationInProgress,
    SummaryInvariantError,
    SummaryProviderError,
} from './errors';
import type { SummaryProvider } from './provider';
import type { SummaryRepository } from './repository';

export const SUMMARY_MAX_ARTICLE_BYTES = 50_000;
export const SUMMARY_MAX_TITLE_BYTES = 1_000;
export const SUMMARY_MAX_HTML_BYTES = 32_000;
export const SUMMARY_GENERATION_LEASE_MS = 60_000;
export const SUMMARY_EMPTY_CONTENT_HTML = 'No content available to summarize.';

export interface SummaryServiceDependencies {
    readonly config: SummaryConfig;
    readonly repository: SummaryRepository;
    readonly provider?: SummaryProvider;
    readonly now?: () => number;
    readonly generateId?: () => Effect.Effect<number, SummaryInvariantError>;
}

const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const sameBytes = (left: Uint8Array | null, right: Uint8Array): boolean =>
    left !== null &&
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);

export const truncateUtf8 = (value: string, maximumBytes: number): string => {
    const encoded = utf8.encode(value);
    if (encoded.byteLength <= maximumBytes) return value;

    let end = maximumBytes;
    while (end > 0) {
        try {
            return strictUtf8.decode(encoded.subarray(0, end));
        } catch {
            end -= 1;
        }
    }
    return '';
};

const decodeEntities = (value: string): string =>
    value.replace(
        /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
        (
            match,
            decimal: string | undefined,
            hex: string | undefined,
            name: string | undefined,
        ) => {
            if (decimal !== undefined) {
                const codePoint = Number.parseInt(decimal, 10);
                return codePoint <= 0x10ffff
                    ? String.fromCodePoint(codePoint)
                    : '\ufffd';
            }
            if (hex !== undefined) {
                const codePoint = Number.parseInt(hex, 16);
                return codePoint <= 0x10ffff
                    ? String.fromCodePoint(codePoint)
                    : '\ufffd';
            }
            switch (name?.toLowerCase()) {
                case 'amp':
                    return '&';
                case 'lt':
                    return '<';
                case 'gt':
                    return '>';
                case 'quot':
                    return '"';
                case 'apos':
                case '#39':
                    return "'";
                case 'nbsp':
                    return ' ';
                default:
                    return match;
            }
        },
    );

const articleBaseUrl = (url: string | null): URL => {
    try {
        const parsed = new URL(url ?? 'https://larafeed.invalid/');
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? parsed
            : new URL('https://larafeed.invalid/');
    } catch {
        return new URL('https://larafeed.invalid/');
    }
};

export const articleText = (html: string, baseUrl: URL): string => {
    const sanitized = sanitizeArticleHtml(html, baseUrl);
    return decodeEntities(
        sanitized
            .replace(/<br\s*>/giu, '\n')
            .replace(/<\/(?:p|div|li|blockquote|h[1-6]|tr)>/giu, '\n')
            .replace(/<[^>]*>/gu, ' '),
    )
        .replace(/[\t\f\v ]+/gu, ' ')
        .replace(/ *\n */gu, '\n')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
};

const summaryElements = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em']);

export const providerHtml = (value: string): string => {
    const withoutFence = value
        .trim()
        .replace(/^```(?:html)?\s*/iu, '')
        .replace(/\s*```$/u, '');
    const sanitized = sanitizeArticleHtml(
        withoutFence,
        'https://larafeed.invalid/',
    );

    return sanitized.replace(
        /<(\/?)((?:[a-z][a-z0-9]*))(?:\s[^>]*)?>/giu,
        (_match, closing: string, name: string) =>
            summaryElements.has(name.toLowerCase())
                ? `<${closing}${name.toLowerCase()}>`
                : '',
    );
};

export const makeSummaryService = (
    dependencies: SummaryServiceDependencies,
) => {
    const { config, repository } = dependencies;
    const currentTime = dependencies.now ?? Date.now;
    const nextId =
        dependencies.generateId ??
        (() =>
            generateSafeId().pipe(
                Effect.mapError(
                    () =>
                        new SummaryInvariantError({
                            operation: 'summaries.id.generate',
                        }),
                ),
            ));
    const readKey = config.enabled
        ? {
              model: config.model,
              promptVersion: config.promptVersion,
          }
        : undefined;

    return {
        get: (userId: number, entryId: number) =>
            repository
                .findOwnedEntry(userId, entryId, readKey)
                .pipe(
                    Effect.map((entry) =>
                        EntrySummaryResponse.make({ summary: entry.summary }),
                    ),
                ),
        generate: (userId: number, entryId: number) =>
            Effect.gen(function* () {
                if (!config.enabled) {
                    return yield* Effect.fail(new SummaryFeatureDisabled());
                }

                const key = {
                    model: config.model,
                    promptVersion: config.promptVersion,
                } as const;
                const entry = yield* repository.findOwnedEntry(
                    userId,
                    entryId,
                    key,
                );
                if (entry.summary !== null) {
                    return EntrySummaryResponse.make({
                        summary: entry.summary,
                    });
                }
                const contentHash = entry.contentHash;
                if (contentHash === null) {
                    return yield* Effect.fail(new SummaryContentUnavailable());
                }
                const text =
                    entry.contentHtml === null
                        ? ''
                        : truncateUtf8(
                              articleText(
                                  entry.contentHtml,
                                  articleBaseUrl(entry.url),
                              ),
                              SUMMARY_MAX_ARTICLE_BYTES,
                          );

                const leaseNow = currentTime();
                const lease = {
                    userId,
                    entryId,
                    contentHash,
                    leaseToken: yield* nextId(),
                    ...key,
                    now: leaseNow,
                    expiresAt: leaseNow + SUMMARY_GENERATION_LEASE_MS,
                };
                const claimed = yield* repository.claimGeneration(lease);
                if (!claimed) {
                    const current = yield* repository.findOwnedEntry(
                        userId,
                        entryId,
                        key,
                    );
                    if (current.summary !== null) {
                        return EntrySummaryResponse.make({
                            summary: current.summary,
                        });
                    }
                    return yield* Effect.fail(
                        sameBytes(current.contentHash, contentHash)
                            ? new SummaryGenerationInProgress()
                            : new SummaryContentChanged(),
                    );
                }

                const generate = Effect.gen(function* () {
                    let html = SUMMARY_EMPTY_CONTENT_HTML;
                    if (text.length > 0) {
                        const provider = dependencies.provider;
                        if (provider === undefined) {
                            return yield* Effect.fail(
                                new SummaryInvariantError({
                                    operation: 'summaries.provider.missing',
                                }),
                            );
                        }
                        const title = truncateUtf8(
                            entry.title.trim() || 'Untitled article',
                            SUMMARY_MAX_TITLE_BYTES,
                        );
                        const generated = yield* provider.generate({
                            title,
                            articleText: text,
                        });
                        html = providerHtml(generated);
                        if (
                            html.length === 0 ||
                            utf8.encode(html).byteLength >
                                SUMMARY_MAX_HTML_BYTES
                        ) {
                            return yield* Effect.fail(
                                new SummaryProviderError({
                                    kind:
                                        html.length === 0
                                            ? 'invalid_response'
                                            : 'output_too_large',
                                }),
                            );
                        }
                    }

                    const summary = yield* repository.saveSummary({
                        id: yield* nextId(),
                        userId,
                        entryId,
                        contentHash,
                        leaseToken: lease.leaseToken,
                        html,
                        ...key,
                        now: currentTime(),
                    });
                    return EntrySummaryResponse.make({ summary });
                });

                return yield* generate.pipe(
                    Effect.ensuring(
                        repository.releaseGeneration(lease).pipe(Effect.ignore),
                    ),
                );
            }),
    };
};

export type SummaryService = ReturnType<typeof makeSummaryService>;

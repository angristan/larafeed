import { EntryFullContentResponse } from '@shared/schemas/fullContent';
import { Effect } from 'effect';

import { MAX_CONTENT_BYTES, sanitizeArticleHtml } from '../feeds/sanitize';
import type { SummaryConfig } from '../summaries/config';
import { SummaryProviderError } from '../summaries/errors';
import type { SummaryProvider } from '../summaries/provider';
import {
    articleText,
    providerHtml,
    SUMMARY_EMPTY_CONTENT_HTML,
    SUMMARY_MAX_ARTICLE_BYTES,
    SUMMARY_MAX_HTML_BYTES,
    SUMMARY_MAX_TITLE_BYTES,
    truncateUtf8,
} from '../summaries/service';
import type { FullContentConfig } from './config';
import {
    FullContentDisabled,
    FullContentExtractError,
    FullContentInvariantError,
    FullContentSourceMissing,
    FullContentSummaryDisabled,
    FullContentTooLarge,
    FullContentUnavailable,
} from './errors';
import { extractArticle } from './extract';
import type { ArticlePageFetcher } from './fetch';
import type { FullContentRepository } from './repository';
import type { FullContentStore, StoredFullContent } from './store';

export interface FullContentServiceDependencies {
    readonly config: FullContentConfig;
    readonly summaryConfig: SummaryConfig;
    readonly repository: FullContentRepository;
    readonly store: FullContentStore;
    readonly fetchPage: ArticlePageFetcher;
    readonly provider?: SummaryProvider;
    readonly now?: () => number;
    // Injected when the image proxy is enabled; the default keeps the
    // sanitized source URLs so images still load where CSP allows them.
    readonly rewriteImages?: (
        entryId: number,
        html: string,
        baseUrl: string,
    ) => Promise<string>;
}

const utf8 = new TextEncoder();

const articleBaseUrl = (url: string): URL => {
    try {
        return new URL(url);
    } catch {
        return new URL('https://larafeed.invalid/');
    }
};

export const makeFullContentService = (
    dependencies: FullContentServiceDependencies,
) => {
    const { config, summaryConfig, repository, store, fetchPage } =
        dependencies;
    const currentTime = dependencies.now ?? Date.now;
    const rewriteImages =
        dependencies.rewriteImages ??
        ((_entryId: number, html: string) => Promise.resolve(html));

    const toResponse = (record: StoredFullContent) =>
        Effect.tryPromise({
            try: async () =>
                EntryFullContentResponse.make({
                    fullContent: {
                        entryId: record.entryId,
                        html: await rewriteImages(
                            record.entryId,
                            record.html,
                            record.sourceUrl,
                        ),
                        sourceUrl: record.sourceUrl,
                        fetchedAt: record.fetchedAt,
                        summary: record.summary,
                    },
                }),
            catch: () =>
                new FullContentInvariantError({
                    operation: 'fullContent.images',
                }),
        });

    return {
        get: (userId: number, entryId: number) =>
            Effect.gen(function* () {
                yield* repository.findOwnedEntry(userId, entryId);
                const record = yield* store.load(entryId);
                if (record === null) {
                    return EntryFullContentResponse.make({ fullContent: null });
                }
                return yield* toResponse(record);
            }),
        fetchContent: (userId: number, entryId: number) =>
            Effect.gen(function* () {
                if (!config.enabled) {
                    return yield* Effect.fail(new FullContentDisabled());
                }
                const entry = yield* repository.findOwnedEntry(userId, entryId);
                const existing = yield* store.load(entryId);
                if (existing !== null) {
                    return yield* toResponse(existing);
                }
                if (entry.url === null) {
                    return yield* Effect.fail(new FullContentSourceMissing());
                }

                const page = yield* fetchPage(entry.url);
                const extracted = extractArticle(page.html);
                if (extracted === null) {
                    return yield* Effect.fail(new FullContentExtractError());
                }
                const sanitized = sanitizeArticleHtml(
                    extracted.html,
                    page.finalUrl,
                );
                if (sanitized.trim().length === 0) {
                    return yield* Effect.fail(new FullContentExtractError());
                }
                if (utf8.encode(sanitized).byteLength > MAX_CONTENT_BYTES) {
                    return yield* Effect.fail(new FullContentTooLarge());
                }

                // Concurrent fetches of the same entry are rare and harmless:
                // both produce equivalent records and the last write wins.
                const record: StoredFullContent = {
                    version: 1,
                    entryId,
                    sourceUrl: page.finalUrl.href,
                    fetchedAt: currentTime(),
                    html: sanitized,
                    summary: null,
                };
                yield* store.save(record);
                return yield* toResponse(record);
            }),
        summarize: (userId: number, entryId: number) =>
            Effect.gen(function* () {
                if (!config.enabled) {
                    return yield* Effect.fail(new FullContentDisabled());
                }
                if (!summaryConfig.enabled) {
                    return yield* Effect.fail(new FullContentSummaryDisabled());
                }
                const entry = yield* repository.findOwnedEntry(userId, entryId);
                const record = yield* store.load(entryId);
                if (record === null) {
                    return yield* Effect.fail(new FullContentUnavailable());
                }
                if (record.summary !== null) {
                    return yield* toResponse(record);
                }
                const provider = dependencies.provider;
                if (provider === undefined) {
                    return yield* Effect.fail(
                        new FullContentInvariantError({
                            operation: 'fullContent.provider.missing',
                        }),
                    );
                }

                const text = truncateUtf8(
                    articleText(record.html, articleBaseUrl(record.sourceUrl)),
                    SUMMARY_MAX_ARTICLE_BYTES,
                );
                let html = SUMMARY_EMPTY_CONTENT_HTML;
                if (text.length > 0) {
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
                        utf8.encode(html).byteLength > SUMMARY_MAX_HTML_BYTES
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

                // Concurrent generations both write an equivalent summary;
                // a re-fetch resets the summary together with the content.
                const updated: StoredFullContent = {
                    ...record,
                    summary: {
                        html,
                        model: summaryConfig.model,
                        promptVersion: summaryConfig.promptVersion,
                        generatedAt: currentTime(),
                    },
                };
                yield* store.save(updated);
                return yield* toResponse(updated);
            }),
    };
};

export type FullContentService = ReturnType<typeof makeFullContentService>;

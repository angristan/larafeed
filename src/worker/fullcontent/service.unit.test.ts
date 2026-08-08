import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { SummaryConfig } from '../summaries/config';
import { FullContentFetchError } from './errors';
import type { ArticlePageFetcher } from './fetch';
import type { FullContentRepository } from './repository';
import { makeFullContentService } from './service';
import type { FullContentStore, StoredFullContent } from './store';

const enabledSummaryConfig: SummaryConfig = {
    enabled: true,
    gatewayName: 'larafeed',
    model: '@cf/test/model',
    promptVersion: 'entry-summary-v1',
};

const paragraphs = Array.from(
    { length: 12 },
    (_, index) =>
        `<p>Paragraph ${index + 1}: enough repeated readable text for the ` +
        'extractor to accept this article as the main page content.</p>',
).join('\n');

const articlePage = `<!doctype html><html>
<head><title>Page</title></head>
<body>
<nav><a href="/">Home</a></nav>
<article><h1>Title</h1>${paragraphs}</article>
<footer>Footer noise.</footer>
</body></html>`;

const makeMemoryStore = (): FullContentStore & {
    readonly records: Map<number, StoredFullContent>;
} => {
    const records = new Map<number, StoredFullContent>();
    return {
        records,
        load: (entryId) => Effect.succeed(records.get(entryId) ?? null),
        save: (record) =>
            Effect.sync(() => {
                records.set(record.entryId, record);
            }),
    };
};

const repository: FullContentRepository = {
    findOwnedEntry: (_userId, entryId) =>
        Effect.succeed({
            entryId,
            title: 'Title',
            url: 'https://example.test/article',
        }),
};

const fetchPageOk: ArticlePageFetcher = () =>
    Effect.succeed({
        html: articlePage,
        finalUrl: new URL('https://example.test/article'),
    });

const identityRewrite = (_entryId: number, html: string) =>
    Promise.resolve(html);

const makeService = (
    overrides: Partial<Parameters<typeof makeFullContentService>[0]> = {},
) =>
    makeFullContentService({
        config: { enabled: true },
        summaryConfig: enabledSummaryConfig,
        repository,
        store: makeMemoryStore(),
        fetchPage: fetchPageOk,
        now: () => 1_900_000_000_000,
        rewriteImages: identityRewrite,
        ...overrides,
    });

describe('full content service', () => {
    it('returns null when nothing is cached', async () => {
        const response = await Effect.runPromise(makeService().get(7, 31));
        expect(response.fullContent).toBeNull();
    });

    it('fetches, extracts, sanitizes, and stores the article', async () => {
        const store = makeMemoryStore();
        const service = makeService({ store });
        const response = await Effect.runPromise(service.fetchContent(7, 31));

        expect(response.fullContent).not.toBeNull();
        expect(response.fullContent?.html).toContain('Paragraph 1');
        expect(response.fullContent?.html).not.toContain('Footer noise');
        expect(response.fullContent?.sourceUrl).toBe(
            'https://example.test/article',
        );
        expect(store.records.get(31)?.summary).toBeNull();
    });

    it('returns the cached record without fetching again', async () => {
        const store = makeMemoryStore();
        const fetchPage = vi.fn(fetchPageOk);
        const service = makeService({ store, fetchPage });

        await Effect.runPromise(service.fetchContent(7, 31));
        await Effect.runPromise(service.fetchContent(7, 31));
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('fails when the entry has no source URL', async () => {
        const service = makeService({
            repository: {
                findOwnedEntry: (_userId, entryId) =>
                    Effect.succeed({ entryId, title: 'Title', url: null }),
            },
        });
        const error = await Effect.runPromise(
            Effect.flip(service.fetchContent(7, 31)),
        );
        expect(error).toMatchObject({ _tag: 'FullContentSourceMissing' });
    });

    it('propagates fetch failures', async () => {
        const service = makeService({
            fetchPage: () =>
                Effect.fail(new FullContentFetchError({ kind: 'timeout' })),
        });
        const error = await Effect.runPromise(
            Effect.flip(service.fetchContent(7, 31)),
        );
        expect(error).toMatchObject({
            _tag: 'FullContentFetchError',
            kind: 'timeout',
        });
    });

    it('fails extraction on empty pages', async () => {
        const service = makeService({
            fetchPage: () =>
                Effect.succeed({
                    html: '<html><body></body></html>',
                    finalUrl: new URL('https://example.test/article'),
                }),
        });
        const error = await Effect.runPromise(
            Effect.flip(service.fetchContent(7, 31)),
        );
        expect(error).toMatchObject({ _tag: 'FullContentExtractError' });
    });

    it('fails when the feature is disabled', async () => {
        const service = makeService({ config: { enabled: false } });
        const error = await Effect.runPromise(
            Effect.flip(service.fetchContent(7, 31)),
        );
        expect(error).toMatchObject({ _tag: 'FullContentDisabled' });
    });

    it('summarizes fetched content and stores the summary', async () => {
        const store = makeMemoryStore();
        const generate = vi.fn(
            (_input: { title: string; articleText: string }) =>
                Effect.succeed('<p><strong>Summary.</strong></p>'),
        );
        const service = makeService({
            store,
            provider: { generate },
        });

        await Effect.runPromise(service.fetchContent(7, 31));
        const response = await Effect.runPromise(service.summarize(7, 31));

        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate.mock.calls[0]?.[0]).toMatchObject({ title: 'Title' });
        expect(response.fullContent?.summary).toMatchObject({
            html: '<p><strong>Summary.</strong></p>',
            model: '@cf/test/model',
            promptVersion: 'entry-summary-v1',
        });
        expect(store.records.get(31)?.summary?.html).toBe(
            '<p><strong>Summary.</strong></p>',
        );
    });

    it('returns the cached summary without regenerating', async () => {
        const store = makeMemoryStore();
        const generate = vi.fn(() => Effect.succeed('<p>Summary.</p>'));
        const service = makeService({ store, provider: { generate } });

        await Effect.runPromise(service.fetchContent(7, 31));
        await Effect.runPromise(service.summarize(7, 31));
        await Effect.runPromise(service.summarize(7, 31));
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('requires fetched content before summarizing', async () => {
        const service = makeService({
            provider: { generate: () => Effect.succeed('<p>x</p>') },
        });
        const error = await Effect.runPromise(
            Effect.flip(service.summarize(7, 31)),
        );
        expect(error).toMatchObject({ _tag: 'FullContentUnavailable' });
    });

    it('fails summarize when AI summaries are disabled', async () => {
        const service = makeService({
            summaryConfig: {
                enabled: false,
                promptVersion: 'entry-summary-v1',
            },
        });
        const error = await Effect.runPromise(
            Effect.flip(service.summarize(7, 31)),
        );
        expect(error).toMatchObject({ _tag: 'FullContentSummaryDisabled' });
    });
});

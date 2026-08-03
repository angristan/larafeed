import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { SummaryConfig } from './config';
import {
    SummaryContentChanged,
    SummaryFeatureDisabled,
    SummaryGenerationInProgress,
    SummaryProviderError,
} from './errors';
import type { SummaryProvider } from './provider';
import type { OwnedSummaryEntry, SummaryRepository } from './repository';
import {
    makeSummaryService,
    SUMMARY_EMPTY_CONTENT_HTML,
    SUMMARY_MAX_ARTICLE_BYTES,
    SUMMARY_MAX_HTML_BYTES,
} from './service';

const config: SummaryConfig = {
    enabled: true,
    accountId: '0123456789abcdef0123456789abcdef',
    gatewayName: 'larafeed-ai',
    model: 'gemini-2.5-flash',
    promptVersion: 'entry-summary-v1',
    apiKey: 'secret',
};
const entry: OwnedSummaryEntry = {
    entryId: 31,
    title: 'Article',
    url: 'https://example.test/article',
    contentHtml: '<p>Article content</p>',
    contentHash: new Uint8Array(32).fill(7),
    summary: null,
};
const cached = {
    id: 41,
    entryId: 31,
    html: '<p>Cached.</p>',
    model: config.model,
    promptVersion: config.promptVersion,
    generatedAt: 1_900_000_000_000,
};

const makeRepository = (owned: OwnedSummaryEntry): SummaryRepository => ({
    findOwnedEntry: vi.fn(() => Effect.succeed(owned)),
    claimGeneration: vi.fn(() => Effect.succeed(true)),
    releaseGeneration: vi.fn(() => Effect.void),
    saveSummary: vi.fn((input) =>
        Effect.succeed({
            ...cached,
            id: input.id,
            html: input.html,
            generatedAt: input.now,
        }),
    ),
});
const makeProvider = (html: string): SummaryProvider => ({
    generate: vi.fn(() => Effect.succeed(html)),
});

describe('summary service', () => {
    it('honors the kill switch without constructing a provider', async () => {
        const repository = makeRepository(entry);
        const service = makeSummaryService({
            config: {
                enabled: false,
                promptVersion: 'entry-summary-v1',
            },
            repository,
        });

        const error = await Effect.runPromise(service.generate(7, 31)).catch(
            (cause: unknown) => cause,
        );
        expect(error).toBeInstanceOf(SummaryFeatureDisabled);
        expect(repository.findOwnedEntry).not.toHaveBeenCalled();
    });

    it('reads the latest cached summary while generation is disabled', async () => {
        const repository = makeRepository({ ...entry, summary: cached });
        const service = makeSummaryService({
            config: {
                enabled: false,
                promptVersion: 'entry-summary-v1',
            },
            repository,
        });

        await expect(Effect.runPromise(service.get(7, 31))).resolves.toEqual({
            summary: cached,
        });
        expect(repository.findOwnedEntry).toHaveBeenCalledWith(
            7,
            31,
            undefined,
        );
    });

    it('uses content hash, model, and prompt version cache before provider calls', async () => {
        const repository = makeRepository({ ...entry, summary: cached });
        const provider = makeProvider('<p>Unused</p>');
        const service = makeSummaryService({ config, repository, provider });

        await expect(
            Effect.runPromise(service.generate(7, 31)),
        ).resolves.toEqual({ summary: cached });
        expect(repository.findOwnedEntry).toHaveBeenCalledWith(7, 31, {
            model: config.model,
            promptVersion: config.promptVersion,
        });
        expect(provider.generate).not.toHaveBeenCalled();
        expect(repository.saveSummary).not.toHaveBeenCalled();
    });

    it('does not call the provider when another request owns generation', async () => {
        const repository = makeRepository(entry);
        vi.mocked(repository.claimGeneration).mockReturnValue(
            Effect.succeed(false),
        );
        const provider = makeProvider('<p>Unused</p>');
        const service = makeSummaryService({ config, repository, provider });

        await expect(
            Effect.runPromise(service.generate(7, 31)),
        ).rejects.toBeInstanceOf(SummaryGenerationInProgress);
        expect(provider.generate).not.toHaveBeenCalled();
        expect(repository.saveSummary).not.toHaveBeenCalled();
        expect(repository.releaseGeneration).not.toHaveBeenCalled();
    });

    it('reports content changes that happen before lease claim', async () => {
        const repository = makeRepository(entry);
        vi.mocked(repository.claimGeneration).mockReturnValue(
            Effect.succeed(false),
        );
        vi.mocked(repository.findOwnedEntry)
            .mockReturnValueOnce(Effect.succeed(entry))
            .mockReturnValueOnce(
                Effect.succeed({
                    ...entry,
                    contentHash: new Uint8Array(32).fill(8),
                }),
            );
        const provider = makeProvider('<p>Unused</p>');
        const service = makeSummaryService({ config, repository, provider });

        await expect(
            Effect.runPromise(service.generate(7, 31)),
        ).rejects.toBeInstanceOf(SummaryContentChanged);
        expect(provider.generate).not.toHaveBeenCalled();
    });

    it('releases generation ownership after provider failure', async () => {
        const repository = makeRepository(entry);
        const provider: SummaryProvider = {
            generate: () =>
                Effect.fail(new SummaryProviderError({ kind: 'transport' })),
        };
        const service = makeSummaryService({ config, repository, provider });

        await expect(
            Effect.runPromise(service.generate(7, 31)),
        ).rejects.toBeInstanceOf(SummaryProviderError);
        expect(repository.releaseGeneration).toHaveBeenCalledTimes(1);
    });

    it('sanitizes and bounds article input and provider HTML output', async () => {
        const repository = makeRepository({
            ...entry,
            contentHtml: `<p>${'é'.repeat(30_000)}</p><script>private()</script>`,
        });
        const provider = makeProvider(
            '```html\n<p onclick="bad()"><script>bad()</script><strong>Safe</strong><a href="https://tracker.test"> text</a><img src="https://tracker.test/pixel"></p>\n```',
        );
        const service = makeSummaryService({
            config,
            repository,
            provider,
            now: () => 1_900_000_000_100,
            generateId: () => Effect.succeed(42),
        });

        await expect(
            Effect.runPromise(service.generate(7, 31)),
        ).resolves.toMatchObject({
            summary: {
                id: 42,
                html: '<p><strong>Safe</strong> text</p>',
            },
        });
        const input = vi.mocked(provider.generate).mock.calls[0]?.[0];
        expect(input).toBeDefined();
        expect(new TextEncoder().encode(input?.articleText).byteLength).toBe(
            SUMMARY_MAX_ARTICLE_BYTES,
        );
        expect(input?.articleText).not.toContain('private');
        expect(repository.saveSummary).toHaveBeenCalledWith(
            expect.objectContaining({
                contentHash: entry.contentHash,
                model: config.model,
                promptVersion: config.promptVersion,
                html: '<p><strong>Safe</strong> text</p>',
            }),
        );
    });

    it('persists the legacy explanation without a provider for empty content', async () => {
        const repository = makeRepository({
            ...entry,
            contentHtml: '<script>not article content</script>',
        });
        const provider = makeProvider('<p>Unused</p>');
        const service = makeSummaryService({
            config,
            repository,
            provider,
            now: () => 1_900_000_000_100,
            generateId: () => Effect.succeed(42),
        });

        await expect(
            Effect.runPromise(service.generate(7, 31)),
        ).resolves.toMatchObject({
            summary: {
                id: 42,
                html: SUMMARY_EMPTY_CONTENT_HTML,
            },
        });
        expect(provider.generate).not.toHaveBeenCalled();
        expect(repository.claimGeneration).toHaveBeenCalledTimes(1);
        expect(repository.saveSummary).toHaveBeenCalledWith(
            expect.objectContaining({
                contentHash: entry.contentHash,
                html: SUMMARY_EMPTY_CONTENT_HTML,
            }),
        );
        expect(repository.releaseGeneration).toHaveBeenCalledTimes(1);
    });

    it('rejects sanitized output above the persistence bound', async () => {
        const provider = makeProvider(
            `<p>${'x'.repeat(SUMMARY_MAX_HTML_BYTES)}</p>`,
        );
        const repository = makeRepository(entry);
        const service = makeSummaryService({ config, repository, provider });

        const error = await Effect.runPromise(service.generate(7, 31)).catch(
            (cause: unknown) => cause,
        );
        expect(error).toBeInstanceOf(SummaryProviderError);
        expect(error).toMatchObject({ kind: 'output_too_large' });
        expect(repository.saveSummary).not.toHaveBeenCalled();
    });
});

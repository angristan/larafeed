import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { EnabledSummaryConfig } from './config';
import { SummaryProviderError } from './errors';
import {
    makeSummaryProvider,
    SUMMARY_MAX_OUTPUT_TOKENS,
    SUMMARY_MAX_PROVIDER_BODY_BYTES,
    type SummaryModelRunner,
} from './provider';

const config: EnabledSummaryConfig = {
    enabled: true,
    gatewayName: 'larafeed-ai',
    model: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    promptVersion: 'entry-summary-v1',
};

type RunMock = ReturnType<typeof vi.fn<SummaryModelRunner['run']>>;
const runner = (run: RunMock): SummaryModelRunner => ({ run });

describe('Workers AI binding provider', () => {
    it('runs the configured model through the configured gateway', async () => {
        const run = vi.fn<SummaryModelRunner['run']>(() =>
            Promise.resolve({ response: '<p>Concise.</p>' }),
        );

        await expect(
            Effect.runPromise(
                makeSummaryProvider(config, runner(run)).generate({
                    title: 'Private title',
                    articleText: 'Private article text',
                }),
            ),
        ).resolves.toBe('<p>Concise.</p>');

        const [model, inputs, options] = run.mock.calls[0] ?? [];
        expect(model).toBe('@cf/mistralai/mistral-small-3.1-24b-instruct');
        expect(options).toEqual({
            gateway: {
                id: 'larafeed-ai',
                skipCache: true,
            },
        });
        expect(inputs).toMatchObject({
            max_tokens: SUMMARY_MAX_OUTPUT_TOKENS,
            temperature: 0.2,
        });
        expect(SUMMARY_MAX_OUTPUT_TOKENS).toBe(512);
        const encoded = JSON.stringify(inputs);
        expect(encoded).toContain('Private title');
        expect(encoded).toContain('Private article text');
        expect(encoded).toContain(
            'Summarize the following article in 3-4 sentences.',
        );
        expect(encoded).toContain('short paragraphs using HTML <p> tags');
        expect(encoded).toContain('aggregator post or excerpt');
        expect(encoded).toContain('Use passive voice.');
        expect(encoded).not.toContain('userId');
    });

    it('performs at most one retry for transport and rate-limit failures', async () => {
        for (const firstFailure of [
            () => Promise.reject(new TypeError('network details')),
            () => Promise.reject(new Error('429 rate limit exceeded')),
            () => Promise.reject(new Error('capacity temporarily exceeded')),
        ]) {
            const run = vi
                .fn<SummaryModelRunner['run']>()
                .mockImplementationOnce(firstFailure)
                .mockResolvedValueOnce({ response: 'retried' });

            await expect(
                Effect.runPromise(
                    makeSummaryProvider(config, runner(run)).generate({
                        title: 'Title',
                        articleText: 'Article',
                    }),
                ),
            ).resolves.toBe('retried');
            expect(run).toHaveBeenCalledTimes(2);
        }
    });

    it('does not retry malformed or oversized provider responses', async () => {
        const malformed = vi.fn<SummaryModelRunner['run']>(() =>
            Promise.resolve({ unexpected: 'private provider details' }),
        );
        const error = await Effect.runPromise(
            makeSummaryProvider(config, runner(malformed)).generate({
                title: 'Title',
                articleText: 'Article',
            }),
        ).catch((cause: unknown) => cause);
        expect(error).toBeInstanceOf(SummaryProviderError);
        expect(error).toMatchObject({ kind: 'invalid_response' });
        expect(String(error)).not.toContain('private provider details');
        expect(malformed).toHaveBeenCalledTimes(1);

        const oversized = vi.fn<SummaryModelRunner['run']>(() =>
            Promise.resolve({
                response: 'x'.repeat(SUMMARY_MAX_PROVIDER_BODY_BYTES + 1),
            }),
        );
        await expect(
            Effect.runPromise(
                makeSummaryProvider(config, runner(oversized)).generate({
                    title: 'Title',
                    articleText: 'Article',
                }),
            ),
        ).rejects.toMatchObject({ kind: 'output_too_large' });
        expect(oversized).toHaveBeenCalledTimes(1);
    });

    it('never exposes provider error details in failures', async () => {
        const run = vi.fn<SummaryModelRunner['run']>(() =>
            Promise.reject(new Error('secret upstream diagnostics')),
        );
        const error = await Effect.runPromise(
            makeSummaryProvider(config, runner(run)).generate({
                title: 'Title',
                articleText: 'Article',
            }),
        ).catch((cause: unknown) => cause);
        expect(error).toBeInstanceOf(SummaryProviderError);
        expect(String(error)).not.toContain('secret upstream diagnostics');
        expect(run).toHaveBeenCalledTimes(2);
    });
});

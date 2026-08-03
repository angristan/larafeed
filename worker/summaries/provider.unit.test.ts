import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SummaryConfig } from './config';
import { SummaryProviderError } from './errors';
import {
    makeSummaryProvider,
    SUMMARY_MAX_OUTPUT_TOKENS,
    SUMMARY_MAX_PROVIDER_BODY_BYTES,
} from './provider';

const config: SummaryConfig = {
    enabled: true,
    accountId: '0123456789abcdef0123456789abcdef',
    gatewayName: 'larafeed-ai',
    model: 'gemini-2.5-flash',
    promptVersion: 'entry-summary-v1',
    apiKey: 'gemini-secret',
};
const success = (text = '<p>Concise.</p>') =>
    Response.json({
        candidates: [{ content: { parts: [{ text }] } }],
    });

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Gemini AI Gateway provider', () => {
    it('uses the explicit Gateway URL, secret header, and bounded body', async () => {
        const fetchMock = vi.fn<
            (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
        >(() => Promise.resolve(success()));
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(
                makeSummaryProvider(config).generate({
                    title: 'Private title',
                    articleText: 'Private article text',
                }),
            ),
        ).resolves.toBe('<p>Concise.</p>');

        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe(
            'https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/larafeed-ai/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent',
        );
        expect(init).toMatchObject({
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': 'gemini-secret',
                'cf-aig-collect-log': 'false',
                'cf-aig-skip-cache': 'true',
            },
        });
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
                responseMimeType: 'text/plain',
            },
        });
        expect(SUMMARY_MAX_OUTPUT_TOKENS).toBe(512);
        expect(JSON.stringify(body)).toContain('Private title');
        expect(JSON.stringify(body)).toContain('Private article text');
        expect(JSON.stringify(body)).toContain(
            'Summarize the following article in 3-4 sentences.',
        );
        expect(JSON.stringify(body)).toContain(
            'short paragraphs using HTML <p> tags',
        );
        expect(JSON.stringify(body)).toContain('aggregator post or excerpt');
        expect(JSON.stringify(body)).toContain('Use passive voice.');
        expect(JSON.stringify(body)).not.toContain('userId');
    });

    it('performs at most one retry for transport, 429, and 5xx failures', async () => {
        for (const firstFailure of [
            () => Promise.reject(new TypeError('network details')),
            () => Promise.resolve(new Response('private', { status: 429 })),
            () => Promise.resolve(new Response('private', { status: 503 })),
        ]) {
            const fetchMock = vi
                .fn<() => Promise<Response>>()
                .mockImplementationOnce(firstFailure)
                .mockResolvedValueOnce(success('retried'));
            vi.stubGlobal('fetch', fetchMock);

            await expect(
                Effect.runPromise(
                    makeSummaryProvider(config).generate({
                        title: 'Title',
                        articleText: 'Article',
                    }),
                ),
            ).resolves.toBe('retried');
            expect(fetchMock).toHaveBeenCalledTimes(2);
        }
    });

    it('does not retry rejected requests or oversized provider responses', async () => {
        const rejected = vi.fn(() =>
            Promise.resolve(
                new Response('private provider details', { status: 400 }),
            ),
        );
        vi.stubGlobal('fetch', rejected);
        const error = await Effect.runPromise(
            makeSummaryProvider(config).generate({
                title: 'Title',
                articleText: 'Article',
            }),
        ).catch((cause: unknown) => cause);
        expect(error).toBeInstanceOf(SummaryProviderError);
        expect(error).toMatchObject({ kind: 'rejected', status: 400 });
        expect(String(error)).not.toContain('private provider details');
        expect(rejected).toHaveBeenCalledTimes(1);

        const oversized = vi.fn(() =>
            Promise.resolve(
                new Response('x', {
                    headers: {
                        'Content-Length': String(
                            SUMMARY_MAX_PROVIDER_BODY_BYTES + 1,
                        ),
                    },
                }),
            ),
        );
        vi.stubGlobal('fetch', oversized);
        await expect(
            Effect.runPromise(
                makeSummaryProvider(config).generate({
                    title: 'Title',
                    articleText: 'Article',
                }),
            ),
        ).rejects.toMatchObject({ kind: 'output_too_large' });
        expect(oversized).toHaveBeenCalledTimes(1);
    });
});

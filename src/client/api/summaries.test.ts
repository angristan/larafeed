import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    generateEntrySummary,
    getEntrySummary,
    SummaryClientError,
} from './summaries';

const response = {
    summary: {
        id: 41,
        entryId: 31,
        html: '<p>Summary</p>',
        model: 'gemini-2.5-flash',
        promptVersion: 'entry-summary-v1',
        generatedAt: 1_900_000_000_000,
    },
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('SummaryClient', () => {
    it('sends an empty CSRF-protected POST and decodes the result', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(Response.json(response)));
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(generateEntrySummary(31, 'csrf-token')),
        ).resolves.toEqual(response);
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/entries/31/summary',
            expect.objectContaining({
                method: 'POST',
                body: '{}',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'csrf-token',
                }),
            }),
        );
    });

    it('maps safe API errors without accepting malformed success data', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json(
                        {
                            error: {
                                code: 'service_unavailable',
                                message: 'AI summaries are disabled',
                            },
                        },
                        { status: 503 },
                    ),
                ),
            ),
        );
        await expect(
            Effect.runPromise(getEntrySummary(31)),
        ).rejects.toMatchObject({
            kind: 'status',
            status: 503,
            code: 'service_unavailable',
        });

        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.json({ summary: 'bad' }))),
        );
        const error = await Effect.runPromise(getEntrySummary(31)).catch(
            (cause: unknown) => cause,
        );
        expect(error).toBeInstanceOf(SummaryClientError);
        expect(error).toMatchObject({ kind: 'decode', status: 200 });
    });

    it('propagates query cancellation to fetch', async () => {
        let fetchSignal: AbortSignal | undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn((_path: string, init: RequestInit) => {
                fetchSignal = init.signal as AbortSignal;
                return new Promise<Response>((_resolve, reject) => {
                    fetchSignal?.addEventListener('abort', () => {
                        reject(new DOMException('Aborted', 'AbortError'));
                    });
                });
            }),
        );
        const controller = new AbortController();
        const running = Effect.runPromise(getEntrySummary(31), {
            signal: controller.signal,
        });

        await vi.waitFor(() => expect(fetchSignal).toBeDefined());
        controller.abort();
        await running.catch(() => undefined);
        expect(fetchSignal?.aborted).toBe(true);
    });
});

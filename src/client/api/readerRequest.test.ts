import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchReaderJson, readerEntryListPath } from './readerRequest';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('readerEntryListPath', () => {
    it('serializes the full reader scope', () => {
        expect(
            readerEntryListPath({
                feedId: null,
                categoryId: 9,
                filter: 'favorites',
                orderBy: 'created_at',
                cursor: '1900000000500:40',
                pageSize: 30,
            }),
        ).toBe(
            '/api/entries?filter=favorites&order_by=created_at&page_size=30&cursor=1900000000500%3A40&category_id=9',
        );
    });
});

describe('fetchReaderJson', () => {
    it('returns successful JSON without loading a schema runtime', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(Response.json({ categories: [] })),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchReaderJson('/api/categories', new AbortController().signal),
        ).resolves.toEqual({ body: { categories: [] }, status: 200 });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/categories',
            expect.objectContaining({
                credentials: 'same-origin',
                method: 'GET',
            }),
        );
    });

    it('preserves API status and safe messages', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json(
                        { error: { message: 'Sign in again.' } },
                        { status: 401 },
                    ),
                ),
            ),
        );

        await expect(
            fetchReaderJson('/api/categories', new AbortController().signal),
        ).rejects.toMatchObject({
            kind: 'status',
            status: 401,
            message: 'Sign in again.',
        });
    });

    it('propagates cancellation to fetch', async () => {
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
        const request = fetchReaderJson('/api/categories', controller.signal);
        controller.abort();

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchSignal?.aborted).toBe(true);
    });
});

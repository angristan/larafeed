import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listEntries, ReaderClientError, setEntryRead } from './reader';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ReaderClient', () => {
    it('sends every list input and decodes the page', async () => {
        const fetchMock = vi.fn((_path: string, _init: RequestInit) =>
            Promise.resolve(
                Response.json({
                    entries: [],
                    total: 0,
                    nextCursor: '1900000000000:12',
                }),
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(
                listEntries({
                    feedId: null,
                    categoryId: 9,
                    filter: 'favorites',
                    orderBy: 'created_at',
                    cursor: '1900000000500:40',
                    pageSize: 30,
                }),
            ),
        ).resolves.toMatchObject({
            total: 0,
            nextCursor: '1900000000000:12',
        });

        const requestUrl = fetchMock.mock.calls[0]?.[0];
        expect(requestUrl).toBe(
            '/api/entries?filter=favorites&order_by=created_at&page_size=30&cursor=1900000000500%3A40&category_id=9',
        );
        expect(fetchMock).toHaveBeenCalledWith(
            requestUrl,
            expect.objectContaining({
                credentials: 'same-origin',
                method: 'GET',
            }),
        );
    });

    it('uses PUT, CSRF, and desired state for interaction mutations', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(
                Response.json({
                    entryId: 42,
                    feedId: 3,
                    read: true,
                    readChangedAt: 1_900_000_000_000,
                    starred: false,
                    starredAt: null,
                    archived: false,
                    archivedAt: null,
                }),
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(
                setEntryRead({
                    entryId: 42,
                    read: true,
                    csrfToken: 'csrf-token',
                }),
            ),
        ).resolves.toMatchObject({ entryId: 42, read: true });

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/entries/42/read',
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ read: true }),
                headers: expect.objectContaining({
                    'X-CSRF-Token': 'csrf-token',
                }),
            }),
        );
    });

    it('rejects a successful response with an invalid reader schema', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json({ entries: 'invalid', total: 0 }),
                ),
            ),
        );

        const error = await Effect.runPromise(
            listEntries({
                feedId: null,
                categoryId: null,
                filter: 'unread',
                orderBy: 'published_at',
                cursor: null,
                pageSize: 30,
            }),
        ).catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(ReaderClientError);
        expect(error).toMatchObject({ kind: 'decode', status: 200 });
    });

    it('propagates host cancellation to the fetch signal', async () => {
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
        const running = Effect.runPromise(
            listEntries({
                feedId: 2,
                categoryId: null,
                filter: 'all',
                orderBy: 'published_at',
                cursor: null,
                pageSize: 30,
            }),
            { signal: controller.signal },
        );

        await vi.waitFor(() => expect(fetchSignal).toBeDefined());
        controller.abort();
        await running.catch(() => undefined);

        expect(fetchSignal?.aborted).toBe(true);
    });
});

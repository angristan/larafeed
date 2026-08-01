import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpmlImport, listOpmlImports, OpmlClientError } from './opml';

const importResponse = {
    id: 7,
    state: 'processing',
    filename: 'feeds.opml',
    totalItems: 2,
    succeededItems: 1,
    failedItems: 0,
    skippedItems: 0,
    startedAt: 1_900_000_000_000,
    completedAt: null,
    createdAt: 1_900_000_000_000,
    updatedAt: 1_900_000_000_001,
    errors: [],
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('OpmlClient', () => {
    it('uploads JSON with CSRF and decodes durable progress', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(Response.json(importResponse, { status: 202 })),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(
                createOpmlImport({
                    opml: '<opml version="2.0"><body /></opml>',
                    filename: 'feeds.opml',
                    csrfToken: 'csrf-token',
                }),
            ),
        ).resolves.toMatchObject({ id: 7, state: 'processing' });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/opml/imports',
            expect.objectContaining({
                method: 'POST',
                credentials: 'same-origin',
                body: JSON.stringify({
                    opml: '<opml version="2.0"><body /></opml>',
                    filename: 'feeds.opml',
                }),
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'csrf-token',
                }),
            }),
        );
    });

    it('decodes the recent import list', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(Response.json({ imports: [importResponse] })),
            ),
        );

        await expect(
            Effect.runPromise(listOpmlImports()),
        ).resolves.toMatchObject({ imports: [{ id: 7 }] });
    });

    it('rejects malformed successful responses', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.json({ imports: 'bad' }))),
        );

        const error = await Effect.runPromise(listOpmlImports()).catch(
            (cause: unknown) => cause,
        );
        expect(error).toBeInstanceOf(OpmlClientError);
        expect(error).toMatchObject({ kind: 'decode', status: 200 });
    });
});

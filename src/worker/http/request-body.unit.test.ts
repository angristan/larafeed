import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
    type RequestBodyError,
    readBoundedJsonBody,
    readBoundedRequestBody,
    readBoundedTextBody,
} from './request-body';

const run = <A>(effect: Effect.Effect<A, RequestBodyError>) =>
    Effect.runPromise(effect);

describe('bounded request body reader', () => {
    it('reads valid UTF-8 and JSON within the byte limit', async () => {
        const source = JSON.stringify({ label: 'café' });
        const request = new Request('https://example.test/api', {
            method: 'POST',
            body: source,
        });

        await expect(
            run(
                readBoundedJsonBody(
                    request,
                    new TextEncoder().encode(source).byteLength,
                ),
            ),
        ).resolves.toEqual({ label: 'café' });
    });

    it('rejects oversized Content-Length before reading the stream', async () => {
        const request = new Request('https://example.test/api', {
            method: 'POST',
            headers: { 'content-length': '65' },
            body: new ReadableStream<Uint8Array>(),
            duplex: 'half',
        } as RequestInit & { duplex: 'half' });
        if (request.body === null) throw new Error('Missing test body');
        const getReader = vi.spyOn(request.body, 'getReader');

        await expect(run(readBoundedRequestBody(request, 64))).rejects.toEqual(
            expect.objectContaining({
                _tag: 'RequestBodyError',
                reason: 'too_large',
            }),
        );
        expect(getReader).not.toHaveBeenCalled();
    });

    it('rejects malformed lengths, UTF-8, and JSON as typed failures', async () => {
        const invalidLength = new Request('https://example.test/api', {
            method: 'POST',
            headers: { 'content-length': '-1' },
            body: '{}',
        });
        await expect(
            run(readBoundedRequestBody(invalidLength, 64)),
        ).rejects.toMatchObject({ reason: 'invalid_content_length' });

        const invalidUtf8 = new Request('https://example.test/api', {
            method: 'POST',
            body: new Uint8Array([0xc3, 0x28]),
        });
        await expect(
            run(readBoundedTextBody(invalidUtf8, 64)),
        ).rejects.toMatchObject({ reason: 'invalid_utf8' });

        const invalidJson = new Request('https://example.test/api', {
            method: 'POST',
            body: '{',
        });
        await expect(
            run(readBoundedJsonBody(invalidJson, 64)),
        ).rejects.toMatchObject({ reason: 'invalid_json' });
    });
});

import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { readBoundedRequestBody } from './request-body';

describe('bounded request body reader in Workerd', () => {
    it('cancels chunked input as soon as it exceeds the byte limit', async () => {
        const cancel = vi.fn();
        const request = new Request('https://example.test/api', {
            method: 'POST',
            body: new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    controller.enqueue(new Uint8Array([4, 5, 6]));
                },
                cancel,
            }),
        });

        await expect(
            Effect.runPromise(readBoundedRequestBody(request, 4)),
        ).rejects.toMatchObject({
            _tag: 'RequestBodyError',
            reason: 'too_large',
        });
        expect(cancel).toHaveBeenCalledOnce();
    });
});

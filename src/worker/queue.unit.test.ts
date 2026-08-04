import { describe, expect, it, vi } from 'vitest';

import { singleQueueMessage } from './queue';

const batch = (messages: readonly Message<unknown>[]) => {
    const retryAll = vi.fn();
    return {
        value: {
            queue: 'test',
            messages,
            ackAll: vi.fn(),
            retryAll,
        } as unknown as MessageBatch<unknown>,
        retryAll,
    };
};

describe('single Queue invocation guard', () => {
    it('returns the only message', () => {
        const message = { id: 'one' } as Message<unknown>;
        const input = batch([message]);
        expect(singleQueueMessage(input.value)).toBe(message);
        expect(input.retryAll).not.toHaveBeenCalled();
    });

    it('retries empty and multi-message batches without processing them', () => {
        for (const messages of [
            [],
            [
                { id: 'one' } as Message<unknown>,
                { id: 'two' } as Message<unknown>,
            ],
        ]) {
            const input = batch(messages);
            expect(singleQueueMessage(input.value)).toBeNull();
            expect(input.retryAll).toHaveBeenCalledWith({ delaySeconds: 1 });
        }
    });
});

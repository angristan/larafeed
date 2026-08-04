import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

import worker from './index';

describe('Queue routing', () => {
    it.each([
        'foreign-feed-refresh',
        'larafeed-test-feed-refresh-dlq',
    ])('rejects unknown or retired Queue name %s', async (queue) => {
        const message = {
            id: 'unknown-message',
            timestamp: new Date(),
            body: { operationId: 'unknown-operation' },
            attempts: 1,
            ack: vi.fn(),
            retry: vi.fn(),
        } as unknown as Message<unknown>;
        const batch = {
            queue,
            messages: [message],
            ackAll: vi.fn(),
            retryAll: vi.fn(),
        } as unknown as MessageBatch<
            | { readonly operationId: string }
            | { readonly operationId: string }
            | { readonly operationId: string }
        >;

        await expect(
            worker.queue(batch, {
                ...env,
                AUTH_ENVIRONMENT: 'test',
            }),
        ).rejects.toThrow('Unknown Queue binding');
        expect(message.ack).not.toHaveBeenCalled();
    });
});

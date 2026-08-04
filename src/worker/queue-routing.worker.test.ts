import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

import worker from './index';

const batch = (queue: string) => {
    const message = {
        id: 'unknown-message',
        timestamp: new Date(),
        body: { operationId: 'unknown-operation' },
        attempts: 1,
        ack: vi.fn(),
        retry: vi.fn(),
    } as unknown as Message<unknown>;

    return {
        message,
        batch: {
            queue,
            messages: [message],
            ackAll: vi.fn(),
            retryAll: vi.fn(),
        } as unknown as MessageBatch<{ readonly operationId: string }>,
    };
};

describe('Queue routing', () => {
    it.each([
        'foreign-feed-refresh',
        'larafeed-test-feed-refresh-dlq',
    ])('rejects unknown or retired Queue name %s', async (queue) => {
        const item = batch(queue);

        await expect(worker.queue(item.batch, env)).rejects.toThrow(
            'Unknown Queue binding',
        );
        expect(item.message.ack).not.toHaveBeenCalled();
    });

    it('rejects duplicate configured Queue names before dispatch', async () => {
        const duplicate = 'larafeed-duplicate';
        const item = batch(duplicate);

        await expect(
            worker.queue(item.batch, {
                ...env,
                FEED_REFRESH_QUEUE_NAME: duplicate,
                OPML_IMPORT_QUEUE_NAME: duplicate,
                FAVICON_REFRESH_QUEUE_NAME: 'larafeed-favicon-refresh',
            }),
        ).rejects.toThrow('Invalid Queue configuration');
        expect(item.message.ack).not.toHaveBeenCalled();
    });
});

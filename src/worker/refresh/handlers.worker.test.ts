import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

import { handleRefreshCron, handleRefreshQueue } from './handlers';

const message = (body: unknown) => {
    const ack = vi.fn();
    const retry = vi.fn();
    return {
        value: {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            body,
            attempts: 1,
            ack,
            retry,
        } as unknown as Message<{ operationId: string }>,
        ack,
        retry,
    };
};

describe('refresh host handlers', () => {
    it('acknowledges an invalid queue payload without replaying it', async () => {
        const item = message({ unexpected: true });

        await handleRefreshQueue(
            {
                queue: 'larafeed-test-feed-refresh',
                messages: [item.value],
                ackAll: vi.fn(),
                retryAll: vi.fn(),
            } as unknown as MessageBatch<{ operationId: string }>,
            env,
        );

        expect(item.ack).toHaveBeenCalledOnce();
        expect(item.retry).not.toHaveBeenCalled();
    });

    it('runs an empty scheduled maintenance pass', async () => {
        await expect(
            handleRefreshCron(
                {
                    scheduledTime: Date.now(),
                    cron: '*/10 * * * *',
                    type: 'scheduled',
                    noRetry: vi.fn(),
                } as unknown as ScheduledController,
                env,
            ),
        ).resolves.toBeUndefined();
    });
});

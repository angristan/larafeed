import { describe, expect, it, vi } from 'vitest';

import { operationNames, traceOperation } from './observability';

describe('native operation tracing', () => {
    it('returns the operation result', async () => {
        await expect(
            traceOperation(
                operationNames.refreshQueue,
                'queue',
                { batchSize: 2, deadLetter: false },
                async () => 'done',
            ),
        ).resolves.toBe('done');
    });

    it('logs one bounded event and preserves failures', async () => {
        const log = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const failure = new Error('private upstream details');

        await expect(
            traceOperation(
                operationNames.opmlCron,
                'scheduled',
                {},
                async () => {
                    throw failure;
                },
            ),
        ).rejects.toBe(failure);

        expect(log).toHaveBeenCalledWith({
            event: 'app.operation.failed',
            operation: operationNames.opmlCron,
            trigger: 'scheduled',
        });
        expect(JSON.stringify(log.mock.calls)).not.toContain(failure.message);
        log.mockRestore();
    });
});

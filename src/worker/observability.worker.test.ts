import { describe, expect, it, vi } from 'vitest';

import {
    operationNames,
    recordHandledFailure,
    recordQueueDecision,
    spanNames,
    traceOperation,
} from './observability';

describe('native operation tracing', () => {
    it('returns the operation result', async () => {
        await expect(
            traceOperation(
                operationNames.refreshQueue,
                'queue',
                { batchSize: 1 },
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
            outcome: 'failed',
            'app.trigger': 'scheduled',
            'app.failure.class': 'Error',
        });
        expect(JSON.stringify(log.mock.calls)).not.toContain(failure.message);
        log.mockRestore();
    });

    it('records handled failures and Queue retries without raw errors', () => {
        const error = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const warn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);

        recordHandledFailure(
            spanNames.faviconAssetPersist,
            {
                'app.feed.id': 17,
                'app.private': 'https://private.example/token?secret=yes',
                'app.unbounded': 'x'.repeat(129),
            },
            {
                errorClass: 'FaviconAssetCandidateError',
                stage: 'transform',
                retryable: true,
            },
        );
        recordQueueDecision('favicon', {
            action: 'retry',
            reason: 'retryable_failure',
            retryDelaySeconds: 30,
        });

        expect(error).toHaveBeenCalledWith({
            event: 'app.operation.failed',
            operation: spanNames.faviconAssetPersist,
            outcome: 'failed',
            'app.feed.id': 17,
            'app.failure.class': 'FaviconAssetCandidateError',
            'app.failure.stage': 'transform',
            'app.failure.retryable': true,
        });
        expect(warn).toHaveBeenCalledWith({
            event: 'app.queue.decision',
            'app.subsystem': 'favicon',
            'app.queue.action': 'retry',
            'app.queue.reason': 'retryable_failure',
            'app.queue.retry_delay_seconds': 30,
        });
        const recorded = JSON.stringify([error.mock.calls, warn.mock.calls]);
        expect(recorded).not.toContain('private');
        expect(recorded).not.toContain('secret');
        expect(recorded).not.toContain('x'.repeat(129));
        error.mockRestore();
        warn.mockRestore();
    });
});

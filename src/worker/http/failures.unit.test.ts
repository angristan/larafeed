import { Cause, Effect } from 'effect';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { recoverHttpCause } from './failures';

const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);

afterEach(() => {
    consoleError.mockClear();
});
afterAll(() => {
    consoleError.mockRestore();
});

describe('HTTP failure recovery', () => {
    it('records only bounded failure metadata once', async () => {
        const failure = Object.assign(new Error('private database token'), {
            _tag: 'StorageError',
            cause: 'secret',
        });

        const response = await Effect.runPromise(
            recoverHttpCause(Cause.fail(failure), () =>
                Response.json({ error: 'safe' }, { status: 503 }),
            ),
        );

        expect(response.status).toBe(503);
        expect(consoleError).toHaveBeenCalledOnce();
        expect(consoleError).toHaveBeenCalledWith({
            event: 'app.operation.failed',
            operation: 'app.http.failure',
            outcome: 'failed',
            'app.failure.kind': 'typed_failure',
            'app.failure.tags': 'StorageError',
            'app.failure.reason_count': 1,
            'app.failure.class': 'StorageError',
            'app.failure.stage': 'response',
        });
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret');
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain('token');
    });

    it('does not report expected 4xx failures', async () => {
        const response = await Effect.runPromise(
            recoverHttpCause(
                Cause.fail(new Error('invalid input')),
                () => new Response(null, { status: 400 }),
            ),
        );

        expect(response.status).toBe(400);
        expect(consoleError).not.toHaveBeenCalled();
    });

    it('does not report expected feature disablement', async () => {
        const disabled = Object.assign(new Error('disabled'), {
            _tag: 'SummaryFeatureDisabled',
        });
        const response = await Effect.runPromise(
            recoverHttpCause(
                Cause.fail(disabled),
                () => new Response(null, { status: 503 }),
            ),
        );

        expect(response.status).toBe(503);
        expect(consoleError).not.toHaveBeenCalled();
    });

    it('preserves interruption without reporting it', async () => {
        await expect(
            Effect.runPromise(
                recoverHttpCause(
                    Cause.interrupt(),
                    () => new Response(null, { status: 500 }),
                ),
            ),
        ).rejects.toBeDefined();
        expect(consoleError).not.toHaveBeenCalled();
    });
});

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HealthResponse } from '../shared/http';
import { createApp, HealthCheckUnavailable } from './app';

describe('Worker HTTP app', () => {
    it('returns the schema-encoded health response', async () => {
        const response = await createApp().request('/api/health');

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toContain(
            'application/json',
        );
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
    });

    it('maps tagged health failures to a safe response', async () => {
        const app = createApp({
            healthCheck: () => Effect.fail(new HealthCheckUnavailable({})),
        });

        const response = await app.request('/api/health');

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
            error: {
                code: 'service_unavailable',
                message: 'Service unavailable',
            },
        });
    });

    it('does not expose unexpected defects', async () => {
        const app = createApp({
            healthCheck: () => Effect.die(new Error('private failure detail')),
        });

        const response = await app.request('/api/health');
        const body = await response.text();

        expect(response.status).toBe(500);
        expect(body).toBe(
            '{"error":{"code":"internal_server_error","message":"Internal server error"}}',
        );
        expect(body).not.toContain('private failure detail');
    });

    it('propagates the request AbortSignal to the Effect program', async () => {
        const abortController = new AbortController();
        let markStarted: () => void = () => undefined;
        let interrupted = false;
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const app = createApp({
            healthCheck: () =>
                Effect.callback<HealthResponse>(() => {
                    markStarted();

                    return Effect.sync(() => {
                        interrupted = true;
                    });
                }),
        });
        const request = new Request('https://example.test/api/health', {
            signal: abortController.signal,
        });

        const responsePromise = app.request(request);
        await started;
        abortController.abort();
        await responsePromise;

        expect(interrupted).toBe(true);
    });
});

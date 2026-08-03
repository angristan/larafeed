import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { HealthResponse } from '../shared/http';
import { createApp, HealthCheckUnavailable } from './app';

describe('Worker HTTP app', () => {
    it('preserves the public plain-text liveness endpoint', async () => {
        const response = await createApp().request('/up');

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe(
            'text/plain; charset=utf-8',
        );
        await expect(response.text()).resolves.toBe('OK');
    });

    it('returns the schema-encoded health response', async () => {
        const response = await createApp({
            healthCheck: () =>
                Effect.succeed(HealthResponse.make({ status: 'ok' })),
        }).request('/api/health');

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toContain(
            'application/json',
        );
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
    });

    it('fails readiness when D1 is unavailable', async () => {
        const response = await createApp().request(
            '/api/health',
            undefined,
            {} as Env,
        );

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
            error: {
                code: 'service_unavailable',
                message: 'Service unavailable',
            },
        });
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

    it('rejects rate-limited authentication ceremonies before route work', async () => {
        const limit = vi.fn(() => Promise.resolve({ success: false }));
        const response = await createApp().request(
            '/api/auth/authentication/options',
            {
                method: 'POST',
                headers: { 'CF-Connecting-IP': '203.0.113.10' },
            },
            { AUTH_RATE_LIMITER: { limit } } as unknown as Env,
        );

        expect(limit).toHaveBeenCalledWith({ key: '203.0.113.10' });
        expect(response.status).toBe(429);
        expect(response.headers.get('cache-control')).toBe('no-store');
        await expect(response.json()).resolves.toEqual({
            error: {
                code: 'rate_limited',
                message: 'Too many requests',
            },
        });
    });

    it('fails closed when the rate-limit binding is unavailable', async () => {
        const response = await createApp().request(
            '/api/auth/operator/access-link',
            { method: 'POST' },
            {
                AUTH_RATE_LIMITER: {
                    limit: () => Promise.reject(new Error('private failure')),
                },
            } as unknown as Env,
        );

        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain('private failure');
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

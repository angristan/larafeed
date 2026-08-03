import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Worker integration', () => {
    it('serves the public liveness endpoint through the Worker entrypoint', async () => {
        const response = await SELF.fetch('https://example.test/up');

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe(
            'text/plain; charset=utf-8',
        );
        await expect(response.text()).resolves.toBe('OK');
    });

    it('serves the health endpoint through the Worker entrypoint', async () => {
        const response = await SELF.fetch('https://example.test/api/health');

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
    });

    it('serves isolated public authentication configuration', async () => {
        const response = await SELF.fetch(
            'https://larafeed-test.stanislas.cloud/api/auth/config',
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        await expect(response.json()).resolves.toEqual({
            turnstileSiteKey: '1x00000000000000000000AA',
        });
    });

    it('protects registered reader API routes', async () => {
        const response = await SELF.fetch(
            'https://larafeed-test.stanislas.cloud/api/categories',
        );

        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('no-store');
        await expect(response.json()).resolves.toEqual({
            error: {
                code: 'unauthenticated',
                message: 'Authentication required',
            },
        });
    });

    it('registers protected summary and fixed image routes', async () => {
        const summary = await SELF.fetch(
            'https://larafeed-test.stanislas.cloud/api/entries/1/summary',
        );
        expect(summary.status).toBe(401);
        expect(summary.headers.get('cache-control')).toBe('no-store');

        const arbitraryImage = await SELF.fetch(
            'https://larafeed-test.stanislas.cloud/api/images/feeds/1/arbitrary',
        );
        expect(arbitraryImage.status).toBe(404);
        expect(arbitraryImage.headers.get('cache-control')).toBe(
            'private, no-store',
        );
    });

    it('serves protocol-specific compatibility failures', async () => {
        const login = await SELF.fetch(
            'https://larafeed-test.stanislas.cloud/api/reader/accounts/ClientLogin',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    Email: 'missing-user',
                    Passwd: 'invalid-app-token',
                }),
            },
        );
        expect(login.status).toBe(403);
        expect(await login.text()).toBe('Error=BadAuthentication\n');
        expect(login.headers.get('cache-control')).toBe('no-store');

        const fever = await SELF.fetch(
            'https://larafeed-test.stanislas.cloud/api/fever/?feeds',
        );
        expect(fever.status).toBe(200);
        await expect(fever.json()).resolves.toEqual({
            api_version: 3,
            auth: 0,
        });
        expect(fever.headers.get('cache-control')).toBe('no-store');
    });

    it('protects OPML progress and export routes', async () => {
        for (const path of ['/api/opml/imports', '/api/opml/export']) {
            const response = await SELF.fetch(
                `https://larafeed-test.stanislas.cloud${path}`,
            );
            expect(response.status).toBe(401);
            expect(response.headers.get('cache-control')).toBe('no-store');
        }
    });

    it('protects manual feed refresh commands', async () => {
        const response = await SELF.fetch(
            'https://larafeed-test.stanislas.cloud/api/feeds/1/refresh',
            {
                method: 'POST',
                headers: {
                    Origin: 'https://larafeed-test.stanislas.cloud',
                    'Content-Type': 'application/json',
                },
                body: '{}',
            },
        );

        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('does not route unknown API requests to SPA assets', async () => {
        const response = await SELF.fetch('https://example.test/api/unknown');

        expect(response.status).toBe(404);
    });
});

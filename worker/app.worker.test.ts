import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Worker integration', () => {
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

    it('does not route unknown API requests to SPA assets', async () => {
        const response = await SELF.fetch('https://example.test/api/unknown');

        expect(response.status).toBe(404);
    });
});

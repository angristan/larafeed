import { fileURLToPath, URL } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: {
                configPath: './wrangler.jsonc',
                environment: 'test',
            },
        }),
    ],
    resolve: {
        alias: {
            '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
        },
    },
    test: {
        include: ['worker/**/*.worker.test.ts'],
    },
});

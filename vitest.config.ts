import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./resources/js', import.meta.url)),
            '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
        },
    },
    test: {
        include: [
            'shared/**/*.test.ts',
            'worker/**/*.unit.test.ts',
            'resources/js/cloudflare/**/*.test.ts',
            'resources/js/cloudflare/**/*.test.tsx',
        ],
    },
});

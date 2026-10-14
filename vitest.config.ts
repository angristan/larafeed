import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

import { mcpAppView } from './scripts/mcp-app-view-plugin';

export default defineConfig({
    plugins: [mcpAppView()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src/client', import.meta.url)),
            '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
            'cloudflare:workers': fileURLToPath(
                new URL(
                    './src/worker/test/cloudflare-workers.unit.ts',
                    import.meta.url,
                ),
            ),
        },
    },
    test: {
        // Reuse workers across test files instead of re-importing the module
        // graph for every file (about 4x faster). Files must not leak global
        // state; shuffled file orders (`--sequence.shuffle.files`) pass.
        isolate: false,
        server: {
            deps: {
                // Imports `cloudflare:workers`. Inlining routes it through
                // the alias above instead of Node's ESM loader.
                inline: ['@cloudflare/workers-oauth-provider'],
            },
        },
        include: [
            'src/client/**/*.test.ts',
            'src/client/**/*.test.tsx',
            'src/shared/**/*.test.ts',
            'src/worker/**/*.unit.test.ts',
            'validation/**/*.unit.test.ts',
            'scripts/**/*.test.ts',
        ],
    },
});

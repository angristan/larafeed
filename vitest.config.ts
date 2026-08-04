import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src/client', import.meta.url)),
            '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        },
    },
    test: {
        include: [
            'src/client/**/*.test.ts',
            'src/client/**/*.test.tsx',
            'src/shared/**/*.test.ts',
            'src/worker/**/*.unit.test.ts',
            'validation/**/*.unit.test.ts',
        ],
    },
});

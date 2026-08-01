import { fileURLToPath, URL } from 'node:url';
import {
    cloudflareTest,
    readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const migrationsPath = fileURLToPath(new URL('./migrations', import.meta.url));

export default defineConfig({
    plugins: [
        cloudflareTest(async () => ({
            miniflare: {
                bindings: {
                    TEST_MIGRATIONS: await readD1Migrations(migrationsPath),
                },
            },
            wrangler: {
                configPath: './wrangler.jsonc',
                environment: 'test',
            },
        })),
    ],
    resolve: {
        alias: {
            '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
        },
    },
    test: {
        include: ['worker/**/*.worker.test.ts'],
        setupFiles: ['./worker/test/apply-migrations.ts'],
    },
});

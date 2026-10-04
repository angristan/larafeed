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
                    TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
                    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
                    AUTH_OPERATOR_SECRET: 'workerd-test-operator-secret',
                    D1_VALIDATION_PROFILE:
                        process.env.LARAFEED_D1_FIXTURE_PROFILE === 'large'
                            ? 'large'
                            : 'ci',
                },
            },
            wrangler: {
                configPath: './wrangler.jsonc',
                environment: 'vitest',
            },
        })),
    ],
    resolve: {
        alias: {
            '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        },
    },
    test: {
        include: [
            'src/worker/**/*.worker.test.ts',
            'validation/**/*.worker.test.ts',
        ],
        // Reuse each workerd runtime across test files. Booting a runtime and
        // loading the Worker module graph per file made this suite ~5x slower.
        // The setup file rebuilds D1 before every file to keep files isolated.
        // Reuse only happens when files outnumber workers, so cap the pool:
        // two runtimes were fastest on a 4-CPU machine like the CI runners.
        isolate: false,
        maxWorkers: 2,
        setupFiles: ['./src/worker/test/apply-migrations.ts'],
    },
});

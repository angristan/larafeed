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

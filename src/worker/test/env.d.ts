import type { D1Migration } from '@cloudflare/vitest-pool-workers';

declare global {
    namespace Cloudflare {
        interface Env {
            readonly TEST_MIGRATIONS: D1Migration[];
            readonly D1_VALIDATION_PROFILE: 'ci' | 'large';
        }
    }
}

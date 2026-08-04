import { describe, expect, it } from 'vitest';

import {
    FAVICON_CRON_LIMIT,
    FAVICON_ORPHAN_CLEANUP_LIMIT,
    FAVICON_ORPHAN_RETENTION_MS,
    faviconRefreshEnabled,
} from './cron';

describe('favicon rollout control', () => {
    it('keeps recovery bounded while draining more than one feed', () => {
        expect(FAVICON_CRON_LIMIT).toBe(20);
        expect(FAVICON_ORPHAN_CLEANUP_LIMIT).toBe(100);
        expect(FAVICON_ORPHAN_RETENTION_MS).toBe(30 * 24 * 60 * 60_000);
    });

    it('enables maintenance only for the exact true value', () => {
        expect(faviconRefreshEnabled({ FAVICON_REFRESH_ENABLED: 'true' })).toBe(
            true,
        );
        for (const value of ['false', 'TRUE', '1', '']) {
            expect(
                faviconRefreshEnabled({
                    FAVICON_REFRESH_ENABLED: value,
                }),
            ).toBe(false);
        }
    });
});

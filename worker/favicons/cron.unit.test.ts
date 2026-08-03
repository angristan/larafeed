import { describe, expect, it } from 'vitest';

import { faviconRefreshEnabled } from './cron';

describe('favicon rollout control', () => {
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

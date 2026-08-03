import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';

const LEGACY_FAVICON_SHA256 =
    'f4c3c970f6926f4ca48069891b4b33bf9216c4a2ec80756336d2e544b181b92e';

test('serves the original Larafeed favicon', async ({ page, request }) => {
    await page.goto('/login');

    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
        'href',
        '/favicon.ico',
    );

    const response = await request.get('/favicon.ico');
    expect(response.ok()).toBe(true);
    expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(
        LEGACY_FAVICON_SHA256,
    );
});

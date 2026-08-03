import { expect, type Page, test } from '@playwright/test';

const now = Date.parse('2026-07-18T12:00:00.000Z');
const user = {
    id: 1,
    username: 'reader',
    displayName: 'Reader',
    isAdmin: false,
};
const account = {
    ...user,
    email: 'reader@example.test',
    createdAt: now - 86_400_000,
};
const passkeys = {
    passkeys: [
        {
            id: 31,
            name: 'Primary passkey',
            transports: ['internal'],
            backedUp: true,
            createdAt: now - 86_400_000,
            lastUsedAt: now - 60_000,
        },
    ],
};
const emptyImport = {
    id: 71,
    state: 'pending',
    filename: 'subscriptions.opml',
    totalItems: 0,
    succeededItems: 0,
    failedItems: 0,
    skippedItems: 0,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    errors: [],
};
const processingImport = {
    ...emptyImport,
    state: 'processing',
    totalItems: 3,
    succeededItems: 1,
    startedAt: now,
    updatedAt: now + 1_000,
};

const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json; charset=UTF-8',
    body: JSON.stringify(body),
});

async function setAuthenticatedBrowser(page: Page): Promise<void> {
    await page.addInitScript(() => {
        document.cookie = 'larafeed-test-csrf=opml-csrf; path=/; SameSite=Lax';
    });
}

test('uploads OPML with CSRF, shows progress, and downloads the export', async ({
    page,
}) => {
    const opml =
        '<?xml version="1.0"?><opml version="2.0"><body><outline text="Example" xmlUrl="https://publisher.example.test/feed.xml"/></body></opml>';
    let importStarted = false;
    let listRequests = 0;
    let postedImport: unknown;
    let postedCsrf: string | null = null;

    await setAuthenticatedBrowser(page);
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());

        if (pathname === '/api/auth/session') {
            await route.fulfill(
                json({
                    authenticated: true,
                    user,
                    expiresAt: now + 86_400_000,
                }),
            );
            return;
        }
        if (pathname === '/api/opml/imports' && request.method() === 'GET') {
            listRequests += 1;
            await route.fulfill(
                json({ imports: importStarted ? [processingImport] : [] }),
            );
            return;
        }
        if (pathname === '/api/opml/imports' && request.method() === 'POST') {
            postedImport = request.postDataJSON();
            postedCsrf = await request.headerValue('x-csrf-token');
            importStarted = true;
            await route.fulfill(json(emptyImport));
            return;
        }
        await route.fulfill({
            status: 404,
            contentType: 'application/json; charset=UTF-8',
            body: JSON.stringify({
                error: {
                    code: 'not_found',
                    message: `Unmocked ${request.method()} ${pathname}`,
                },
            }),
        });
    });

    await page.goto('/settings/opml');
    await expect(page).toHaveTitle('Import & export - Larafeed');
    await page.locator('input[type="file"]').setInputFiles({
        name: 'subscriptions.opml',
        mimeType: 'application/xml',
        buffer: Buffer.from(opml),
    });
    await page.getByRole('button', { name: 'Import subscriptions' }).click();

    await expect(
        page.getByRole('status').filter({ hasText: 'Import started' }),
    ).toContainText('Larafeed is processing import #71.');
    await expect(page.getByText('subscriptions.opml')).toBeVisible();
    await expect(page.getByLabel('1 of 3 feeds processed')).toBeVisible();
    expect(postedImport).toEqual({
        opml,
        filename: 'subscriptions.opml',
    });
    expect(postedCsrf).toBe('opml-csrf');
    expect(listRequests).toBeGreaterThanOrEqual(2);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download OPML' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('feeds.opml');
    expect(new URL(download.url()).pathname).toBe('/api/opml/export');
});

test('preserves legacy settings deep links and page-specific titles', async ({
    page,
}) => {
    await setAuthenticatedBrowser(page);
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());

        if (pathname === '/api/auth/session') {
            await route.fulfill(
                json({
                    authenticated: true,
                    user,
                    expiresAt: now + 86_400_000,
                }),
            );
            return;
        }
        if (pathname === '/api/account') {
            await route.fulfill(json(account));
            return;
        }
        if (pathname === '/api/auth/passkeys') {
            await route.fulfill(json(passkeys));
            return;
        }
        if (pathname === '/api/auth/config') {
            await route.fulfill(json({ turnstileSiteKey: 'test-site-key' }));
            return;
        }
        if (pathname === '/api/opml/imports') {
            await route.fulfill(json({ imports: [] }));
            return;
        }

        await route.fulfill({
            status: 404,
            contentType: 'application/json; charset=UTF-8',
            body: JSON.stringify({
                error: { code: 'not_found', message: `Unmocked ${pathname}` },
            }),
        });
    });

    await page.goto('/profile?section=profile&source=legacy');
    await expect(page).toHaveURL(
        /\/settings\/security\?source=legacy#profile$/u,
    );
    await expect(page).toHaveTitle('Settings - Larafeed');
    await expect(
        page.getByRole('heading', { name: 'Profile settings' }),
    ).toBeVisible();

    await page.goto('/profile?section=security&source=legacy');
    await expect(page).toHaveURL(
        /\/settings\/security\?source=legacy#security$/u,
    );
    await expect(page).toHaveTitle('Settings - Larafeed');
    await expect(
        page.getByRole('heading', { name: 'Security', exact: true }),
    ).toBeVisible();

    await page.goto('/profile?section=opml&source=legacy#history');
    await expect(page).toHaveURL(/\/settings\/opml\?source=legacy#history$/u);
    await expect(page).toHaveTitle('Import & export - Larafeed');
    await expect(
        page.getByRole('heading', { name: 'Import & export', exact: true }),
    ).toBeVisible();

    await page.goto('/missing-page');
    await expect(page).toHaveTitle('Page not found - Larafeed');
    await expect(
        page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
});

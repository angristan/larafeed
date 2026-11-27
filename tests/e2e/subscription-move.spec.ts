import { expect, test } from '@playwright/test';

const now = Date.parse('2026-07-18T12:00:00.000Z');
const user = {
    id: 1,
    username: 'reader',
    displayName: 'Reader',
    isAdmin: false,
};
const oldSubscription = {
    feedId: 7,
    categoryId: 3,
    categoryName: 'Technology',
    feedName: 'Example blog',
    customFeedName: null,
    feedUrl: 'https://example.test/old.xml',
    siteUrl: 'https://example.test/',
    faviconUrl: null,
    faviconIsDark: null,
    entryCount: 4,
    unreadCount: 1,
    isGone: false,
    movedToUrl: 'https://example.test/feed.xml',
    consecutiveFailures: 3,
    lastAttemptAt: now - 60_000,
    lastSuccessfulRefreshAt: now - 86_400_000,
    lastFailedRefreshAt: now - 60_000,
    lastErrorClass: 'FeedHttpError',
    lastErrorMessage: 'Feed returned HTTP 404',
    filterRules: { excludeTitle: [], excludeContent: [], excludeAuthor: [] },
    refreshes: [],
};
const newSubscription = {
    ...oldSubscription,
    feedId: 8,
    feedUrl: 'https://example.test/feed.xml',
    movedToUrl: null,
    consecutiveFailures: 0,
    lastFailedRefreshAt: null,
    lastSuccessfulRefreshAt: now,
    lastErrorClass: null,
    lastErrorMessage: null,
};
const category = { id: 3, name: 'Technology', subscriptionCount: 1 };

const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json; charset=UTF-8',
    body: JSON.stringify(body),
});

test('switches a moved feed to its new URL from the details drawer', async ({
    page,
}) => {
    let moved = false;
    let moveRequest: { path: string; body: unknown } | undefined;

    await page.addInitScript(() => {
        document.cookie = 'larafeed-test-csrf=move-csrf; path=/; SameSite=Lax';
    });
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
        if (pathname === '/api/subscriptions/manage') {
            await route.fulfill(
                json({
                    categories: [category],
                    subscriptions: [moved ? newSubscription : oldSubscription],
                }),
            );
            return;
        }
        if (pathname === '/api/subscriptions/7/move') {
            moveRequest = { path: pathname, body: request.postDataJSON() };
            moved = true;
            await route.fulfill(
                json({
                    kind: 'moved',
                    subscription: newSubscription,
                    keptOldSubscription: false,
                }),
            );
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

    await page.goto('/settings/subscriptions');
    await expect(
        page.getByText('Feed moved. Open details to switch to the new URL.'),
    ).toBeVisible();
    await page
        .getByRole('button', { name: 'View details for Example blog' })
        .click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('This feed has moved')).toBeVisible();
    await drawer.getByRole('button', { name: 'Switch to new feed' }).click();

    await expect(
        page.getByText('Read and starred articles were carried over.'),
    ).toBeVisible();
    expect(moveRequest).toEqual({
        path: '/api/subscriptions/7/move',
        body: { feedUrl: 'https://example.test/feed.xml' },
    });
    // The drawer now shows the new subscription.
    await expect(drawer.getByText('This feed has moved')).toHaveCount(0);
    await expect(
        drawer.getByRole('link', { name: 'https://example.test/feed.xml' }),
    ).toBeVisible();
});

test('confirms a refresh started from the details drawer', async ({ page }) => {
    let refreshRequests = 0;

    await page.addInitScript(() => {
        document.cookie =
            'larafeed-test-csrf=refresh-csrf; path=/; SameSite=Lax';
    });
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
        if (pathname === '/api/subscriptions/manage') {
            await route.fulfill(
                json({
                    categories: [category],
                    subscriptions: [newSubscription],
                }),
            );
            return;
        }
        if (pathname === '/api/feeds/8/refresh') {
            refreshRequests += 1;
            await route.fulfill(
                json({ jobId: 1, operationId: 'refresh-8', state: 'queued' }),
            );
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

    await page.goto('/settings/subscriptions');
    await page
        .getByRole('button', { name: 'View details for Example blog' })
        .click();
    await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Refresh feed' })
        .click();

    await expect(
        page.getByText('Refresh queued for Example blog'),
    ).toBeVisible();
    expect(refreshRequests).toBe(1);
});

test('fits the feed audit on a phone without sideways scrolling', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', async (route) => {
        const { pathname } = new URL(route.request().url());
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
        if (pathname === '/api/subscriptions/manage') {
            await route.fulfill(
                json({
                    categories: [category],
                    subscriptions: [oldSubscription],
                }),
            );
            return;
        }
        await route.fulfill({ status: 404, body: '' });
    });

    await page.goto('/settings/subscriptions');
    const details = page.getByRole('button', {
        name: 'View details for Example blog',
    });
    await expect(details).toBeVisible();

    const tableBox = await page.locator('table').last().boundingBox();
    expect(tableBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
        390,
    );
    const detailsBox = await details.boundingBox();
    expect((detailsBox?.x ?? 0) + (detailsBox?.width ?? 0)).toBeLessThanOrEqual(
        390,
    );
});

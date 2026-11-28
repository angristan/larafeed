import { expect, type Page, test } from '@playwright/test';

const now = Date.parse('2026-07-18T12:00:00.000Z');
const user = {
    id: 1,
    username: 'reader',
    displayName: 'Reader',
    isAdmin: false,
};
const healthy = {
    feedId: 1,
    categoryId: 3,
    categoryName: 'Technology',
    feedName: 'Alpha weekly',
    customFeedName: null,
    feedUrl: 'https://alpha.test/feed.xml',
    siteUrl: 'https://alpha.test/',
    faviconUrl: null,
    faviconIsDark: null,
    entryCount: 40,
    unreadCount: 2,
    isGone: false,
    movedToUrl: null,
    consecutiveFailures: 0,
    lastAttemptAt: now - 60_000,
    lastSuccessfulRefreshAt: now - 60_000,
    lastFailedRefreshAt: null,
    lastErrorClass: null,
    lastErrorMessage: null,
    filterRules: { excludeTitle: [], excludeContent: [], excludeAuthor: [] },
    refreshes: [],
};
const failing = {
    ...healthy,
    feedId: 2,
    feedName: 'Zulu news',
    feedUrl: 'https://zulu.test/feed.xml',
    siteUrl: 'https://zulu.test/',
    consecutiveFailures: 4,
    lastSuccessfulRefreshAt: now - 5 * 86_400_000,
    lastFailedRefreshAt: now - 60_000,
    lastErrorClass: 'FeedHttpError',
    lastErrorMessage: 'Feed returned HTTP 503',
};
const category = { id: 3, name: 'Technology', subscriptionCount: 2 };

async function mockApi(page: Page) {
    await page.route('**/api/**', async (route) => {
        const { pathname } = new URL(route.request().url());
        const json = (body: unknown) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json; charset=UTF-8',
                body: JSON.stringify(body),
            });
        if (pathname === '/api/auth/session') {
            await json({
                authenticated: true,
                user,
                expiresAt: now + 86_400_000,
            });
            return;
        }
        if (pathname === '/api/subscriptions/manage') {
            await json({
                categories: [category],
                subscriptions: [healthy, failing],
            });
            return;
        }
        await route.fulfill({ status: 404, body: '' });
    });
}

test('lists failing feeds first and opens a feed from anywhere on its row', async ({
    page,
}) => {
    await mockApi(page);
    await page.goto('/settings/subscriptions');

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toContainText('Zulu news');
    await expect(rows.first()).toContainText('Feed returned HTTP 503');
    await expect(rows.nth(1)).toContainText('Alpha weekly');
    await expect(rows.nth(1)).not.toContainText('HTTP');

    // A click on the category cell opens the drawer, not only the name.
    await rows.nth(1).getByRole('cell', { name: 'Technology' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Alpha weekly')).toBeVisible();
    await expect(
        drawer.getByRole('link', {
            name: 'https://alpha.test/',
            exact: true,
        }),
    ).toBeVisible();
    await expect(drawer.getByText('Last failure')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // Keyboard users reach each row through the feed name.
    const zulu = page.getByRole('button', {
        name: 'View details for Zulu news',
    });
    await zulu.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog').getByText('Zulu news')).toBeVisible();
});

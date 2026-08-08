import { expect, type Page, test } from '@playwright/test';

test.use({ hasTouch: true });

const now = Date.parse('2026-07-18T12:00:00.000Z');

const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json; charset=UTF-8',
    body: JSON.stringify(body),
});

async function mockReaderApi(
    page: Page,
    options: { readonly faviconUrl?: string | null } = {},
): Promise<void> {
    await page.addInitScript(() => {
        document.cookie =
            'larafeed-test-csrf=browser-csrf; path=/; SameSite=Lax';
    });
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());

        if (pathname === '/api/auth/session') {
            await route.fulfill(
                json({
                    authenticated: true,
                    user: {
                        id: 1,
                        username: 'reader',
                        displayName: 'Reader',
                        isAdmin: false,
                    },
                    expiresAt: now + 86_400_000,
                }),
            );
            return;
        }
        if (pathname === '/api/account') {
            await route.fulfill(
                json({
                    id: 1,
                    username: 'reader',
                    email: 'reader@example.test',
                    displayName: 'Reader',
                    isAdmin: false,
                    createdAt: now - 86_400_000,
                }),
            );
            return;
        }
        if (pathname === '/api/categories') {
            await route.fulfill(
                json({ categories: [{ id: 11, name: 'Technology' }] }),
            );
            return;
        }
        if (pathname === '/api/subscriptions') {
            await route.fulfill(
                json({
                    subscriptions: [
                        {
                            feedId: 21,
                            categoryId: 11,
                            feedName: 'Example feed',
                            customFeedName: null,
                            faviconUrl: options.faviconUrl ?? null,
                            faviconIsDark: false,
                            totalCount: 1,
                            unreadCount: 1,
                        },
                    ],
                }),
            );
            return;
        }
        if (pathname === '/api/subscriptions/manage') {
            await route.fulfill(
                json({
                    categories: [
                        {
                            id: 11,
                            name: 'Technology',
                            subscriptionCount: 1,
                        },
                    ],
                    subscriptions: [
                        {
                            feedId: 21,
                            categoryId: 11,
                            categoryName: 'Technology',
                            feedName: 'Example feed',
                            customFeedName: null,
                            feedUrl: 'https://publisher.example.test/feed.xml',
                            siteUrl: 'https://publisher.example.test/',
                            faviconUrl: null,
                            faviconIsDark: false,
                            entryCount: 1,
                            unreadCount: 1,
                            isGone: false,
                            consecutiveFailures: 0,
                            lastAttemptAt: now,
                            lastSuccessfulRefreshAt: now,
                            lastFailedRefreshAt: null,
                            lastErrorClass: null,
                            lastErrorMessage: null,
                            filterRules: {
                                excludeTitle: [],
                                excludeContent: [],
                                excludeAuthor: [],
                            },
                            refreshes: [],
                        },
                    ],
                }),
            );
            return;
        }
        if (pathname === '/api/entries/counts') {
            await route.fulfill(
                json({ total: 1, unread: 1, read: 0, starred: 0 }),
            );
            return;
        }
        if (pathname === '/api/entries') {
            await route.fulfill(
                json({
                    entries: [],
                    total: 0,
                    nextCursor: null,
                }),
            );
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
}

test('navigates categories and exposes separate keyboard menus', async ({
    page,
}) => {
    await mockReaderApi(page);
    await page.goto('/feeds?filter=all&order_by=published_at');

    const categoryLink = page.getByRole('link', { name: 'Technology' });
    const disclosure = page.getByRole('button', {
        name: 'Collapse Technology feeds',
    });
    const categoryActions = page.getByRole('button', {
        name: 'Manage Technology category',
    });
    const feedLink = page.getByRole('link', { name: 'Example feed' });
    const feedActions = page.getByRole('button', {
        name: 'Manage Example feed',
    });

    await expect(categoryLink).toBeVisible();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(categoryActions).toBeVisible();
    await expect(categoryActions).toHaveAttribute('aria-haspopup', 'menu');
    await expect(feedActions).toBeVisible();
    await expect(feedActions).toHaveAttribute('aria-haspopup', 'menu');
    expect(await categoryActions.evaluate((element) => element.closest('a'))).toBeNull();
    expect(await feedActions.evaluate((element) => element.closest('a'))).toBeNull();

    await disclosure.focus();
    await disclosure.press('Enter');
    await expect(feedLink).toBeHidden();
    const expand = page.getByRole('button', {
        name: 'Expand Technology feeds',
    });
    await expand.press('Enter');
    await expect(feedLink).toBeVisible();

    const readerUrl = page.url();
    await feedActions.focus();
    await feedActions.press('Enter');
    await expect(feedActions).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Manage feed', { exact: true })).toBeVisible();
    expect(page.url()).toBe(readerUrl);
    await page.keyboard.press('Escape');

    await categoryActions.focus();
    await categoryActions.press('Enter');
    await expect(categoryActions).toHaveAttribute('aria-expanded', 'true');
    await expect(
        page.getByText('Manage category', { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await categoryLink.click();
    await expect(page).toHaveURL(/(?:\?|&)category=11(?:&|$)/u);
});

test('shows the RSS fallback when a favicon request fails', async ({ page }) => {
    await mockReaderApi(page, {
        faviconUrl: '/api/images/feeds/21/small',
    });
    await page.goto('/feeds?filter=all&order_by=published_at');

    const feedLink = page.getByRole('link', { name: 'Example feed' });
    await expect(feedLink).toBeVisible();
    await expect(feedLink.locator('img')).toHaveCount(0);
    await expect(feedLink.locator('svg')).toBeVisible();
});

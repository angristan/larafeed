import { expect, type Page, test } from '@playwright/test';

const now = Date.parse('2026-07-18T12:00:00.000Z');
const longFeedName =
    'Lobsters: Top Stories of the Past Week and Other Excellent Links';
const entry = {
    id: 41,
    feedId: 21,
    title: 'First unread entry',
    url: 'https://publisher.example.test/first',
    author: 'Author',
    publishedAt: now - 60_000,
    createdAt: now - 60_000,
    feedName: 'Example feed',
    customFeedName: null,
    faviconUrl: null,
    faviconIsDark: false,
    read: false,
    starred: false,
    archived: false,
};

interface ApiState {
    entryListRequests: number;
    summaryPosts: number;
    readPuts: number;
}

const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json; charset=UTF-8',
    body: JSON.stringify(body),
});

async function mockReaderApi(
    page: Page,
    feedName = 'Example feed',
): Promise<ApiState> {
    const state: ApiState = {
        entryListRequests: 0,
        summaryPosts: 0,
        readPuts: 0,
    };
    await page.addInitScript(() => {
        document.cookie = 'larafeed-test-csrf=browser-csrf; path=/; SameSite=Lax';
    });
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const { pathname } = url;

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
                            feedName,
                            customFeedName: null,
                            faviconUrl: null,
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
                            feedName,
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
        if (pathname === '/api/entries' && request.method() === 'GET') {
            state.entryListRequests += 1;
            await route.fulfill(
                json({
                    entries: [entry],
                    pagination: {
                        page: 1,
                        pageSize: 30,
                        total: 1,
                        totalPages: 1,
                    },
                }),
            );
            return;
        }
        if (pathname === '/api/entries/41' && request.method() === 'GET') {
            await route.fulfill(
                json({
                    ...entry,
                    contentHtml:
                        '<p>Article text with enough words for the reader.</p><img src="/api/images/entries/41/1">',
                    readChangedAt: null,
                    starredAt: null,
                    archivedAt: null,
                }),
            );
            return;
        }
        if (pathname === '/api/entries/41/read') {
            state.readPuts += 1;
            await route.fulfill(
                json({
                    entryId: 41,
                    feedId: 21,
                    read: true,
                    readChangedAt: now,
                    starred: false,
                    starredAt: null,
                    archived: false,
                    archivedAt: null,
                }),
            );
            return;
        }
        if (pathname === '/api/entries/41/summary') {
            if (request.method() === 'GET') {
                await route.fulfill(json({ summary: null }));
                return;
            }
            state.summaryPosts += 1;
            await route.fulfill(
                json({
                    summary: {
                        id: 81,
                        entryId: 41,
                        html: '<p><strong>Generated summary.</strong></p>',
                        model: 'gemini-2.5-flash',
                        promptVersion: 'entry-summary-v1',
                        generatedAt: now,
                    },
                }),
            );
            return;
        }
        if (pathname.startsWith('/api/images/')) {
            await route.fulfill({
                status: 200,
                contentType: 'image/png',
                body: Buffer.from(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42mAAAAAElFTkSuQmCC',
                    'base64',
                ),
            });
            return;
        }

        await route.fulfill(
            json({
                error: { code: 'not_found', message: `Unmocked ${pathname}` },
            }),
        );
    });
    return state;
}

test('keeps the unread page stable and generates a summary with one click', async ({
    page,
}) => {
    const state = await mockReaderApi(page);
    await page.goto('/feeds?filter=unread&order_by=published_at&page=1');

    const entryLink = page.getByText('First unread entry', { exact: true }).first();
    await expect(entryLink).toBeVisible();
    await entryLink.click();
    await expect(page.locator('h1')).toHaveText('First unread entry');
    await expect(page.locator('h1')).not.toBeFocused();
    await expect.poll(() => state.readPuts).toBe(1);
    await expect(entryLink).toBeVisible();
    expect(state.entryListRequests).toBe(1);

    await page.getByLabel('AI summary').click();
    await expect(page).toHaveURL(/summarize=true/u);
    await expect(page.getByText('Generated summary.')).toBeVisible();
    expect(state.summaryPosts).toBe(1);
    expect(state.entryListRequests).toBe(1);
});

test('truncates long feed names within the sidebar', async ({ page }) => {
    await mockReaderApi(page, longFeedName);
    await page.goto('/feeds?filter=all&order_by=published_at&page=1');

    const feedName = page.getByText(longFeedName, { exact: true }).first();
    await expect(feedName).toBeVisible();
    await expect(feedName).toHaveCSS('text-overflow', 'ellipsis');

    const dimensions = await feedName.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);

    const sidebar = page.getByRole('navigation', { name: 'Feed library' });
    const sidebarBox = await sidebar.boundingBox();
    const feedNameBox = await feedName.boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(feedNameBox).not.toBeNull();
    expect((feedNameBox?.x ?? 0) + (feedNameBox?.width ?? 0)).toBeLessThanOrEqual(
        (sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0),
    );
});

test('uses a single list or detail pane on mobile with working back navigation', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockReaderApi(page);
    await page.goto('/feeds?filter=all&order_by=published_at&page=1');

    const entryLink = page
        .getByText('First unread entry', { exact: true })
        .first();
    const entryRow = page.locator('#reader-entry-41');
    const detailHeading = page.getByRole('heading', {
        name: 'First unread entry',
    });
    await expect(entryLink).toBeVisible();
    await entryLink.click();

    const back = page.getByRole('button', { name: 'Back to entry list' });
    await expect(back).toBeVisible();
    await expect(detailHeading).toBeVisible();
    await expect(detailHeading).toBeFocused();
    await expect(entryLink).toBeHidden();

    await back.click();
    await expect(entryLink).toBeVisible();
    await expect(entryRow).toBeFocused();
    await expect(back).toBeHidden();

    await entryRow.click();
    await expect(detailHeading).toBeFocused();
    await page.getByLabel('AI summary').click();
    await expect(page).toHaveURL(/summarize=true/u);
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.getByRole('link', { name: /Unread/u }).click();

    await expect
        .poll(() => {
            const search = new URL(page.url()).searchParams;
            return {
                entry: search.get('entry'),
                filter: search.get('filter'),
                summarize: search.get('summarize'),
            };
        })
        .toEqual({ entry: null, filter: 'unread', summarize: null });
    await expect(entryLink).toBeVisible();
    await expect(back).toBeHidden();
});

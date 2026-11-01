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
    unsubscribeDeletes: number;
    subscriptionCreateBodies: unknown[];
}

const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json; charset=UTF-8',
    body: JSON.stringify(body),
});

async function mockReaderApi(
    page: Page,
    feedName = 'Example feed',
    newEntryCount = 0,
    entryCount = 1,
): Promise<ApiState> {
    const listEntries =
        entryCount === 1
            ? [entry]
            : Array.from({ length: entryCount }, (_, index) => ({
                  ...entry,
                  id: 41 + index,
                  title: `Entry ${index + 1}`,
                  publishedAt: now - (index + 1) * 60_000,
                  createdAt: now - (index + 1) * 60_000,
              }));
    const state: ApiState = {
        entryListRequests: 0,
        summaryPosts: 0,
        readPuts: 0,
        unsubscribeDeletes: 0,
        subscriptionCreateBodies: [],
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
        if (
            pathname === '/api/subscriptions' &&
            request.method() === 'POST'
        ) {
            const body: unknown = request.postDataJSON();
            state.subscriptionCreateBodies.push(body);
            const feedUrl =
                typeof body === 'object' && body !== null
                    ? Reflect.get(body, 'feedUrl')
                    : undefined;
            if (feedUrl === 'https://www.raspberrypi.com/news/') {
                await route.fulfill(
                    json({
                        kind: 'selection_required',
                        candidates: [
                            {
                                title: 'Raspberry Pi',
                                feedUrl:
                                    'https://www.raspberrypi.com/feed/',
                                siteUrl: 'https://www.raspberrypi.com/',
                                identicalTo: [
                                    'https://www.raspberrypi.com/news/feed/',
                                ],
                            },
                            {
                                title: 'News - Raspberry Pi',
                                feedUrl:
                                    'https://www.raspberrypi.com/news/feed/',
                                siteUrl:
                                    'https://www.raspberrypi.com/news/',
                                identicalTo: [
                                    'https://www.raspberrypi.com/feed/',
                                ],
                            },
                        ],
                    }),
                );
                return;
            }
            await route.fulfill(
                json({
                    kind: 'created',
                    subscription: {
                        feedId: 22,
                        categoryId: 11,
                        categoryName: 'Technology',
                        feedName: 'News - Raspberry Pi',
                        customFeedName: null,
                        feedUrl:
                            'https://www.raspberrypi.com/news/feed/',
                        siteUrl: 'https://www.raspberrypi.com/news/',
                        faviconUrl: null,
                        faviconIsDark: null,
                        entryCount: 10,
                        unreadCount: 10,
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
                    createdFeed: true,
                    createdSubscription: true,
                }),
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
        if (
            pathname === '/api/subscriptions/21' &&
            request.method() === 'DELETE'
        ) {
            state.unsubscribeDeletes += 1;
            await route.fulfill(json({ deleted: true }));
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
            const isNewEntryProbe =
                url.searchParams.get('order_by') === 'created_at' &&
                url.searchParams.get('page_size') === '1';
            if (isNewEntryProbe) {
                await route.fulfill(
                    json({
                        entries:
                            newEntryCount > 0
                                ? [
                                      {
                                          ...entry,
                                          id: 42,
                                          createdAt: now,
                                          title: 'Newly ingested entry',
                                      },
                                  ]
                                : listEntries.slice(0, 1),
                        total: listEntries.length + newEntryCount,
                        nextCursor: null,
                    }),
                );
                return;
            }
            const pageSize = Number(url.searchParams.get('page_size') ?? '30');
            const cursor = url.searchParams.get('cursor');
            const start =
                cursor === null
                    ? 0
                    : listEntries.findIndex(
                          (listEntry) => listEntry.id === Number(cursor),
                      ) + 1;
            const pageEntries = listEntries.slice(start, start + pageSize);
            await route.fulfill(
                json({
                    entries: pageEntries,
                    total: listEntries.length,
                    nextCursor:
                        pageEntries.length > 0 &&
                        pageEntries.length === pageSize
                            ? String(pageEntries[pageEntries.length - 1].id)
                            : null,
                }),
            );
            return;
        }
        if (pathname === '/api/entries/41' && request.method() === 'GET') {
            await route.fulfill(
                json({
                    ...entry,
                    contentHtml:
                        '<p>Article text with a <a href="https://publisher.example.test/linked">linked page</a>.</p><img src="/api/images/entries/41/1">',
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

test('keeps the unread page stable and generates a summary from entry actions', async ({
    page,
}) => {
    const state = await mockReaderApi(page);
    await page.goto('/feeds?filter=unread&order_by=published_at');

    const entryLink = page.getByText('First unread entry', { exact: true }).first();
    const entryRow = page.locator('#reader-entry-41');
    await expect(entryLink).toBeVisible();
    await expect(entryRow).toHaveAttribute('data-read', 'false');
    await entryLink.click();
    await expect(page.locator('h1')).toHaveText('First unread entry');
    await expect(page.locator('h1')).not.toBeFocused();
    await expect.poll(() => state.readPuts).toBe(1);
    await expect(entryRow).toHaveAttribute('data-read', 'true');
    await expect(entryRow.locator('.tabler-icon-check')).toBeVisible();

    const toolbar = page.locator('[data-entry-toolbar]');
    const [toolbarBox, sourceBox, contentBox, actionsBox, originalBox] =
        await Promise.all([
            toolbar.boundingBox(),
            toolbar.locator('[data-toolbar-source]').boundingBox(),
            toolbar.locator('[data-toolbar-content]').boundingBox(),
            toolbar.locator('[data-toolbar-actions]').boundingBox(),
            page
                .getByRole('link', {
                    name: 'Open original article in a new tab',
                })
                .boundingBox(),
        ]);
    expect(toolbarBox?.height).toBeLessThanOrEqual(60);
    const groupCenters = [sourceBox, contentBox, actionsBox].map(
        (box) => (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
    expect(Math.max(...groupCenters) - Math.min(...groupCenters)).toBeLessThan(
        2,
    );
    expect(originalBox?.width).toBeGreaterThanOrEqual(35);

    // The read confirmation re-renders the article; links must still
    // open in a new tab afterwards.
    const articleLink = page.getByRole('link', { name: 'linked page' });
    await expect(articleLink).toHaveAttribute('target', '_blank');
    await expect(articleLink).toHaveAttribute('rel', /noopener/u);
    await expect(entryLink).toBeVisible();
    expect(state.entryListRequests).toBe(1);

    const moreActions = page.getByRole('button', {
        name: 'More entry and feed actions',
    });
    await moreActions.click();
    await page.getByRole('menuitem', { name: 'Show AI summary' }).click();
    await expect(page).toHaveURL(/summarize=true/u);
    await expect(page.getByText('Generated summary.')).toBeVisible();
    const backToArticle = page.getByRole('button', {
        name: 'Back to article',
    });
    await expect(backToArticle).toBeVisible();
    await backToArticle.click();
    await expect(page).not.toHaveURL(/summarize=true/u);
    await expect(articleLink).toBeVisible();
    expect(state.summaryPosts).toBe(1);
    expect(state.entryListRequests).toBe(1);
});

test('shows how many new entries are waiting', async ({ page }) => {
    await mockReaderApi(page, 'Example feed', 12);
    await page.goto('/feeds?filter=all&order_by=published_at');
    await expect(
        page.getByText('First unread entry', { exact: true }).first(),
    ).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    const refresh = page.getByRole('button', { name: '12 new entries' });
    await expect(refresh).toBeVisible();
    await refresh.click();
    await expect(refresh).toBeHidden();
});

test('asks the user to choose between matching feed candidates', async ({
    page,
}) => {
    await page.addInitScript(() => {
        localStorage.setItem('larafeed-color-scheme', 'dark');
    });
    const state = await mockReaderApi(page);
    await page.goto('/feeds?filter=all&order_by=published_at');

    await page.getByRole('button', { name: 'Create feed or category' }).click();
    await page.setViewportSize({ width: 320, height: 700 });
    await page
        .getByRole('textbox', { name: 'Feed URL' })
        .fill('https://www.raspberrypi.com/news/');
    await page.getByRole('button', { name: 'Add feed' }).click();

    await expect(page.getByText('Choose a feed')).toBeVisible();
    await expect(
        page.getByText('Select the feed you want to follow.'),
    ).toBeVisible();
    await expect(
        page.getByText('Both feeds have the same recent posts.'),
    ).toBeVisible();
    const newsFeed = page.getByRole('radio', {
        name: /^News - Raspberry Pi/u,
    });
    await newsFeed.check();
    await page.getByRole('button', { name: 'Add feed' }).click();

    await expect
        .poll(() => state.subscriptionCreateBodies)
        .toEqual([
            {
                feedUrl: 'https://www.raspberrypi.com/news/',
                categoryId: 11,
            },
            {
                feedUrl: 'https://www.raspberrypi.com/news/feed/',
                categoryId: 11,
            },
        ]);
    await expect(page).toHaveURL(/feed=22/u);
});

test('persists the feed list density selected in settings', async ({
    page,
}) => {
    await mockReaderApi(page);
    await page.goto('/settings/appearance');

    const densityGroup = page.getByRole('radiogroup', {
        name: 'Feed list density',
    });
    await expect(
        densityGroup.getByRole('radio', { name: 'Comfortable' }),
    ).toBeChecked();
    const densityPreview = page.locator('[data-density-preview]');
    await expect(densityPreview).toHaveAttribute(
        'data-density-preview',
        'comfortable',
    );

    await densityGroup.getByText('Compact', { exact: true }).click();
    await expect(
        densityGroup.getByRole('radio', { name: 'Compact' }),
    ).toBeChecked();
    await expect(densityPreview).toHaveAttribute(
        'data-density-preview',
        'compact',
    );

    await page.goto('/feeds?filter=all&order_by=published_at');
    const entryList = page.locator('section[data-density]');
    const entryRow = page.locator('#reader-entry-41');
    await expect(entryList).toHaveAttribute('data-density', 'compact');
    const compactHeight = await entryRow.evaluate(
        (element) => element.getBoundingClientRect().height,
    );
    const compactFontSizes = await Promise.all([
        entryRow
            .getByText('First unread entry', { exact: true })
            .evaluate((element) => getComputedStyle(element).fontSize),
        entryRow
            .getByText('Example feed', { exact: true })
            .evaluate((element) => getComputedStyle(element).fontSize),
    ]);

    await page.goto('/settings/appearance');
    await expect(
        page.getByRole('radio', { name: 'Compact' }),
    ).toBeChecked();
    await page.getByText('Spacious', { exact: true }).click();
    await expect(densityPreview).toHaveAttribute(
        'data-density-preview',
        'spacious',
    );

    await page.goto('/feeds?filter=all&order_by=published_at');
    await expect(entryList).toHaveAttribute('data-density', 'spacious');
    const spaciousHeight = await entryRow.evaluate(
        (element) => element.getBoundingClientRect().height,
    );
    const spaciousFontSizes = await Promise.all([
        entryRow
            .getByText('First unread entry', { exact: true })
            .evaluate((element) => getComputedStyle(element).fontSize),
        entryRow
            .getByText('Example feed', { exact: true })
            .evaluate((element) => getComputedStyle(element).fontSize),
    ]);

    expect(spaciousHeight - compactHeight).toBeGreaterThanOrEqual(20);
    expect(spaciousFontSizes).toEqual(compactFontSizes);
});

test('keeps queue filters in a dense vertical list', async ({ page }) => {
    await mockReaderApi(page);
    await page.goto('/feeds?filter=all&order_by=published_at');

    const [unreadBox, readBox, favoritesBox] = await Promise.all([
        page.getByRole('link', { name: /^Unread(?: \d+)?$/u }).boundingBox(),
        page.getByRole('link', { name: 'Read', exact: true }).boundingBox(),
        page.getByRole('link', { name: 'Favorites', exact: true }).boundingBox(),
    ]);

    expect(unreadBox).not.toBeNull();
    expect(readBox).not.toBeNull();
    expect(favoritesBox).not.toBeNull();
    expect(Math.abs((unreadBox?.x ?? 0) - (readBox?.x ?? 0))).toBeLessThan(1);
    expect(Math.abs((readBox?.x ?? 0) - (favoritesBox?.x ?? 0))).toBeLessThan(
        1,
    );
    expect(readBox?.y).toBeGreaterThanOrEqual(
        (unreadBox?.y ?? 0) + (unreadBox?.height ?? 0),
    );
    expect(favoritesBox?.y).toBeGreaterThanOrEqual(
        (readBox?.y ?? 0) + (readBox?.height ?? 0),
    );
    expect(unreadBox?.height).toBeGreaterThanOrEqual(32);
    expect(unreadBox?.height).toBeLessThan(40);
    await expect(page.getByText('Queue', { exact: true })).toHaveCount(0);

    for (const label of ['Unread', 'Read', 'Favorites']) {
        const dimensions = await page
            .getByText(label, { exact: true })
            .first()
            .evaluate((element) => ({
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
            }));
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(
            dimensions.clientWidth,
        );
    }
});

test('separates the list and detail panes with a draggable divider', async ({
    page,
}) => {
    await mockReaderApi(page);
    await page.goto('/feeds?filter=unread&order_by=published_at');
    await expect(
        page.getByText('First unread entry', { exact: true }).first(),
    ).toBeVisible();

    const resizer = page.getByRole('button', { name: 'Resize' });
    await expect(resizer).toBeVisible();

    const before = await resizer.boundingBox();
    expect(before).not.toBeNull();

    await resizer.hover();
    await page.mouse.down();
    await page.mouse.move((before?.x ?? 0) + 120, (before?.y ?? 0) + 40, {
        steps: 5,
    });
    await page.mouse.up();

    const after = await resizer.boundingBox();
    expect((after?.x ?? 0) - (before?.x ?? 0)).toBeGreaterThan(80);
});

test('unsubscribes from a feed after confirmation', async ({ page }) => {
    const state = await mockReaderApi(page);
    await page.goto('/feeds?filter=all&order_by=published_at');

    await page.getByRole('button', { name: 'Manage Example feed' }).click();
    await page.getByRole('menuitem', { name: 'Unsubscribe' }).click();
    const dialog = page.getByRole('dialog', { name: 'Unsubscribe from feed?' });
    await dialog.getByRole('button', { name: 'Unsubscribe' }).click();

    await expect.poll(() => state.unsubscribeDeletes).toBe(1);
});

test('truncates long feed names within the sidebar', async ({ page }) => {
    await mockReaderApi(page, longFeedName);
    await page.goto('/feeds?filter=all&order_by=published_at');

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

test('moves focus between single panes at tablet width', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await mockReaderApi(page);
    await page.goto('/feeds?filter=all&order_by=published_at');

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
    await expect(detailHeading).toBeVisible();
    await expect(detailHeading).toBeFocused();
    // The list pane is display:none in single-pane mode, so its rows are
    // unmounted while the detail is open; assert on the row locator.
    await expect(entryRow).toBeHidden();
    await expect(back).toBeVisible();

    await back.click();
    await expect(entryRow).toBeVisible();
    await expect(entryRow).toBeFocused();
    await expect(back).toBeHidden();
});

test('uses a single list or detail pane on mobile with working back navigation', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockReaderApi(page);
    await page.goto('/feeds?filter=all&order_by=published_at');

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
    // The list pane is display:none in single-pane mode, so its rows are
    // unmounted while the detail is open; assert on the row locator.
    await expect(entryRow).toBeHidden();

    const mobileToolbar = page.locator('[data-entry-toolbar]');
    const [
        mobileToolbarBox,
        mobileSourceBox,
        mobileContentBox,
        mobileActionsBox,
    ] = await Promise.all([
        mobileToolbar.boundingBox(),
        mobileToolbar.locator('[data-toolbar-source]').boundingBox(),
        mobileToolbar.locator('[data-toolbar-content]').boundingBox(),
        mobileToolbar.locator('[data-toolbar-actions]').boundingBox(),
    ]);
    expect(mobileToolbarBox?.height).toBeLessThanOrEqual(60);
    const mobileGroupCenters = [
        mobileSourceBox,
        mobileContentBox,
        mobileActionsBox,
    ].map((box) => (box?.y ?? 0) + (box?.height ?? 0) / 2);
    expect(
        Math.max(...mobileGroupCenters) - Math.min(...mobileGroupCenters),
    ).toBeLessThan(2);
    await expect(page.locator('[data-direct-read-action]')).toBeHidden();
    const moreActions = page.getByRole('button', {
        name: 'More entry and feed actions',
    });
    await expect(moreActions).toBeVisible();
    expect((await moreActions.boundingBox())?.width).toBeGreaterThanOrEqual(39);

    await back.click();
    await expect(entryRow).toBeVisible();
    await expect(entryRow).toBeFocused();
    await expect(back).toBeHidden();

    await entryRow.click();
    await expect(detailHeading).toBeFocused();
    await moreActions.click();
    await page.getByRole('menuitem', { name: 'Show AI summary' }).click();
    await expect(page).toHaveURL(/summarize=true/u);
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.getByRole('link', { name: /^Unread(?: \d+)?$/u }).click();

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

test('keeps virtual rows stacked while scrolling during the enter animation', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockReaderApi(page, 'Example feed', 0, 90);
    await page.goto('/feeds?filter=all&order_by=published_at');

    const list = page.locator('section[aria-label="All entries"]');
    const viewport = list.locator('[data-scrollarea-viewport]');
    await list.locator('li[data-index]').first().waitFor({ state: 'attached' });

    // Scroll within the enter-animation window: data-animating stays set for
    // 900ms after the list loads, and a transform keyframe on the positioned
    // row would override the virtualizer's translateY and collapse the rows.
    await viewport.evaluate((element) => {
        element.scrollTop = 900;
    });
    // Wait until scrolling has moved the virtual window past the initial
    // one, while the enter-animation gate is still active; sampling after
    // the gate expires would let a row-positioning bug pass.
    await page.waitForFunction(() => {
        const rows = document.querySelectorAll('li[data-index]');
        if (rows.length === 0) {
            return false;
        }
        const first = Number(rows[0].getAttribute('data-index'));
        const last = Number(rows[rows.length - 1].getAttribute('data-index'));
        const gateActive = document
            .querySelector('section[aria-label="All entries"] ul')
            ?.hasAttribute('data-animating');
        return first > 0 && last >= 20 && gateActive === true;
    });

    const rows = await list.locator('li[data-index]').evaluateAll((elements) =>
        elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
                index: Number(element.getAttribute('data-index')),
                top: rect.top,
                height: rect.height,
            };
        }),
    );
    const stacked = [...rows].sort((a, b) => a.index - b.index);
    expect(stacked.length).toBeGreaterThan(3);
    for (let i = 1; i < stacked.length; i += 1) {
        expect(stacked[i].top).toBeGreaterThanOrEqual(
            stacked[i - 1].top + stacked[i - 1].height - 2,
        );
    }
});

test('keeps a deep-linked entry fully visible below the list header', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockReaderApi(page, 'Example feed', 0, 90);
    // Entry id 70 is the 30th entry (index 29), at the end of the first page.
    await page.goto('/feeds?filter=all&order_by=published_at&entry=70');

    const list = page.locator('section[aria-label="All entries"]');
    const row = list.locator('li[data-index="29"]');
    await expect(row).toBeVisible();

    const viewport = list.locator('[data-scrollarea-viewport]');
    const [rowBox, viewportBox] = await Promise.all([
        row.boundingBox(),
        viewport.boundingBox(),
    ]);
    expect(rowBox).not.toBeNull();
    expect(viewportBox).not.toBeNull();
    // The 57px list header overlays the top of the viewport.
    expect((rowBox?.y ?? 0) - (viewportBox?.y ?? 0)).toBeGreaterThanOrEqual(
        56,
    );
    expect(
        (rowBox?.y ?? 0) + (rowBox?.height ?? 0),
    ).toBeLessThanOrEqual((viewportBox?.y ?? 0) + (viewportBox?.height ?? 0) + 1);
});

test('skips the row enter animation under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockReaderApi(page);
    await page.goto('/feeds?filter=all&order_by=published_at');

    const rowLink = page.locator('li[data-index] a').first();
    await rowLink.waitFor({ state: 'attached' });
    const animationName = await rowLink.evaluate(
        (element) => getComputedStyle(element).animationName,
    );
    expect(animationName).toBe('none');
});

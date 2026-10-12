import { expect, test } from '@playwright/test';

const now = Date.parse('2026-07-18T12:00:00.000Z');
const user = {
    id: 1,
    username: 'reader',
    displayName: 'Reader',
    isAdmin: false,
};
const endpointUrl = 'http://127.0.0.1:4173/mcp';
const connectedClient = {
    grantId: 'grant-1',
    clientId: 'https://assistant.example.test/client.json',
    clientName: 'Example Assistant',
    clientDomain: 'assistant.example.test',
    scopes: ['mcp:read', 'mcp:write'],
    createdAt: now - 3_600_000,
    expiresAt: now + 30 * 86_400_000,
};

const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json; charset=UTF-8',
    body: JSON.stringify(body),
});

test('turns MCP on, lists apps, and confirms before disconnecting all of them', async ({
    page,
}) => {
    let enabled = false;
    let clients: (typeof connectedClient)[] = [];
    const updates: { body: unknown; csrf: string | null }[] = [];

    await page.addInitScript(() => {
        document.cookie = 'larafeed-test-csrf=mcp-csrf; path=/; SameSite=Lax';
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
        if (pathname === '/api/mcp' && request.method() === 'PUT') {
            const body = request.postDataJSON() as { enabled: boolean };
            updates.push({
                body,
                csrf: await request.headerValue('x-csrf-token'),
            });
            enabled = body.enabled;
            // Turning MCP on lets an app connect; turning it off revokes all.
            clients = enabled ? [connectedClient] : [];
        }
        if (pathname === '/api/mcp') {
            await route.fulfill(json({ enabled, endpointUrl, clients }));
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

    // The authorization page links here when MCP access is off.
    const returnTo = '/authorize?client_id=abc&state=xyz';
    await page.goto(
        `/settings/mcp?${new URLSearchParams({ returnTo }).toString()}`,
    );
    await expect(page).toHaveTitle('MCP - Larafeed');
    await expect(page.getByLabel('MCP server URL')).toHaveText(endpointUrl);
    await expect(
        page.getByText('Turn on MCP access to connect an app.'),
    ).toBeVisible();

    const toggle = page.getByRole('switch', { name: 'Allow MCP access' });
    await expect(toggle).not.toBeChecked();
    await toggle.click({ force: true });
    await expect(toggle).toBeChecked();
    expect(updates).toEqual([{ body: { enabled: true }, csrf: 'mcp-csrf' }]);

    await expect(page.getByRole('link', { name: 'Continue' })).toHaveAttribute(
        'href',
        returnTo,
    );
    await expect(page.getByText('Example Assistant')).toBeVisible();
    await expect(page.getByText('Published by assistant.example.test')).toBeVisible();

    // Turning off with a connected app asks first; cancel keeps it on.
    await toggle.click({ force: true });
    const dialog = page.getByRole('dialog', { name: 'Turn off MCP access?' });
    await expect(dialog).toContainText('All 1 connected apps lose access');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(toggle).toBeChecked();
    expect(updates).toHaveLength(1);

    await toggle.click({ force: true });
    await page
        .getByRole('dialog', { name: 'Turn off MCP access?' })
        .getByRole('button', { name: 'Turn off and disconnect' })
        .click();
    await expect(toggle).not.toBeChecked();
    expect(updates.at(-1)).toEqual({
        body: { enabled: false },
        csrf: 'mcp-csrf',
    });
    await expect(page.getByText('Example Assistant')).toHaveCount(0);
});

test('returns a signed-in user from login to the authorization page', async ({
    page,
}) => {
    await page.route('**/api/auth/session', (route) =>
        route.fulfill(
            json({ authenticated: true, user, expiresAt: now + 86_400_000 }),
        ),
    );
    // The Worker serves /authorize. In this static preview, record the full
    // page load instead.
    await page.route('**/authorize?**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: '<title>Consent</title>',
        }),
    );

    const returnTo = '/authorize?client_id=abc&state=xyz';
    await page.goto(`/login?${new URLSearchParams({ returnTo }).toString()}`);
    await expect(page).toHaveURL(`http://127.0.0.1:4173${returnTo}`);
    await expect(page).toHaveTitle('Consent');
});

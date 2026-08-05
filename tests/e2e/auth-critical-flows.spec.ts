import { expect, type Page, test } from '@playwright/test';

import {
    type CeremonyBrowserState,
    installCeremonyBrowserShim,
} from './auth-browser-shim';

const now = Date.parse('2026-07-18T12:00:00.000Z');
const user = {
    id: 1,
    username: 'reader',
    displayName: 'Reader',
    isAdmin: false,
};
const authenticationOptions = {
    challenge: 'AQIDBA',
    timeout: 60_000,
    rpId: '127.0.0.1',
    userVerification: 'required',
    allowCredentials: [
        {
            id: 'AQIDBA',
            type: 'public-key',
            transports: ['internal'],
        },
    ],
};
const assertionResponse = {
    id: 'fake-credential',
    rawId: 'AQIDBA',
    response: {
        authenticatorData: 'BQYH',
        clientDataJSON: 'CAk',
        signature: 'Cgs',
    },
    type: 'public-key',
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
};

const json = (body: unknown, headers?: Readonly<Record<string, string>>) => ({
    status: 200,
    contentType: 'application/json; charset=UTF-8',
    body: JSON.stringify(body),
    headers,
});

interface RecordedRequest {
    readonly path: string;
    readonly method: string;
    readonly body: unknown;
    readonly csrf: string | null;
}

async function setInitialCsrf(page: Page): Promise<void> {
    await page.addInitScript(() => {
        document.cookie = 'larafeed-test-csrf=stale-csrf; path=/; SameSite=Lax';
    });
}

test('completes Turnstile and WebAuthn login before returning to the requested page', async ({
    page,
}) => {
    const ceremony: CeremonyBrowserState = {
        events: [],
        challengeScriptRequests: 0,
    };
    const requests: RecordedRequest[] = [];
    await installCeremonyBrowserShim(page, ceremony);
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());

        if (pathname === '/api/auth/session') {
            await route.fulfill(json({ authenticated: false }));
            return;
        }
        if (pathname === '/api/auth/config') {
            await route.fulfill(json({ turnstileSiteKey: 'test-site-key' }));
            return;
        }
        if (pathname === '/api/auth/authentication/options') {
            ceremony.events.push('api:authentication-options');
            requests.push({
                path: pathname,
                method: request.method(),
                body: request.postDataJSON(),
                csrf: await request.headerValue('x-csrf-token'),
            });
            await route.fulfill(
                json({ challengeId: 101, options: authenticationOptions }),
            );
            return;
        }
        if (pathname === '/api/auth/authentication/verify') {
            ceremony.events.push('api:authentication-verify');
            requests.push({
                path: pathname,
                method: request.method(),
                body: request.postDataJSON(),
                csrf: await request.headerValue('x-csrf-token'),
            });
            await route.fulfill(
                json({
                    authenticated: true,
                    user,
                    expiresAt: now + 86_400_000,
                }),
            );
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

    const returnTo = '/settings/opml?source=login#history';
    await page.goto(`/login?${new URLSearchParams({ returnTo })}`);
    await expect(page).toHaveTitle('Log in - Larafeed');

    const passkeyButton = page.getByRole('button', {
        name: 'Continue with a passkey',
    });
    const restingTextColor = await passkeyButton.evaluate(
        (element) => getComputedStyle(element).color,
    );
    await passkeyButton.hover();
    await expect(passkeyButton).toHaveCSS('color', restingTextColor);
    await passkeyButton.click();

    await expect(page).toHaveURL(/\/settings\/opml\?source=login#history$/u);
    await expect(page).toHaveTitle('Import & export - Larafeed');
    expect(ceremony.events).toEqual([
        'turnstile:authentication_options',
        'api:authentication-options',
        'webauthn:get',
        'turnstile:authentication_verify',
        'api:authentication-verify',
    ]);
    expect(requests).toEqual([
        {
            path: '/api/auth/authentication/options',
            method: 'POST',
            body: {
                turnstileToken: 'test-turnstile-authentication_options',
            },
            csrf: null,
        },
        {
            path: '/api/auth/authentication/verify',
            method: 'POST',
            body: {
                challengeId: 101,
                turnstileToken: 'test-turnstile-authentication_verify',
                response: assertionResponse,
            },
            csrf: null,
        },
    ]);
    expect(ceremony.challengeScriptRequests).toBe(0);
});

test('completes passkey login without Turnstile when disabled', async ({
    page,
}) => {
    const ceremony: CeremonyBrowserState = {
        events: [],
        challengeScriptRequests: 0,
    };
    const requests: RecordedRequest[] = [];
    await installCeremonyBrowserShim(page, ceremony);
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());

        if (pathname === '/api/auth/session') {
            await route.fulfill(json({ authenticated: false }));
            return;
        }
        if (pathname === '/api/auth/config') {
            await route.fulfill(json({ turnstileSiteKey: null }));
            return;
        }
        if (pathname === '/api/auth/authentication/options') {
            ceremony.events.push('api:authentication-options');
            requests.push({
                path: pathname,
                method: request.method(),
                body: request.postDataJSON(),
                csrf: await request.headerValue('x-csrf-token'),
            });
            await route.fulfill(
                json({ challengeId: 102, options: authenticationOptions }),
            );
            return;
        }
        if (pathname === '/api/auth/authentication/verify') {
            ceremony.events.push('api:authentication-verify');
            requests.push({
                path: pathname,
                method: request.method(),
                body: request.postDataJSON(),
                csrf: await request.headerValue('x-csrf-token'),
            });
            await route.fulfill(
                json({
                    authenticated: true,
                    user,
                    expiresAt: now + 86_400_000,
                }),
            );
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

    await page.goto('/login?returnTo=%2Fsettings%2Fopml');
    await page.getByRole('button', { name: 'Continue with a passkey' }).click();

    await expect(page).toHaveURL(/\/settings\/opml$/u);
    expect(ceremony.events).toEqual([
        'api:authentication-options',
        'webauthn:get',
        'api:authentication-verify',
    ]);
    expect(requests).toEqual([
        {
            path: '/api/auth/authentication/options',
            method: 'POST',
            body: {},
            csrf: null,
        },
        {
            path: '/api/auth/authentication/verify',
            method: 'POST',
            body: {
                challengeId: 102,
                response: assertionResponse,
            },
            csrf: null,
        },
    ]);
    expect(ceremony.challengeScriptRequests).toBe(0);
});

const destructiveActions = [
    {
        name: 'clear reader data',
        openButton: 'Clear data',
        endpoint: '/api/account/wipe',
        method: 'POST',
        challengeId: 201,
        finalPath: '/settings/security',
    },
    {
        name: 'delete the account',
        openButton: 'Delete account',
        endpoint: '/api/account',
        method: 'DELETE',
        challengeId: 202,
        finalPath: '/login',
    },
] as const;

for (const action of destructiveActions) {
    test(`reauthenticates with a fresh CSRF token before it can ${action.name}`, async ({
        page,
    }) => {
        const ceremony: CeremonyBrowserState = {
            events: [],
            challengeScriptRequests: 0,
        };
        const requests: RecordedRequest[] = [];
        await setInitialCsrf(page);
        await installCeremonyBrowserShim(page, ceremony);
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
            if (pathname === '/api/auth/config') {
                await route.fulfill(
                    json({ turnstileSiteKey: 'test-site-key' }),
                );
                return;
            }
            if (pathname === '/api/auth/passkeys') {
                await route.fulfill(
                    json({
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
                    }),
                );
                return;
            }
            if (pathname === '/api/account' && request.method() === 'GET') {
                await route.fulfill(
                    json({
                        ...user,
                        email: 'reader@example.test',
                        createdAt: now - 86_400_000,
                    }),
                );
                return;
            }
            if (pathname === '/api/auth/authentication/options') {
                ceremony.events.push('api:authentication-options');
                requests.push({
                    path: pathname,
                    method: request.method(),
                    body: request.postDataJSON(),
                    csrf: await request.headerValue('x-csrf-token'),
                });
                await route.fulfill(
                    json({
                        challengeId: action.challengeId,
                        options: authenticationOptions,
                    }),
                );
                return;
            }
            if (pathname === '/api/auth/authentication/verify') {
                ceremony.events.push('api:authentication-verify');
                requests.push({
                    path: pathname,
                    method: request.method(),
                    body: request.postDataJSON(),
                    csrf: await request.headerValue('x-csrf-token'),
                });
                await route.fulfill(
                    json(
                        {
                            authenticated: true,
                            user,
                            expiresAt: now + 86_400_000,
                        },
                        {
                            'set-cookie':
                                'larafeed-test-csrf=fresh-csrf; Path=/; SameSite=Lax',
                        },
                    ),
                );
                return;
            }
            if (
                pathname === action.endpoint &&
                request.method() === action.method
            ) {
                ceremony.events.push(`api:${action.method}:${action.endpoint}`);
                requests.push({
                    path: pathname,
                    method: request.method(),
                    body: request.postDataJSON(),
                    csrf: await request.headerValue('x-csrf-token'),
                });
                await route.fulfill(json({ success: true }));
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

        await page.goto('/settings/security#profile');
        await page
            .getByRole('button', { name: action.openButton, exact: true })
            .click();
        await page.getByLabel('Type reader to confirm').fill('reader');
        await page
            .getByRole('button', { name: 'Confirm with passkey' })
            .click();

        await expect.poll(() => ceremony.events.length).toBe(6);
        await expect
            .poll(() => new URL(page.url()).pathname)
            .toBe(action.finalPath);
        expect(ceremony.events).toEqual([
            'turnstile:authentication_options',
            'api:authentication-options',
            'webauthn:get',
            'turnstile:authentication_verify',
            'api:authentication-verify',
            `api:${action.method}:${action.endpoint}`,
        ]);
        expect(requests).toEqual([
            {
                path: '/api/auth/authentication/options',
                method: 'POST',
                body: {
                    turnstileToken: 'test-turnstile-authentication_options',
                },
                csrf: null,
            },
            {
                path: '/api/auth/authentication/verify',
                method: 'POST',
                body: {
                    challengeId: action.challengeId,
                    turnstileToken: 'test-turnstile-authentication_verify',
                    response: assertionResponse,
                },
                csrf: null,
            },
            {
                path: action.endpoint,
                method: action.method,
                body: { confirmation: 'reader' },
                csrf: 'fresh-csrf',
            },
        ]);
        expect(ceremony.challengeScriptRequests).toBe(0);
    });
}

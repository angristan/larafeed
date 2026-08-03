import type { Page } from '@playwright/test';

export interface CeremonyBrowserState {
    readonly events: string[];
    challengeScriptRequests: number;
}

export async function installCeremonyBrowserShim(
    page: Page,
    state: CeremonyBrowserState,
): Promise<void> {
    await page.route('https://challenges.cloudflare.com/**', async (route) => {
        state.challengeScriptRequests += 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript; charset=UTF-8',
            body: '',
        });
    });
    await page.route('**/__e2e/ceremony-event', async (route) => {
        const event: unknown = route.request().postDataJSON();
        if (typeof event === 'string') state.events.push(event);
        await route.fulfill({ status: 204, body: '' });
    });
    await page.addInitScript(() => {
        const record = async (event: string) => {
            await fetch('/__e2e/ceremony-event', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event),
            });
        };
        const bytes = (...values: number[]) => new Uint8Array(values).buffer;

        if (typeof window.PublicKeyCredential !== 'function') {
            Object.defineProperty(window, 'PublicKeyCredential', {
                configurable: true,
                value: function PublicKeyCredential() {},
            });
        }
        Object.defineProperty(navigator, 'credentials', {
            configurable: true,
            value: {
                get: async () => {
                    await record('webauthn:get');
                    return {
                        id: 'fake-credential',
                        rawId: bytes(1, 2, 3, 4),
                        response: {
                            authenticatorData: bytes(5, 6, 7),
                            clientDataJSON: bytes(8, 9),
                            signature: bytes(10, 11),
                            userHandle: null,
                        },
                        type: 'public-key',
                        authenticatorAttachment: 'platform',
                        getClientExtensionResults: () => ({}),
                    };
                },
            },
        });

        const widgets = new Map<
            string,
            {
                readonly action: string;
                readonly callback: (token: string) => void;
            }
        >();
        let nextWidgetId = 0;
        Object.defineProperty(window, 'turnstile', {
            configurable: true,
            value: {
                render: (
                    _container: HTMLElement,
                    options: {
                        readonly action: string;
                        readonly callback: (token: string) => void;
                    },
                ) => {
                    const widgetId = `test-widget-${++nextWidgetId}`;
                    widgets.set(widgetId, options);
                    return widgetId;
                },
                execute: (widgetId: string) => {
                    const options = widgets.get(widgetId);
                    if (options === undefined) return;
                    void record(`turnstile:${options.action}`).then(() => {
                        options.callback(`test-turnstile-${options.action}`);
                    });
                },
                reset: () => {},
                remove: (widgetId: string) => widgets.delete(widgetId),
            },
        });
    });
}

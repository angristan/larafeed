import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router')>();
    return { ...actual, createBrowserRouter: vi.fn(() => ({})) };
});

import { legacySettingsRedirectTarget } from './router';

describe('legacy settings redirects', () => {
    it.each([
        [
            'https://reader.example/subscriptions?status=failed',
            '/settings/subscriptions?status=failed',
        ],
        [
            'https://reader.example/profile?source=legacy',
            '/settings/security?source=legacy#profile',
        ],
        ['https://reader.example/import', '/settings/opml'],
        ['https://reader.example/import/', '/settings/opml'],
    ])('redirects %s to %s', (source, target) => {
        expect(legacySettingsRedirectTarget(new URL(source))).toBe(target);
    });

    it.each([
        '/settings/subscriptions',
        '/settings/security',
        '/settings/opml',
    ])('does not redirect canonical path %s', (pathname) => {
        expect(
            legacySettingsRedirectTarget(
                new URL(pathname, 'https://reader.example'),
            ),
        ).toBeNull();
    });
});

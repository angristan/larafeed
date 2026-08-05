import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router')>();
    return { ...actual, createBrowserRouter: vi.fn(() => ({})) };
});

import {
    legacySettingsRedirectTarget,
    sessionExpiryLoginTarget,
} from './router';

describe('session expiry redirects', () => {
    it('preserves the protected location as an encoded return target', () => {
        expect(
            sessionExpiryLoginTarget({
                pathname: '/feeds',
                search: '?filter=unread&category=3',
                hash: '#entry',
            }),
        ).toBe(
            '/login?returnTo=%2Ffeeds%3Ffilter%3Dunread%26category%3D3%23entry',
        );
        expect(
            sessionExpiryLoginTarget({ pathname: '/login', search: '' }),
        ).toBeNull();
    });
});

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
        [
            'https://reader.example/profile?section=profile&source=legacy#old',
            '/settings/security?source=legacy#profile',
        ],
        [
            'https://reader.example/profile?source=legacy&section=security',
            '/settings/security?source=legacy#security',
        ],
        [
            'https://reader.example/profile?section=opml&source=legacy#history',
            '/settings/opml?source=legacy#history',
        ],
        [
            'https://reader.example/profile?source=legacy#security',
            '/settings/security?source=legacy#security',
        ],
        ['https://reader.example/import', '/settings/opml'],
        ['https://reader.example/import/#history', '/settings/opml#history'],
    ])('redirects %s to %s', (source, target) => {
        expect(legacySettingsRedirectTarget(new URL(source))).toBe(target);
    });

    it.each([
        '/settings/subscriptions',
        '/settings/subscriptions/overview',
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

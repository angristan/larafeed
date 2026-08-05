import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { accountKeys } from '../queries/account';
import { authKeys } from '../queries/auth';
import { SecurityPage } from './SecurityPage';

describe('SecurityPage', () => {
    it('switches between profile and passkey sections', () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        queryClient.setQueryData(accountKeys.profile(), {
            id: 7,
            username: 'reader',
            email: 'reader@example.test',
            displayName: 'Reader',
            isAdmin: true,
            createdAt: 1,
        });
        queryClient.setQueryData(accountKeys.passkeys(), {
            passkeys: [
                {
                    id: 9,
                    name: 'Laptop',
                    transports: ['internal'],
                    backedUp: true,
                    createdAt: 1,
                    lastUsedAt: null,
                },
            ],
        });
        queryClient.setQueryData(authKeys.config(), {
            turnstileSiteKey: 'site-key',
        });
        queryClient.setQueryData(authKeys.session(), {
            authenticated: true,
            user: {
                id: 7,
                username: 'reader',
                displayName: 'Reader',
                isAdmin: true,
            },
            expiresAt: 3_000_000_000_000,
        });

        const render = (entry: string) =>
            renderToStaticMarkup(
                <MemoryRouter initialEntries={[entry]}>
                    <QueryClientProvider client={queryClient}>
                        <MantineProvider>
                            <SecurityPage />
                        </MantineProvider>
                    </QueryClientProvider>
                </MemoryRouter>,
            );

        const profileMarkup = render('/settings/security#profile');
        expect(profileMarkup).toContain('Settings');
        expect(profileMarkup).toContain('Profile settings');
        expect(profileMarkup).toContain('reader@example.test');
        expect(profileMarkup).toContain('Clear reader data');
        expect(profileMarkup).toContain('Delete account');
        expect(profileMarkup).toContain('App tokens');
        expect(profileMarkup).toContain('maxLength="255"');
        expect(profileMarkup).not.toContain('Laptop');

        const securityMarkup = render('/settings/security#security');
        expect(securityMarkup).toContain('Security');
        expect(securityMarkup).toContain('Laptop');
        expect(securityMarkup).toContain('Add another passkey before deleting');
        expect(securityMarkup).not.toContain('Profile settings');
        expect(securityMarkup).toContain('Import &amp; export');
        expect(securityMarkup).toContain('Administration');
        expect(securityMarkup).toContain('Users and access');
    });
});

import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { accountKeys } from '../queries/account';
import { authKeys } from '../queries/auth';
import { AdminUsersPage } from './AdminUsersPage';

describe('AdminUsersPage', () => {
    it('renders user lifecycle, link status, and security events', () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        queryClient.setQueryData(authKeys.session(), {
            authenticated: true,
            user: {
                id: 1,
                username: 'admin',
                displayName: 'Admin',
                isAdmin: true,
            },
            expiresAt: 100,
        });
        queryClient.setQueryData(accountKeys.admin(), {
            users: [
                {
                    id: 1,
                    username: 'admin',
                    email: 'admin@example.test',
                    displayName: 'Admin',
                    isAdmin: true,
                    disabledAt: null,
                    createdAt: 1,
                    passkeyCount: 2,
                    subscriptionCount: 4,
                },
                {
                    id: 2,
                    username: 'disabled',
                    email: 'disabled@example.test',
                    displayName: 'Disabled user',
                    isAdmin: false,
                    disabledAt: 2,
                    createdAt: 1,
                    passkeyCount: 1,
                    subscriptionCount: 0,
                },
            ],
            accessLinks: [
                {
                    id: 3,
                    userId: 2,
                    username: 'disabled',
                    purpose: 'recovery',
                    expiresAt: 1,
                    consumedAt: null,
                    revokedAt: 2,
                    createdAt: 1,
                },
            ],
            securityEvents: [
                {
                    id: 4,
                    userId: 2,
                    actorUserId: 1,
                    kind: 'account.disabled',
                    createdAt: 2,
                },
            ],
        });

        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <MantineProvider>
                        <AdminUsersPage />
                    </MantineProvider>
                </QueryClientProvider>
            </MemoryRouter>,
        );

        expect(markup).toContain('Invite a user');
        expect(markup).toContain('Users and access');
        expect(markup).toContain('Disabled user');
        expect(markup).toContain('Reactivate');
        expect(markup).toContain('Revoked');
        expect(markup).toContain('Account disabled');
        expect(markup).toContain('final active administrator is protected');
    });
});

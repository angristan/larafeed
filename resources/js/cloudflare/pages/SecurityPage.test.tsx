import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { accountKeys } from '../queries/account';
import { authKeys } from '../queries/auth';
import { SecurityPage } from './SecurityPage';

describe('SecurityPage', () => {
    it('renders profile, passkey, and confirmed destructive controls', () => {
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

        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <MantineProvider>
                        <SecurityPage />
                    </MantineProvider>
                </QueryClientProvider>
            </MemoryRouter>,
        );

        expect(markup).toContain('Account &amp; security');
        expect(markup).toContain('reader@example.test');
        expect(markup).toContain('Laptop');
        expect(markup).toContain('Add another passkey before deleting');
        expect(markup).toContain('Clear reader data');
        expect(markup).toContain('Delete account');
        expect(markup).toContain('Administration');
    });
});

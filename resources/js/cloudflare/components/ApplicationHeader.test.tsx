import { AppShell, MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { authKeys } from '../queries/auth';
import { ApplicationHeader } from './ApplicationHeader';

describe('ApplicationHeader', () => {
    it('restores Larafeed navigation and account controls', () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
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

        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <MantineProvider>
                        <AppShell header={{ height: 56 }}>
                            <ApplicationHeader activePage="reader" />
                        </AppShell>
                    </MantineProvider>
                </QueryClientProvider>
            </MemoryRouter>,
        );

        expect(markup).toContain('Larafeed');
        expect(markup).toContain('aria-label="Reader page"');
        expect(markup).toContain('aria-label="Subscriptions page"');
        expect(markup).toContain('aria-label="Charts page"');
        expect(markup).toContain('aria-label="Settings page"');
        expect(markup).toContain('aria-label="Keyboard shortcuts"');
        expect(markup).toContain('aria-label="Color scheme"');
        expect(markup).toContain('aria-label="Signed in as Reader"');
        expect(markup).toContain('github.com/angristan/larafeed');
    });
});

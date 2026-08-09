import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { authKeys } from '../queries/auth';
import { AppearancePage } from './AppearancePage';

describe('AppearancePage', () => {
    it('offers three feed list densities with the current default selected', () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        queryClient.setQueryData(authKeys.session(), {
            authenticated: true,
            user: {
                id: 7,
                username: 'reader',
                displayName: 'Reader',
                isAdmin: false,
            },
            expiresAt: 3_000_000_000_000,
        });

        const markup = renderToStaticMarkup(
            <MemoryRouter initialEntries={['/settings/appearance']}>
                <QueryClientProvider client={queryClient}>
                    <MantineProvider>
                        <AppearancePage />
                    </MantineProvider>
                </QueryClientProvider>
            </MemoryRouter>,
        );

        expect(markup).toContain('Feed list');
        expect(markup).toContain('aria-label="Feed list density"');
        expect(markup).toContain('Compact');
        expect(markup).toContain('Comfortable');
        expect(markup).toContain('Spacious');
        expect(markup).toContain('checked="" value="comfortable"');
        expect(markup).toContain('This setting is saved on this device.');
        expect(markup).toContain('Preview');
        expect(markup).toContain('data-density-preview="comfortable"');
        expect(markup).toContain('Building a tiny server for the weekend');
    });
});

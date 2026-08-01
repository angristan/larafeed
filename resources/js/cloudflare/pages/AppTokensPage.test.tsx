import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { appTokenKeys } from '../queries/appTokens';
import { AppTokensPage } from './AppTokensPage';

type TokenMetadata = {
    readonly id: number;
    readonly name: string;
    readonly prefix: string;
    readonly scopes: readonly ('google-reader' | 'fever')[];
    readonly createdAt: number;
    readonly lastUsedAt: number | null;
    readonly expiresAt: number | null;
};

function makeQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
}

function renderPage(tokens?: readonly TokenMetadata[]): string {
    const queryClient = makeQueryClient();
    if (tokens !== undefined) {
        queryClient.setQueryData(appTokenKeys.list(), { tokens });
    }

    return renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
            <MantineProvider>
                <MemoryRouter>
                    <AppTokensPage />
                </MemoryRouter>
            </MantineProvider>
        </QueryClientProvider>,
    );
}

describe('AppTokensPage', () => {
    it('renders an accessible empty state and scoped creation controls', () => {
        const markup = renderPage([]);

        expect(markup).toContain('No app tokens');
        expect(markup).toContain('Token name');
        expect(markup).toContain('Allowed APIs');
        expect(markup).toContain('Google Reader');
        expect(markup).toContain('Fever');
    });

    it('renders token metadata without inventing or exposing plaintext', () => {
        const markup = renderPage([
            {
                id: 17,
                name: 'Phone reader',
                prefix: 'lf_app_abc',
                scopes: ['google-reader', 'fever'],
                createdAt: 1_900_000_000_000,
                lastUsedAt: null,
                expiresAt: null,
            },
        ]);

        expect(markup).toContain('Phone reader');
        expect(markup).toContain('lf_app_abc');
        expect(markup).toContain('Google Reader');
        expect(markup).toContain('Fever');
        expect(markup).toContain('Last used');
        expect(markup).toContain('Revoke');
        expect(markup).not.toContain('one-time-secret');
    });

    it('renders the loading state when metadata has not arrived', () => {
        expect(renderPage()).toContain('Loading app tokens');
    });
});

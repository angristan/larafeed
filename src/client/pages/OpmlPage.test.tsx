import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { opmlKeys } from '../queries/opml';
import { OpmlPage } from './OpmlPage';

describe('OpmlPage', () => {
    it('uses the legacy feeds.opml export filename', () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        queryClient.setQueryData(opmlKeys.list(), { imports: [] });

        const markup = renderToStaticMarkup(
            <QueryClientProvider client={queryClient}>
                <MantineProvider>
                    <MemoryRouter initialEntries={['/settings/opml']}>
                        <OpmlPage />
                    </MemoryRouter>
                </MantineProvider>
            </QueryClientProvider>,
        );

        expect(markup).toContain('href="/api/opml/export"');
        expect(markup).toContain('download="feeds.opml"');
        expect(markup).toContain('App tokens');
    });
});

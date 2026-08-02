import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { describeRouteError, NotFoundPage } from './RouteStatePage';

describe('route state pages', () => {
    it('describes ordinary and unknown route failures', () => {
        expect(describeRouteError(new Error('Network unavailable'))).toEqual({
            title: 'Something went wrong',
            message: 'Network unavailable',
        });
        expect(describeRouteError(null)).toEqual({
            title: 'Something went wrong',
            message: 'The page could not be loaded.',
        });
    });

    it('renders catch-all navigation actions', () => {
        const markup = renderToStaticMarkup(
            <MantineProvider>
                <MemoryRouter>
                    <NotFoundPage />
                </MemoryRouter>
            </MantineProvider>,
        );

        expect(markup).toContain('Page not found');
        expect(markup).toContain('Go back');
        expect(markup).toContain('Back to reader');
        expect(markup).toContain('href="/feeds"');
    });
});

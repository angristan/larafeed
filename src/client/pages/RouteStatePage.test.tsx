import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, UNSAFE_ErrorResponseImpl } from 'react-router';
import { describe, expect, it } from 'vitest';

import { describeRouteError, NotFoundPage } from './RouteStatePage';

describe('route state pages', () => {
    it('describes ordinary and unknown route failures', () => {
        expect(
            describeRouteError(new Error('private infrastructure detail')),
        ).toEqual({
            title: 'Something went wrong',
            message: 'The page could not be loaded.',
        });
        expect(describeRouteError(null)).toEqual({
            title: 'Something went wrong',
            message: 'The page could not be loaded.',
        });
        expect(
            describeRouteError(
                new UNSAFE_ErrorResponseImpl(
                    500,
                    'private infrastructure detail',
                    null,
                ),
            ),
        ).toEqual({
            title: 'Request failed (500)',
            message: 'The request could not be completed.',
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

import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ColorSchemeControl } from './ColorSchemeControl';

describe('ColorSchemeControl', () => {
    it('renders an accessible system-aware preference control', () => {
        const markup = renderToStaticMarkup(
            <MantineProvider defaultColorScheme="auto">
                <ColorSchemeControl />
            </MantineProvider>,
        );

        expect(markup).toContain('aria-label="Color scheme"');
        expect(markup).toContain('value="auto"');
        expect(markup).toContain('System');
    });
});

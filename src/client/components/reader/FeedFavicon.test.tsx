import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FeedFavicon } from './FeedFavicon';

const render = (isDark: boolean | null) =>
    renderToStaticMarkup(
        <FeedFavicon isDark={isDark} src="/api/images/feeds/1/small" />,
    );

describe('FeedFavicon', () => {
    it('renders unknown darkness neutrally and reserves the contrast background for dark icons', () => {
        expect(render(null)).toBe(render(false));
        expect(render(true)).not.toBe(render(false));
    });
});

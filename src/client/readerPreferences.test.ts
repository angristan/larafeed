import { describe, expect, it } from 'vitest';

import {
    DEFAULT_FEED_LIST_DENSITY,
    parseFeedListDensity,
} from './readerPreferences';

describe('feed list density preference', () => {
    it.each(['compact', 'comfortable', 'spacious'] as const)(
        'accepts %s',
        (density) => {
            expect(parseFeedListDensity(density)).toBe(density);
        },
    );

    it.each([undefined, '', 'dense', '"compact"'])(
        'uses the default for invalid stored value %s',
        (value) => {
            expect(parseFeedListDensity(value)).toBe(DEFAULT_FEED_LIST_DENSITY);
        },
    );
});

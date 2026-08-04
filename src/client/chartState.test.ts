import { describe, expect, it } from 'vitest';

import { canonicalChartSearch, parseChartState } from './chartState';

const now = Date.parse('2026-07-18T12:00:00.000Z');

describe('chart URL state', () => {
    it('parses one scope and canonical custom dates', () => {
        const state = parseChartState(
            new URLSearchParams(
                'range=custom&start=2026-07-01&end=2026-07-18&feed=12&category=13',
            ),
            now,
        );

        expect(state).toEqual({
            range: 'custom',
            feedId: 12,
            categoryId: null,
            startDate: '2026-07-01',
            endDate: '2026-07-18',
        });
        expect(canonicalChartSearch(state)).toBe(
            'range=custom&feed=12&start=2026-07-01&end=2026-07-18',
        );
    });

    it('repairs unsafe values with bounded defaults', () => {
        expect(
            parseChartState(
                new URLSearchParams(
                    'range=custom&start=2025-01-01&end=2027-01-01&feed=-1&category=8',
                ),
                now,
            ),
        ).toEqual({
            range: 'custom',
            feedId: null,
            categoryId: 8,
            startDate: '2026-06-19',
            endDate: '2026-07-18',
        });
    });

    it('accepts legacy parameter names and emits one canonical form', () => {
        const legacy = new URLSearchParams(
            'range=custom&feedId=12&categoryId=13&startDate=2026-07-01&endDate=2026-07-18',
        );
        const canonical = canonicalChartSearch(parseChartState(legacy, now));

        expect(canonical).toBe(
            'range=custom&feed=12&start=2026-07-01&end=2026-07-18',
        );
        expect(
            canonicalChartSearch(
                parseChartState(new URLSearchParams(canonical), now),
            ),
        ).toBe(canonical);
    });

    it('prefers canonical names when legacy aliases are also present', () => {
        expect(
            parseChartState(
                new URLSearchParams('feed=4&feedId=9&categoryId=8'),
                now,
            ),
        ).toMatchObject({ feedId: 4, categoryId: null });
    });

    it('omits default range and all-subscription scope', () => {
        expect(
            canonicalChartSearch(
                parseChartState(new URLSearchParams('unknown=true'), now),
            ),
        ).toBe('');
    });
});

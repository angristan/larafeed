import { describe, expect, it } from 'vitest';

import {
    canonicalReaderRouteSearch,
    canonicalReaderSearch,
    parseReaderState,
    patchReaderState,
    readerHref,
} from './readerState';

describe('reader URL state', () => {
    it('canonicalizes invalid values and drops unknown parameters', () => {
        const search = new URLSearchParams(
            'feed=-1&category=nope&filter=invalid&order_by=title&page=10001&entry=2.5&extra=drop',
        );

        expect(parseReaderState(search)).toEqual({
            feedId: null,
            categoryId: null,
            filter: 'all',
            orderBy: 'published_at',
            page: 1,
            entryId: null,
        });
        expect(canonicalReaderSearch(search)).toBe(
            'filter=all&order_by=published_at&page=1',
        );
    });

    it('preserves bounded bookmarklet prefill while dropping other unknowns', () => {
        expect(
            canonicalReaderRouteSearch(
                new URLSearchParams(
                    'addFeedUrl=https%3A%2F%2Fexample.test%2Fnews&extra=drop',
                ),
            ),
        ).toBe(
            'filter=all&order_by=published_at&page=1&addFeedUrl=https%3A%2F%2Fexample.test%2Fnews',
        );
        expect(
            canonicalReaderRouteSearch(
                new URLSearchParams(`addFeedUrl=${'x'.repeat(2_049)}`),
            ),
        ).toBe('filter=all&order_by=published_at&page=1');
    });

    it('gives feed selection precedence over category selection', () => {
        const state = parseReaderState(
            new URLSearchParams(
                'feed=7&category=4&filter=all&order_by=created_at&page=2&entry=11',
            ),
        );

        expect(state).toMatchObject({ feedId: 7, categoryId: null });
        expect(
            canonicalReaderSearch(new URLSearchParams('feed=7&category=4')),
        ).toBe('feed=7&filter=all&order_by=published_at&page=1');
    });

    it('resets page and entry when list inputs change', () => {
        const current = parseReaderState(
            new URLSearchParams(
                'category=4&filter=unread&order_by=published_at&page=5&entry=11',
            ),
        );

        expect(patchReaderState(current, { feedId: 7 })).toEqual({
            feedId: 7,
            categoryId: null,
            filter: 'unread',
            orderBy: 'published_at',
            page: 1,
            entryId: null,
        });
        expect(readerHref(current, { filter: 'favorites' })).toBe(
            '/feeds?category=4&filter=favorites&order_by=published_at&page=1',
        );
    });

    it('keeps list inputs when only the selected entry changes', () => {
        const current = parseReaderState(
            new URLSearchParams(
                'feed=7&filter=read&order_by=created_at&page=3&entry=11',
            ),
        );

        expect(patchReaderState(current, { entryId: 12 })).toEqual({
            ...current,
            entryId: 12,
        });
        expect(patchReaderState(current, { entryId: null })).toEqual({
            ...current,
            entryId: null,
        });
    });
});

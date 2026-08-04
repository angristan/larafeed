import { describe, expect, it } from 'vitest';

import {
    compileFilterRules,
    isSafeFilterPattern,
    matchesSubscriptionFilter,
    parseStoredFilterRules,
    serializeFilterRules,
} from './filter';

const candidate = {
    title: 'Cloudflare Workers update',
    author: 'Stanislas',
    contentHtml: '<p>PostgreSQL migration details</p>',
};

const matchesTitle = (pattern: string, title: string): boolean =>
    matchesSubscriptionFilter(
        { title, author: null, contentHtml: null },
        compileFilterRules({
            excludeTitle: [pattern],
            excludeContent: [],
            excludeAuthor: [],
        }),
    );

describe('subscription filters', () => {
    it('supports legacy case-insensitive regex matching across all fields', () => {
        const titleRules = compileFilterRules({
            excludeTitle: ['^cloud(flar|front)e?\\s+[a-z]+\\s+update$'],
            excludeContent: [],
            excludeAuthor: [],
        });
        const contentRules = compileFilterRules({
            excludeTitle: [],
            excludeContent: ['PostgreSQL|MySQL'],
            excludeAuthor: [],
        });
        const authorRules = compileFilterRules({
            excludeTitle: [],
            excludeContent: [],
            excludeAuthor: ['stani.*'],
        });

        expect(matchesSubscriptionFilter(candidate, titleRules)).toBe(true);
        expect(matchesSubscriptionFilter(candidate, contentRules)).toBe(true);
        expect(matchesSubscriptionFilter(candidate, authorRules)).toBe(true);
    });

    it('supports anchors, classes, ranges, and all bounded quantifiers', () => {
        expect(matchesTitle('^v[0-9]{2,4}\\.[0-9]$', 'v2025.3')).toBe(true);
        expect(matchesTitle('^ab?c*d+$', 'acddd')).toBe(true);
        expect(matchesTitle('^(news|release){1,2}$', 'NewsRelease')).toBe(true);
        expect(matchesTitle('^v[0-9]{2,4}\\.[0-9]$', 'prefix v2025.3')).toBe(
            false,
        );
    });

    it('falls back to case-insensitive literal matching for invalid syntax', () => {
        expect(matchesTitle('[migration', 'Notes about [MIGRATION today')).toBe(
            true,
        );
        expect(matchesTitle('(?=sponsor)', 'Literal (?=SPONSOR) marker')).toBe(
            true,
        );
        expect(matchesTitle('(post)\\1', 'Literal (POST)\\1 marker')).toBe(
            true,
        );
        expect(matchesTitle('[migration', 'Migration without bracket')).toBe(
            false,
        );
    });

    it('matches Unicode literals without splitting astral code points', () => {
        expect(matchesTitle('^(café|東京|😀)+$', 'CAFÉ東京😀')).toBe(true);
        expect(matchesTitle('^.$', '😀')).toBe(true);
        expect(matchesTitle('^.$', '😀😀')).toBe(false);
    });

    it('evaluates ambiguous repetitions in linear time', () => {
        const nearMiss = `${'a'.repeat(50_000)}!`;
        expect(matchesTitle('^(a|aa)+$', nearMiss)).toBe(false);
        expect(matchesTitle('^(a+)+$', nearMiss)).toBe(false);
    });

    it('accepts safely evaluated or literal-fallback patterns within limits', () => {
        expect(isSafeFilterPattern('(a+)+')).toBe(true);
        expect(isSafeFilterPattern('(a)\\1')).toBe(true);
        expect(isSafeFilterPattern('')).toBe(false);
        expect(isSafeFilterPattern('a'.repeat(201))).toBe(false);
    });

    it('reads legacy snake-case JSON and preserves meaningful whitespace', () => {
        const rules = parseStoredFilterRules(
            JSON.stringify({
                exclude_title: ['', 'sponsor'],
                exclude_content: [' paid advert '],
                exclude_author: [],
            }),
        );

        expect(rules).toEqual({
            excludeTitle: ['sponsor'],
            excludeContent: [' paid advert '],
            excludeAuthor: [],
        });
        expect(serializeFilterRules(rules)).toBe(
            '{"exclude_title":["sponsor"],"exclude_content":[" paid advert "],"exclude_author":[]}',
        );
        expect(
            serializeFilterRules({
                excludeTitle: [],
                excludeContent: [],
                excludeAuthor: [],
            }),
        ).toBeNull();
    });
});

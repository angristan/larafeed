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

describe('subscription filters', () => {
    it('supports case-insensitive regex and invalid-regex literal fallback', () => {
        const regex = compileFilterRules({
            excludeTitle: ['workers\\s+update'],
            excludeContent: [],
            excludeAuthor: [],
        });
        const literal = compileFilterRules({
            excludeTitle: [],
            excludeContent: ['[migration'],
            excludeAuthor: [],
        });

        expect(matchesSubscriptionFilter(candidate, regex)).toBe(true);
        expect(
            matchesSubscriptionFilter(
                { ...candidate, contentHtml: 'Notes about [MIGRATION today' },
                literal,
            ),
        ).toBe(true);
    });

    it('rejects nested quantifiers and backreferences', () => {
        expect(isSafeFilterPattern('(a+)+')).toBe(false);
        expect(isSafeFilterPattern('(a*){2,}')).toBe(false);
        expect(isSafeFilterPattern('(a)\\1')).toBe(false);
        expect(isSafeFilterPattern('cloud(flar|front)')).toBe(true);
    });

    it('reads legacy snake-case JSON and writes a canonical sparse value', () => {
        const rules = parseStoredFilterRules(
            JSON.stringify({
                exclude_title: ['sponsor'],
                exclude_content: ['advert'],
                exclude_author: [],
            }),
        );

        expect(rules).toEqual({
            excludeTitle: ['sponsor'],
            excludeContent: ['advert'],
            excludeAuthor: [],
        });
        expect(serializeFilterRules(rules)).toBe(
            '{"exclude_title":["sponsor"],"exclude_content":["advert"],"exclude_author":[]}',
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

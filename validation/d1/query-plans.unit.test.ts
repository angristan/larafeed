import { describe, expect, it } from 'vitest';

import { planUsesRequiredIndexes } from './query-plans';

describe('D1 query plan assertions', () => {
    it('requires every named index', () => {
        const details = [
            'SEARCH fs USING COVERING INDEX feed_subscriptions_user_category',
            'SEARCH e USING COVERING INDEX entries_feed_published',
        ];
        expect(
            planUsesRequiredIndexes(details, [
                'feed_subscriptions_user_category',
                'entries_feed_published',
            ]),
        ).toBe(true);
        expect(
            planUsesRequiredIndexes(details, [
                'feed_subscriptions_user_category',
                'entries_published_global',
            ]),
        ).toBe(false);
    });

    it('does not accept a similarly named missing index', () => {
        expect(
            planUsesRequiredIndexes(
                ['SEARCH entries USING INDEX entries_feed_created'],
                ['entries_feed_published'],
            ),
        ).toBe(false);
    });
});

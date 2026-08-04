import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { SubscriptionManagementResponse } from './subscriptions';

const decode = Schema.decodeUnknownSync(SubscriptionManagementResponse);

describe('subscription management schema', () => {
    it('accepts imported category names through 255 characters', () => {
        const name = 'x'.repeat(255);

        expect(
            decode({
                categories: [{ id: 1, name, subscriptionCount: 0 }],
                subscriptions: [],
            }).categories[0]?.name,
        ).toBe(name);
    });

    it('rejects category names above the storage contract', () => {
        expect(() =>
            decode({
                categories: [
                    { id: 1, name: 'x'.repeat(256), subscriptionCount: 0 },
                ],
                subscriptions: [],
            }),
        ).toThrow();
    });
});

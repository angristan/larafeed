import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
    CreateSubscriptionResponse,
    SubscriptionManagementResponse,
} from './subscriptions';

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

    it('accepts two to four feed-selection candidates', () => {
        const decodeCreation = Schema.decodeUnknownSync(
            CreateSubscriptionResponse,
        );
        const candidate = (index: number) => ({
            title: `Feed ${index}`,
            feedUrl: `https://example.com/feed-${index}.xml`,
            siteUrl: 'https://example.com/',
            identicalTo: [],
        });

        expect(
            decodeCreation({
                kind: 'selection_required',
                candidates: [candidate(1), candidate(2)],
            }),
        ).toMatchObject({ kind: 'selection_required' });
        expect(() =>
            decodeCreation({
                kind: 'selection_required',
                candidates: [candidate(1)],
            }),
        ).toThrow();
        expect(() =>
            decodeCreation({
                kind: 'selection_required',
                candidates: Array.from({ length: 5 }, (_, index) =>
                    candidate(index),
                ),
            }),
        ).toThrow();
    });
});

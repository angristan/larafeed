import type { SpotlightActionData } from '@mantine/spotlight';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { ReaderSubscriptionList } from '../api/reader';
import {
    subscriptionKeys,
    subscriptionListQueryOptions,
} from '../queries/reader';
import { filterFeedActions, selectSpotlightFeeds } from './FeedSpotlight';

const subscription = (
    feedId: number,
    feedName: string,
    customFeedName: string | null = null,
) => ({
    feedId,
    categoryId: 1,
    feedName,
    customFeedName,
    faviconUrl: null,
    faviconIsDark: null,
    totalCount: 10,
    unreadCount: 2,
});

describe('FeedSpotlight', () => {
    it('ranks label matches before description matches', () => {
        const actions: SpotlightActionData[] = [
            { id: 'a', label: 'Daily digest', description: 'Rust weekly' },
            { id: 'b', label: 'Rust blog' },
            { id: 'c', label: 'Go news' },
        ];

        expect(filterFeedActions('  RUST ', actions)).toEqual([
            actions[1],
            actions[0],
        ]);
        expect(filterFeedActions('', actions)).toBe(actions);
    });

    it('keeps its selection when only an unread count changes', () => {
        const queryClient = new QueryClient();
        const data: ReaderSubscriptionList = {
            subscriptions: [
                subscription(1, 'Rust blog'),
                subscription(2, 'Go news', 'Go'),
            ],
        };
        queryClient.setQueryData(subscriptionKeys.list(), data);
        const observer = new QueryObserver(queryClient, {
            ...subscriptionListQueryOptions,
            select: selectSpotlightFeeds,
            enabled: false,
        });
        const unsubscribe = observer.subscribe(() => undefined);
        const before = observer.getCurrentResult().data;
        expect(before?.[1]).toMatchObject({
            label: 'Go',
            description: 'Go news',
        });

        queryClient.setQueryData(subscriptionKeys.list(), {
            subscriptions: data.subscriptions.map((item) =>
                item.feedId === 1 ? { ...item, unreadCount: 1 } : item,
            ),
        });

        expect(observer.getCurrentResult().data).toBe(before);
        unsubscribe();
    });
});

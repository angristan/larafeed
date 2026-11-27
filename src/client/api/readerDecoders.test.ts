import { replaceEqualDeep } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
    decodeReaderEntry,
    decodeReaderEntryPage,
    decodeReaderSubscriptionList,
} from './readerDecoders';

const subscription = (feedId: number, unreadCount: number) => ({
    feedId,
    categoryId: 3,
    feedName: `Feed ${feedId}`,
    customFeedName: null,
    faviconUrl: null,
    faviconIsDark: null,
    totalCount: 20,
    unreadCount,
});

const entry = (id: number, read: boolean) => ({
    id,
    feedId: 8,
    title: `Entry ${id}`,
    url: null,
    author: null,
    publishedAt: 1_900_000_000_000,
    createdAt: 1_900_000_000_000,
    feedName: 'Feed 8',
    customFeedName: null,
    faviconUrl: null,
    faviconIsDark: null,
    read,
    starred: false,
    archived: false,
});

// TanStack Query runs replaceEqualDeep(previous, next) on every refetch.
// It only keeps references for plain objects and arrays, so the decoded
// data must not be class instances.
describe('reader decoders', () => {
    it('keeps every reference when a refetch returns the same subscriptions', async () => {
        const body = {
            subscriptions: [subscription(1, 2), subscription(2, 0)],
        };
        const first = await decodeReaderSubscriptionList({ body, status: 200 });
        const second = await decodeReaderSubscriptionList({
            body: structuredClone(body),
            status: 200,
        });

        expect(replaceEqualDeep(first, second)).toBe(first);
    });

    it('replaces only the subscription that changed', async () => {
        const first = await decodeReaderSubscriptionList({
            body: { subscriptions: [subscription(1, 2), subscription(2, 0)] },
            status: 200,
        });
        const second = await decodeReaderSubscriptionList({
            body: { subscriptions: [subscription(1, 1), subscription(2, 0)] },
            status: 200,
        });

        const shared = replaceEqualDeep(first, second);
        expect(shared).not.toBe(first);
        expect(shared.subscriptions[0]).toEqual(second.subscriptions[0]);
        expect(shared.subscriptions[1]).toBe(first.subscriptions[1]);
    });

    it('keeps unchanged entry rows across a page refetch', async () => {
        const page = (secondRead: boolean) => ({
            entries: [entry(1, false), entry(2, secondRead)],
            total: 2,
            nextCursor: null,
        });
        const first = await decodeReaderEntryPage({
            body: page(false),
            status: 200,
        });
        const second = await decodeReaderEntryPage({
            body: page(true),
            status: 200,
        });

        const shared = replaceEqualDeep(first, second);
        expect(shared.entries[0]).toBe(first.entries[0]);
        expect(shared.entries[1]?.read).toBe(true);
    });

    it('keeps the entry detail reference when nothing changed', async () => {
        const body = {
            ...entry(1, true),
            contentHtml: '<p>Hello</p>',
            readChangedAt: 1_900_000_000_000,
            starredAt: null,
            archivedAt: null,
        };
        const first = await decodeReaderEntry({ body, status: 200 });
        const second = await decodeReaderEntry({
            body: structuredClone(body),
            status: 200,
        });

        expect(replaceEqualDeep(first, second)).toBe(first);
    });
});

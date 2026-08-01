import type {
    CompatibilityEntry,
    CompatibilitySubscription,
} from './repository';

const GOOGLE_ITEM_PREFIX = 'tag:google.com,2005:reader/item/';

export const parseCompatibilityItemId = (value: string): number | null => {
    let candidate = value.trim();
    let radix = 10;
    if (candidate.startsWith(GOOGLE_ITEM_PREFIX)) {
        candidate = candidate.slice(GOOGLE_ITEM_PREFIX.length);
        radix = 16;
    } else if (/^0x[0-9a-f]+$/iu.test(candidate)) {
        candidate = candidate.slice(2);
        radix = 16;
    } else if (/^[0-9a-f]*[a-f][0-9a-f]*$/iu.test(candidate)) {
        radix = 16;
    }
    if (
        candidate.length === 0 ||
        (radix === 10
            ? !/^\d+$/u.test(candidate)
            : !/^[0-9a-f]+$/iu.test(candidate))
    ) {
        return null;
    }
    const parsed = Number.parseInt(candidate, radix);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const googleItemTag = (id: number): string =>
    `${GOOGLE_ITEM_PREFIX}${id.toString(16).padStart(16, '0')}`;

export const googleEntry = (userId: number, entry: CompatibilityEntry) => {
    const categories = [`user/${userId}/state/com.google/reading-list`];
    if (entry.read) categories.push(`user/${userId}/state/com.google/read`);
    if (entry.starredAt !== null) {
        categories.push(`user/${userId}/state/com.google/starred`);
    }
    const publishedSeconds = Math.floor(entry.publishedAt / 1_000);

    return {
        id: googleItemTag(entry.id),
        title: entry.title,
        timestampUsec: String(entry.publishedAt * 1_000),
        crawlTimeMsec: String(entry.publishedAt),
        published: publishedSeconds,
        updated: Math.floor(entry.updatedAt / 1_000),
        alternate: [{ href: entry.url, type: 'text/html' }],
        content: { direction: 'ltr', content: entry.contentHtml },
        origin: { streamId: `feed/${entry.feedId}`, title: entry.feedName },
        categories,
        canonical: [{ href: entry.url }],
        ...(entry.author === '' ? {} : { author: entry.author }),
    };
};

export const googleSubscription = (
    userId: number,
    subscription: CompatibilitySubscription,
) => ({
    id: `feed/${subscription.feedId}`,
    url: subscription.feedUrl,
    htmlUrl: subscription.siteUrl,
    title: subscription.title,
    categories: [
        {
            id: `user/${userId}/label/${subscription.categoryName}`,
            label: subscription.categoryName,
            type: 'folder',
        },
    ],
    iconUrl: subscription.faviconUrl,
});

export const feverItem = (entry: CompatibilityEntry) => ({
    id: entry.id,
    feed_id: entry.feedId,
    title: entry.title,
    author: entry.author,
    html: entry.contentHtml,
    url: entry.url,
    is_saved: entry.starredAt === null ? 0 : 1,
    is_read: entry.read ? 1 : 0,
    created_on_time: Math.floor(entry.publishedAt / 1_000),
});

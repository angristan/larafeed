import { env } from 'cloudflare:workers';

/**
 * A small reader library with every kind of entry state: read-through
 * watermarks set directly and by later inserts, explicit read and unread
 * overrides on both sides of a watermark, filtered entries with and
 * without overrides, stars, archives, a second user sharing some feeds,
 * and equal timestamps that only the entry ID orders.
 *
 * User 1 follows feeds 1-20: 1-18 in category 10, 19-20 in category 11.
 * User 2 follows feeds 1-5 in category 20.
 */
export const READER_FIXTURE = {
    now: 1_800_000_000_000,
    users: [1, 2],
    bigCategory: 10,
    smallCategory: 11,
    otherUserCategory: 20,
    feeds: 20,
} as const;

const bytes = (value: number) => {
    const key = new Uint8Array(32);
    new DataView(key.buffer).setUint32(0, value);
    key[31] = 1;
    return key;
};

const run = (sql: string, ...bindings: unknown[]) =>
    env.DB.prepare(sql)
        .bind(...bindings)
        .run();

const batch = async (sql: string, rows: readonly unknown[][]) => {
    for (let start = 0; start < rows.length; start += 50) {
        await env.DB.batch(
            rows
                .slice(start, start + 50)
                .map((row) => env.DB.prepare(sql).bind(...row)),
        );
    }
};

const entriesPerFeed = (feedId: number) => ((feedId * 7) % 23) + 3;

export const insertFixtureEntries = (
    feedIds: readonly number[],
    firstId: number,
) => {
    const { now } = READER_FIXTURE;
    const rows: unknown[][] = [];
    let id = firstId;
    for (const feedId of feedIds) {
        for (let index = 0; index < entriesPerFeed(feedId); index += 1) {
            // Coarse timestamps make many entries share one, so the ID
            // tie-break matters for ordering and cursors.
            const publishedAt = now - ((id * 37) % 41) * 3_600_000;
            const createdAt = now - ((id * 11) % 17) * 60_000;
            rows.push([
                id,
                feedId,
                bytes(id),
                `Entry ${id}`,
                publishedAt,
                createdAt,
                createdAt,
            ]);
            id += 1;
        }
    }
    return batch(
        `INSERT INTO entries (
            id, feed_id, deduplication_key, title, published_at,
            content_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'empty', ?, ?)`,
        rows,
    ).then(() => id);
};

export const seedReaderFixture = async (): Promise<void> => {
    const { now, feeds } = READER_FIXTURE;
    for (const userId of READER_FIXTURE.users) {
        await run(
            `INSERT INTO users (
                id, webauthn_user_handle, username, email, display_name,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            userId,
            bytes(userId),
            `user-${userId}`,
            `user-${userId}@example.test`,
            `User ${userId}`,
            now,
            now,
        );
    }
    for (const [id, userId] of [
        [10, 1],
        [11, 1],
        [20, 2],
    ]) {
        await run(
            `INSERT INTO subscription_categories (id, user_id, name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
            id,
            userId,
            `Category ${id}`,
            now,
            now,
        );
    }
    const feedIds = Array.from({ length: feeds }, (_, index) => index + 1);
    await batch(
        `INSERT INTO feeds (id, name, feed_url, next_refresh_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        feedIds.map((id) => [
            id,
            `Feed ${id}`,
            `https://feeds.example.test/${id}.xml`,
            now,
            now,
            now,
        ]),
    );
    await batch(
        `INSERT INTO feed_subscriptions (user_id, feed_id, category_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
            ...feedIds.map((id) => [1, id, id <= 18 ? 10 : 11, now, now]),
            ...feedIds.slice(0, 5).map((id) => [2, id, 20, now, now]),
        ],
    );
    const nextId = await insertFixtureEntries(feedIds, 1_000);

    // Watermarks in the middle of every third feed, written directly.
    await run(
        `UPDATE feed_subscriptions SET read_through_entry_id = (
            SELECT id FROM entries e WHERE e.feed_id = feed_subscriptions.feed_id
            ORDER BY id LIMIT 1 OFFSET 2)
         WHERE user_id = 1 AND feed_id % 3 = 0`,
    );
    await run(
        `UPDATE feed_subscriptions SET read_through_entry_id = (
            SELECT MAX(id) FROM entries e WHERE e.feed_id = feed_subscriptions.feed_id)
         WHERE user_id = 2 AND feed_id = 1`,
    );

    // One sparse row per entry, combining states by ID.
    const interactions: unknown[][] = [];
    const { results } = await env.DB.prepare(
        `SELECT fs.user_id, e.feed_id, e.id
         FROM entries e JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
         ORDER BY fs.user_id, e.id`,
    ).all<{ user_id: number; feed_id: number; id: number }>();
    for (const { user_id: userId, feed_id: feedId, id } of results) {
        const salt = id + userId * 3;
        const readOverride = salt % 5 === 0 ? 1 : salt % 7 === 0 ? 0 : null;
        const filteredAt = salt % 11 === 0 ? now : null;
        const starredAt = salt % 4 === 0 ? now - id : null;
        const archivedAt = salt % 13 === 0 ? now : null;
        if (
            readOverride === null &&
            filteredAt === null &&
            starredAt === null &&
            archivedAt === null
        ) {
            continue;
        }
        interactions.push([
            userId,
            feedId,
            id,
            readOverride,
            readOverride === null ? null : now,
            starredAt,
            archivedAt,
            filteredAt,
            now,
            now,
        ]);
    }
    await batch(
        `INSERT INTO entry_interactions (
            user_id, feed_id, entry_id, read_override, read_changed_at,
            starred_at, archived_at, filtered_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        interactions,
    );

    // Entries that arrive after the watermarks were set.
    await insertFixtureEntries([3, 6, 19], nextId);
};

const effectiveRead = `CASE
    WHEN ei.read_override IS NOT NULL THEN ei.read_override
    WHEN fs.read_through_entry_id IS NOT NULL AND e.id <= fs.read_through_entry_id THEN 1
    ELSE 0 END`;

/** Per-subscription counts computed the slow way, from every entry. */
export const referenceSubscriptionCounts = async (userId: number) => {
    const { results } = await env.DB.prepare(
        `SELECT fs.feed_id, fs.category_id,
            COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND ei.filtered_at IS NULL
                THEN 1 ELSE 0 END), 0) AS total,
            COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND ei.filtered_at IS NULL
                AND ${effectiveRead} = 0 THEN 1 ELSE 0 END), 0) AS unread,
            COALESCE(SUM(CASE WHEN ei.filtered_at IS NULL
                AND ei.starred_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS starred
         FROM feed_subscriptions fs
         LEFT JOIN entries e ON e.feed_id = fs.feed_id
         LEFT JOIN entry_interactions ei
           ON ei.user_id = fs.user_id AND ei.entry_id = e.id
         WHERE fs.user_id = ?
         GROUP BY fs.feed_id ORDER BY fs.feed_id`,
    )
        .bind(userId)
        .all<{
            feed_id: number;
            category_id: number;
            total: number;
            unread: number;
            starred: number;
        }>();
    return results;
};

/** Every visible entry of a scope, in list order, the slow way. */
export const referenceEntryIds = async (
    userId: number,
    scope: {
        readonly column: 'feed_id' | 'category_id';
        readonly id: number;
    } | null,
    filter: 'all' | 'unread' | 'read' | 'favorites',
    orderBy: 'published_at' | 'created_at',
): Promise<number[]> => {
    const filterSql =
        filter === 'unread'
            ? `${effectiveRead} = 0`
            : filter === 'read'
              ? `${effectiveRead} = 1`
              : filter === 'favorites'
                ? 'ei.starred_at IS NOT NULL'
                : '1 = 1';
    const { results } = await env.DB.prepare(
        `SELECT e.id FROM entries e
         JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
         LEFT JOIN entry_interactions ei
           ON ei.user_id = fs.user_id AND ei.entry_id = e.id
         WHERE fs.user_id = ? ${scope === null ? '' : `AND fs.${scope.column} = ${scope.id}`}
           AND ei.filtered_at IS NULL AND ${filterSql}
         ORDER BY e.${orderBy} DESC, e.id DESC`,
    )
        .bind(userId)
        .all<{ id: number }>();
    return results.map(({ id }) => id);
};

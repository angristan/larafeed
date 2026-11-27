import { Effect, Schema } from 'effect';

import type { D1, D1OperationError, D1Statement } from '../infrastructure/d1';
import { subscriptionCountsSql } from '../reader/counts';
import {
    makeReaderRepository,
    type ReaderRepository,
} from '../reader/repository';
import {
    CompatibilityInvariantError,
    CompatibilityStorageError,
} from './errors';

export const MAX_COMPAT_CATEGORIES = 500;
export const MAX_COMPAT_SUBSCRIPTIONS = 2_000;
export const MAX_COMPAT_ITEM_IDS = 10_000;
// NetNewsWire requests item contents in batches of 150 IDs.
export const MAX_GOOGLE_CONTENT_ITEMS = 150;
export const MAX_FEVER_ITEMS = 50;

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const BooleanInt = Schema.Literals([0, 1]);
const NullableTimestamp = Schema.NullOr(Timestamp);

const ProfileRow = Schema.Struct({
    id: SafeId,
    username: Schema.String,
    email: Schema.String,
    display_name: Schema.String,
});
const CategoryRow = Schema.Struct({ id: SafeId, name: Schema.String });
const SubscriptionRow = Schema.Struct({
    feed_id: SafeId,
    category_id: SafeId,
    category_name: Schema.String,
    feed_name: Schema.String,
    custom_feed_name: Schema.NullOr(Schema.String),
    feed_url: Schema.String,
    site_url: Schema.NullOr(Schema.String),
    favicon_url: Schema.NullOr(Schema.String),
    last_successful_refresh_at: NullableTimestamp,
});
const IdRow = Schema.Struct({ id: SafeId });
const EntryRow = Schema.Struct({
    id: SafeId,
    feed_id: SafeId,
    title: Schema.String,
    url: Schema.NullOr(Schema.String),
    author: Schema.NullOr(Schema.String),
    published_at: Timestamp,
    updated_at: Timestamp,
    feed_name: Schema.String,
    custom_feed_name: Schema.NullOr(Schema.String),
    content_html: Schema.NullOr(Schema.String),
    is_read: BooleanInt,
    starred_at: NullableTimestamp,
});
const TotalRow = Schema.Struct({ total: Schema.Int });

export interface CompatibilityProfile {
    readonly id: number;
    readonly username: string;
    readonly email: string;
    readonly displayName: string;
}

export interface CompatibilityCategory {
    readonly id: number;
    readonly name: string;
}

export interface CompatibilitySubscription {
    readonly feedId: number;
    readonly categoryId: number;
    readonly categoryName: string;
    readonly title: string;
    readonly feedUrl: string;
    readonly siteUrl: string;
    readonly faviconUrl: string;
    readonly lastSuccessfulRefreshAt: number | null;
}

export interface CompatibilityEntry {
    readonly id: number;
    readonly feedId: number;
    readonly title: string;
    readonly url: string;
    readonly author: string;
    readonly publishedAt: number;
    readonly updatedAt: number;
    readonly feedName: string;
    readonly contentHtml: string;
    readonly read: boolean;
    readonly starredAt: number | null;
}

export type CompatibilityItemIdFilter = 'all' | 'unread' | 'starred';

/** Bounds on ingestion time in epoch milliseconds: inclusive `from`, exclusive `to`. */
export interface CompatibilityItemIdBounds {
    readonly createdFrom?: number;
    readonly createdBefore?: number;
}

export interface FeverItemCursor {
    readonly sinceId?: number;
    readonly maxId?: number;
}

export interface FeverItemPage {
    readonly entries: readonly CompatibilityEntry[];
    readonly total: number;
}

export interface CompatibilityRepository {
    readonly getProfile: (
        userId: number,
    ) => Effect.Effect<
        CompatibilityProfile,
        CompatibilityStorageError | CompatibilityInvariantError
    >;
    readonly listCategories: (
        userId: number,
    ) => Effect.Effect<
        readonly CompatibilityCategory[],
        CompatibilityStorageError | CompatibilityInvariantError
    >;
    readonly listSubscriptions: (
        userId: number,
    ) => Effect.Effect<
        readonly CompatibilitySubscription[],
        CompatibilityStorageError | CompatibilityInvariantError
    >;
    readonly listItemIds: (
        userId: number,
        filter: CompatibilityItemIdFilter,
        limit?: number,
        bounds?: CompatibilityItemIdBounds,
    ) => Effect.Effect<
        readonly number[],
        CompatibilityStorageError | CompatibilityInvariantError
    >;
    readonly findEntries: (
        userId: number,
        entryIds: readonly number[],
    ) => Effect.Effect<
        readonly CompatibilityEntry[],
        CompatibilityStorageError | CompatibilityInvariantError
    >;
    readonly listFeverItems: (
        userId: number,
        cursor: FeverItemCursor,
    ) => Effect.Effect<
        FeverItemPage,
        CompatibilityStorageError | CompatibilityInvariantError
    >;
    readonly setRead: ReaderRepository['setRead'];
    readonly setStarred: ReaderRepository['setStarred'];
    readonly setReadMany: ReaderRepository['setReadMany'];
    readonly setStarredMany: ReaderRepository['setStarredMany'];
}

const effectiveRead = `CASE
    WHEN ei.read_override IS NOT NULL THEN ei.read_override
    WHEN fs.read_through_entry_id IS NOT NULL AND e.id <= fs.read_through_entry_id THEN 1
    ELSE 0 END`;
const entryColumns = `
    e.id, e.feed_id, e.title, e.url, e.author, e.published_at, e.updated_at,
    f.name AS feed_name, fs.custom_feed_name, ec.content_html,
    ${effectiveRead} AS is_read, ei.starred_at`;
const ownedVisibleEntries = `
    FROM entries e
    JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = ?
    JOIN feeds f ON f.id = e.feed_id
    LEFT JOIN entry_interactions ei
        ON ei.user_id = fs.user_id AND ei.entry_id = e.id`;

const boundsSql = (
    bounds: CompatibilityItemIdBounds,
): { readonly clause: string; readonly bindings: readonly number[] } => ({
    clause: [
        bounds.createdFrom === undefined ? '' : ' AND e.created_at >= ?',
        bounds.createdBefore === undefined ? '' : ' AND e.created_at < ?',
    ].join(''),
    bindings: [
        ...(bounds.createdFrom === undefined ? [] : [bounds.createdFrom]),
        ...(bounds.createdBefore === undefined ? [] : [bounds.createdBefore]),
    ],
});

/**
 * The newest visible entry IDs. Each filter starts from the rows that can
 * match instead of every entry: the newest entries for `all`, the
 * starred interactions for `starred`, and for `unread` the entries above
 * each read-through watermark plus the explicit unread overrides below it.
 */
const itemIdsStatement = (
    userId: number,
    filter: CompatibilityItemIdFilter,
    limit: number,
    bounds: CompatibilityItemIdBounds,
): D1Statement => {
    const bounded = boundsSql(bounds);
    switch (filter) {
        case 'all':
            // CROSS JOIN walks entries from the newest ID and stops at
            // the limit.
            return {
                sql: `SELECT e.id
                    FROM entries e
                    CROSS JOIN feed_subscriptions fs
                      ON fs.feed_id = e.feed_id AND fs.user_id = ?
                    LEFT JOIN entry_interactions ei
                      ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                    WHERE ei.filtered_at IS NULL${bounded.clause}
                    ORDER BY e.id DESC LIMIT ?`,
                bindings: [userId, ...bounded.bindings, limit],
            };
        case 'starred':
            return {
                sql: `SELECT e.id
                    FROM entry_interactions ei
                    JOIN feed_subscriptions fs
                      ON fs.user_id = ei.user_id AND fs.feed_id = ei.feed_id
                    JOIN entries e ON e.id = ei.entry_id
                    WHERE ei.user_id = ? AND ei.starred_at IS NOT NULL
                      AND ei.filtered_at IS NULL${bounded.clause}
                    ORDER BY e.id DESC LIMIT ?`,
                bindings: [userId, ...bounded.bindings, limit],
            };
        case 'unread':
            return {
                sql: `SELECT id FROM (
                        SELECT e.id AS id
                        FROM feed_subscriptions fs
                        JOIN entries e ON e.feed_id = fs.feed_id
                          AND e.id > COALESCE(fs.read_through_entry_id, 0)
                        LEFT JOIN entry_interactions ei
                          ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                        WHERE fs.user_id = ? AND ei.filtered_at IS NULL
                          AND COALESCE(ei.read_override, 0) = 0${bounded.clause}
                        UNION ALL
                        SELECT e.id
                        FROM entry_interactions ei
                        JOIN feed_subscriptions fs
                          ON fs.user_id = ei.user_id AND fs.feed_id = ei.feed_id
                        JOIN entries e ON e.id = ei.entry_id
                        WHERE ei.user_id = ? AND ei.read_override = 0
                          AND ei.filtered_at IS NULL
                          AND ei.entry_id <= COALESCE(fs.read_through_entry_id, 0)${bounded.clause}
                    )
                    ORDER BY id DESC LIMIT ?`,
                bindings: [
                    userId,
                    ...bounded.bindings,
                    userId,
                    ...bounded.bindings,
                    limit,
                ],
            };
    }
};

const invariant = (operation: string) =>
    new CompatibilityInvariantError({ operation });
const withStorage = <A, R>(
    operation: string,
    effect: Effect.Effect<A, D1OperationError, R>,
): Effect.Effect<A, CompatibilityStorageError, R> =>
    effect.pipe(
        Effect.mapError(
            (cause) => new CompatibilityStorageError({ operation, cause }),
        ),
    );
const decode = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    value: unknown,
): Effect.Effect<S['Type'], CompatibilityInvariantError> =>
    Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(value),
        catch: () => invariant(operation),
    });
const decodeRows = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    values: readonly unknown[],
): Effect.Effect<readonly S['Type'][], CompatibilityInvariantError> =>
    Effect.forEach(values, (value) => decode(operation, schema, value));

const entryFromRow = (row: typeof EntryRow.Type): CompatibilityEntry => ({
    id: row.id,
    feedId: row.feed_id,
    title: row.title,
    url: row.url ?? '',
    author: row.author ?? '',
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    feedName: row.custom_feed_name ?? row.feed_name,
    contentHtml: row.content_html ?? '',
    read: row.is_read === 1,
    starredAt: row.starred_at,
});

export const makeCompatibilityRepository = (
    d1: D1,
): CompatibilityRepository => {
    const reader = makeReaderRepository(d1);

    return {
        getProfile: (userId) =>
            Effect.gen(function* () {
                const operation = 'compat.profile.get';
                const value = yield* withStorage(
                    operation,
                    d1.first({
                        sql: `SELECT id, username, email, display_name
                            FROM users WHERE id = ? AND disabled_at IS NULL`,
                        bindings: [userId],
                    }),
                );
                if (value === null)
                    return yield* Effect.fail(invariant(operation));
                const row = yield* decode(operation, ProfileRow, value);
                return {
                    id: row.id,
                    username: row.username,
                    email: row.email,
                    displayName: row.display_name,
                };
            }),

        listCategories: (userId) =>
            Effect.gen(function* () {
                const operation = 'compat.categories.list';
                const result = yield* withStorage(
                    operation,
                    d1.all({
                        sql: `SELECT id, name FROM subscription_categories
                            WHERE user_id = ?
                            ORDER BY name COLLATE NOCASE, id LIMIT ?`,
                        bindings: [userId, MAX_COMPAT_CATEGORIES],
                    }),
                );
                return (yield* decodeRows(
                    operation,
                    CategoryRow,
                    result.results,
                )).map((row) => ({ id: row.id, name: row.name }));
            }),

        listSubscriptions: (userId) =>
            Effect.gen(function* () {
                const operation = 'compat.subscriptions.list';
                const result = yield* withStorage(
                    operation,
                    d1.all({
                        sql: `SELECT fs.feed_id, fs.category_id,
                            c.name AS category_name, f.name AS feed_name,
                            fs.custom_feed_name, f.feed_url, f.site_url,
                            f.favicon_url, f.last_successful_refresh_at
                            FROM feed_subscriptions fs
                            JOIN feeds f ON f.id = fs.feed_id
                            JOIN subscription_categories c
                              ON c.user_id = fs.user_id AND c.id = fs.category_id
                            WHERE fs.user_id = ?
                            ORDER BY COALESCE(fs.custom_feed_name, f.name)
                              COLLATE NOCASE, fs.feed_id LIMIT ?`,
                        bindings: [userId, MAX_COMPAT_SUBSCRIPTIONS],
                    }),
                );
                return (yield* decodeRows(
                    operation,
                    SubscriptionRow,
                    result.results,
                )).map((row) => ({
                    feedId: row.feed_id,
                    categoryId: row.category_id,
                    categoryName: row.category_name,
                    title: row.custom_feed_name ?? row.feed_name,
                    feedUrl: row.feed_url,
                    siteUrl: row.site_url ?? '',
                    faviconUrl: row.favicon_url ?? '',
                    lastSuccessfulRefreshAt: row.last_successful_refresh_at,
                }));
            }),

        listItemIds: (
            userId,
            filter,
            requestedLimit = MAX_COMPAT_ITEM_IDS,
            bounds = {},
        ) =>
            Effect.gen(function* () {
                const operation = 'compat.items.ids';
                const limit = Math.min(
                    Math.max(1, Math.trunc(requestedLimit)),
                    MAX_COMPAT_ITEM_IDS,
                );
                const result = yield* withStorage(
                    operation,
                    d1.all(itemIdsStatement(userId, filter, limit, bounds)),
                );
                return (yield* decodeRows(
                    operation,
                    IdRow,
                    result.results,
                )).map((row) => row.id);
            }),

        findEntries: (userId, entryIds) =>
            Effect.gen(function* () {
                const operation = 'compat.entries.find';
                const uniqueIds = [...new Set(entryIds)].slice(
                    0,
                    MAX_GOOGLE_CONTENT_ITEMS,
                );
                if (uniqueIds.length === 0) return [];
                const result = yield* withStorage(
                    operation,
                    d1.all({
                        sql: `SELECT ${entryColumns}
                            ${ownedVisibleEntries}
                            LEFT JOIN entry_contents ec ON ec.entry_id = e.id
                            WHERE e.id IN (
                                SELECT CAST(value AS INTEGER) FROM json_each(?)
                            ) AND ei.filtered_at IS NULL`,
                        bindings: [userId, JSON.stringify(uniqueIds)],
                    }),
                );
                const entries = (yield* decodeRows(
                    operation,
                    EntryRow,
                    result.results,
                )).map(entryFromRow);
                const byId = new Map(entries.map((entry) => [entry.id, entry]));
                return uniqueIds.flatMap((id) => {
                    const entry = byId.get(id);
                    return entry === undefined ? [] : [entry];
                });
            }),

        listFeverItems: (userId, cursor) =>
            Effect.gen(function* () {
                const operation = 'compat.fever.items';
                const cursorClause =
                    cursor.sinceId !== undefined
                        ? 'AND e.id > ?'
                        : cursor.maxId !== undefined
                          ? 'AND e.id <= ?'
                          : '';
                const cursorBindings =
                    cursor.sinceId !== undefined
                        ? [cursor.sinceId]
                        : cursor.maxId !== undefined
                          ? [cursor.maxId]
                          : [];
                const order = cursor.sinceId === undefined ? 'DESC' : 'ASC';
                const results = yield* withStorage(
                    operation,
                    d1.batch([
                        {
                            // The stored per-subscription counts, instead
                            // of counting every entry on each items call.
                            sql: `SELECT COALESCE(SUM(total_count), 0) AS total
                                FROM (${subscriptionCountsSql('fs.user_id = ?')})`,
                            bindings: [userId],
                        },
                        {
                            // CROSS JOIN walks entries in ID order and stops
                            // after one page.
                            sql: `SELECT ${entryColumns}
                                FROM entries e
                                CROSS JOIN feed_subscriptions fs
                                  ON fs.feed_id = e.feed_id AND fs.user_id = ?
                                JOIN feeds f ON f.id = e.feed_id
                                LEFT JOIN entry_interactions ei
                                  ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                                LEFT JOIN entry_contents ec ON ec.entry_id = e.id
                                WHERE ei.filtered_at IS NULL ${cursorClause}
                                ORDER BY e.id ${order} LIMIT ?`,
                            bindings: [
                                userId,
                                ...cursorBindings,
                                MAX_FEVER_ITEMS,
                            ],
                        },
                    ]),
                );
                if (results.length !== 2)
                    return yield* Effect.fail(invariant(operation));
                const totals = results[0]?.results ?? [];
                if (totals.length !== 1)
                    return yield* Effect.fail(invariant(operation));
                const total = yield* decode(operation, TotalRow, totals[0]);
                const entries = (yield* decodeRows(
                    operation,
                    EntryRow,
                    results[1]?.results ?? [],
                )).map(entryFromRow);
                return { total: total.total, entries };
            }),

        setRead: reader.setRead,
        setStarred: reader.setStarred,
        setReadMany: reader.setReadMany,
        setStarredMany: reader.setStarredMany,
    };
};

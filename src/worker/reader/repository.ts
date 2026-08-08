import type {
    ReaderCategory,
    ReaderCountsResponse,
    ReaderEntry,
    ReaderEntryDetail,
    ReaderFilter,
    ReaderInteractionResponse,
    ReaderOrder,
    ReaderReadThroughResponse,
    ReaderSubscription,
} from '@shared/schemas/reader';
import { Effect, Schema } from 'effect';

import { feedFaviconUrl } from '../favicons/assets';
import type { D1, D1OperationError, D1Statement } from '../infrastructure/d1';
import {
    ReaderInvariantError,
    ReaderNotFound,
    ReaderStorageError,
} from './errors';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const BooleanInt = Schema.Literals([0, 1]);
const NullableTimestamp = Schema.NullOr(Timestamp);

const CategoryRow = Schema.Struct({ id: SafeId, name: Schema.String });
const FaviconAssetHash = Schema.String.check(
    Schema.isPattern(/^[a-f0-9]{64}$/u),
);
const SubscriptionRow = Schema.Struct({
    feed_id: SafeId,
    category_id: SafeId,
    feed_name: Schema.String,
    custom_feed_name: Schema.NullOr(Schema.String),
    favicon_url: Schema.NullOr(Schema.String),
    favicon_asset_hash: Schema.NullOr(FaviconAssetHash),
    favicon_is_dark: Schema.NullOr(BooleanInt),
    total_count: Count,
    unread_count: Count,
});
const CountsRow = Schema.Struct({
    total: Count,
    unread: Count,
    read: Count,
    starred: Count,
});
const EntryRow = Schema.Struct({
    id: SafeId,
    feed_id: SafeId,
    title: Schema.String,
    url: Schema.NullOr(Schema.String),
    author: Schema.NullOr(Schema.String),
    published_at: Timestamp,
    created_at: Timestamp,
    feed_name: Schema.String,
    custom_feed_name: Schema.NullOr(Schema.String),
    favicon_url: Schema.NullOr(Schema.String),
    favicon_asset_hash: Schema.NullOr(FaviconAssetHash),
    favicon_is_dark: Schema.NullOr(BooleanInt),
    is_read: BooleanInt,
    is_starred: BooleanInt,
    is_archived: BooleanInt,
});
const EntryDetailRow = Schema.Struct({
    ...EntryRow.fields,
    content_html: Schema.NullOr(Schema.String),
    read_changed_at: NullableTimestamp,
    starred_at: NullableTimestamp,
    archived_at: NullableTimestamp,
});
const InteractionRow = Schema.Struct({
    entry_id: SafeId,
    feed_id: SafeId,
    is_read: BooleanInt,
    read_changed_at: NullableTimestamp,
    starred_at: NullableTimestamp,
    archived_at: NullableTimestamp,
});
const ReadThroughRow = Schema.Struct({
    feed_id: SafeId,
    read_through_entry_id: Schema.NullOr(SafeId),
});
const UTC_DAY_MS = 24 * 60 * 60_000;
const utcDayStart = (timestamp: number): number =>
    Math.floor(timestamp / UTC_DAY_MS) * UTC_DAY_MS;
const TotalRow = Schema.Struct({ total: Count });

export type ReaderEntryScope =
    | { readonly type: 'all' }
    | { readonly type: 'feed'; readonly id: number }
    | { readonly type: 'category'; readonly id: number };

export interface ReaderEntryCursor {
    readonly orderValue: number;
    readonly id: number;
}

export interface ReaderEntryQuery {
    readonly scope: ReaderEntryScope;
    readonly filter: ReaderFilter;
    readonly orderBy: ReaderOrder;
    readonly cursor: ReaderEntryCursor | null;
    readonly pageSize: number;
}

export interface ReaderEntryPage {
    readonly entries: readonly ReaderEntry[];
    readonly total: number;
    readonly nextCursor: ReaderEntryCursor | null;
}

export interface ReaderRepository {
    readonly listCategories: (
        userId: number,
    ) => Effect.Effect<
        readonly ReaderCategory[],
        ReaderStorageError | ReaderInvariantError
    >;
    readonly listSubscriptions: (
        userId: number,
    ) => Effect.Effect<
        readonly ReaderSubscription[],
        ReaderStorageError | ReaderInvariantError
    >;
    readonly getCounts: (
        userId: number,
    ) => Effect.Effect<
        ReaderCountsResponse,
        ReaderStorageError | ReaderInvariantError
    >;
    readonly listEntries: (
        userId: number,
        query: ReaderEntryQuery,
    ) => Effect.Effect<
        ReaderEntryPage,
        ReaderStorageError | ReaderInvariantError
    >;
    readonly findEntry: (
        userId: number,
        entryId: number,
    ) => Effect.Effect<
        ReaderEntryDetail,
        ReaderNotFound | ReaderStorageError | ReaderInvariantError
    >;
    readonly setRead: (
        userId: number,
        entryId: number,
        desired: boolean,
        now: number,
    ) => Effect.Effect<
        ReaderInteractionResponse,
        ReaderNotFound | ReaderStorageError | ReaderInvariantError
    >;
    readonly setStarred: (
        userId: number,
        entryId: number,
        desired: boolean,
        now: number,
    ) => Effect.Effect<
        ReaderInteractionResponse,
        ReaderNotFound | ReaderStorageError | ReaderInvariantError
    >;
    readonly setArchived: (
        userId: number,
        entryId: number,
        desired: boolean,
        now: number,
    ) => Effect.Effect<
        ReaderInteractionResponse,
        ReaderNotFound | ReaderStorageError | ReaderInvariantError
    >;
    readonly advanceReadThrough: (
        userId: number,
        feedId: number,
        now: number,
    ) => Effect.Effect<
        ReaderReadThroughResponse,
        ReaderNotFound | ReaderStorageError | ReaderInvariantError
    >;
}

const effectiveRead = `CASE
    WHEN ei.read_override IS NOT NULL THEN ei.read_override
    WHEN fs.read_through_entry_id IS NOT NULL AND e.id <= fs.read_through_entry_id THEN 1
    ELSE 0 END`;
const naturalRead = `CASE
    WHEN fs.read_through_entry_id IS NOT NULL AND e.id <= fs.read_through_entry_id THEN 1
    ELSE 0 END`;
const entryColumns = `
    e.id, e.feed_id, e.title, e.url, e.author, e.published_at, e.created_at,
    f.name AS feed_name, fs.custom_feed_name, f.favicon_url,
    f.favicon_asset_hash, f.favicon_is_dark,
    ${effectiveRead} AS is_read,
    CASE WHEN ei.starred_at IS NULL THEN 0 ELSE 1 END AS is_starred,
    CASE WHEN ei.archived_at IS NULL THEN 0 ELSE 1 END AS is_archived`;
const interactionColumns = `
    e.id AS entry_id, e.feed_id, ${effectiveRead} AS is_read,
    ei.read_changed_at, ei.starred_at, ei.archived_at`;

const invariantError = (operation: string) =>
    new ReaderInvariantError({ operation });
const withStorageError = <A, R>(
    operation: string,
    effect: Effect.Effect<A, D1OperationError, R>,
): Effect.Effect<A, ReaderStorageError, R> =>
    effect.pipe(
        Effect.mapError(
            (cause) => new ReaderStorageError({ operation, cause }),
        ),
    );
const decode = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    value: unknown,
): Effect.Effect<S['Type'], ReaderInvariantError> =>
    Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(value),
        catch: () => invariantError(operation),
    });
const decodeRows = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    values: readonly unknown[],
): Effect.Effect<readonly S['Type'][], ReaderInvariantError> =>
    Effect.forEach(values, (value) => decode(operation, schema, value));
const changes = (
    operation: string,
    result: D1Result<unknown> | undefined,
): Effect.Effect<number, ReaderInvariantError> =>
    result !== undefined &&
    typeof result.meta.changes === 'number' &&
    result.meta.changes >= 0
        ? Effect.succeed(result.meta.changes)
        : Effect.fail(invariantError(operation));

const categoryFromRow = (row: typeof CategoryRow.Type): ReaderCategory => ({
    id: row.id,
    name: row.name,
});

const mappedFaviconUrl = (row: {
    readonly feed_id: number;
    readonly favicon_url: string | null;
    readonly favicon_asset_hash: string | null;
}): string | null =>
    feedFaviconUrl({
        feedId: row.feed_id,
        upstreamUrl: row.favicon_url,
        assetHash: row.favicon_asset_hash,
    });

const subscriptionFromRow = (
    row: typeof SubscriptionRow.Type,
): ReaderSubscription => ({
    feedId: row.feed_id,
    categoryId: row.category_id,
    feedName: row.feed_name,
    customFeedName: row.custom_feed_name,
    faviconUrl: mappedFaviconUrl(row),
    faviconIsDark:
        row.favicon_is_dark === null ? null : row.favicon_is_dark === 1,
    totalCount: row.total_count,
    unreadCount: row.unread_count,
});
const countsFromRow = (row: typeof CountsRow.Type): ReaderCountsResponse => ({
    total: row.total,
    unread: row.unread,
    read: row.read,
    starred: row.starred,
});
const entryFromRow = (row: typeof EntryRow.Type): ReaderEntry => ({
    id: row.id,
    feedId: row.feed_id,
    title: row.title,
    url: row.url,
    author: row.author,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    feedName: row.feed_name,
    customFeedName: row.custom_feed_name,
    faviconUrl: mappedFaviconUrl(row),
    faviconIsDark:
        row.favicon_is_dark === null ? null : row.favicon_is_dark === 1,
    read: row.is_read === 1,
    starred: row.is_starred === 1,
    archived: row.is_archived === 1,
});
const detailFromRow = (row: typeof EntryDetailRow.Type): ReaderEntryDetail => ({
    ...entryFromRow(row),
    contentHtml: row.content_html,
    readChangedAt: row.read_changed_at,
    starredAt: row.starred_at,
    archivedAt: row.archived_at,
});
const interactionFromRow = (
    row: typeof InteractionRow.Type,
): ReaderInteractionResponse => ({
    entryId: row.entry_id,
    feedId: row.feed_id,
    read: row.is_read === 1,
    readChangedAt: row.read_changed_at,
    starred: row.starred_at !== null,
    starredAt: row.starred_at,
    archived: row.archived_at !== null,
    archivedAt: row.archived_at,
});

const scopeSql = (
    scope: ReaderEntryScope,
    userId: number,
): { readonly clause: string; readonly bindings: readonly number[] } => {
    switch (scope.type) {
        case 'feed':
            return {
                clause: 'fs.user_id = ? AND e.feed_id = ?',
                bindings: [userId, scope.id],
            };
        case 'category':
            return {
                clause: 'fs.user_id = ? AND fs.category_id = ?',
                bindings: [userId, scope.id],
            };
        case 'all':
            return { clause: 'fs.user_id = ?', bindings: [userId] };
    }
};
const filterSql = (filter: ReaderFilter): string => {
    switch (filter) {
        case 'unread':
            return `${effectiveRead} = 0`;
        case 'read':
            return `${effectiveRead} = 1`;
        case 'favorites':
            return 'ei.starred_at IS NOT NULL';
        case 'all':
            return '1 = 1';
    }
};
const orderSql = (orderBy: ReaderOrder): string =>
    orderBy === 'created_at'
        ? 'e.created_at DESC, e.id DESC'
        : 'e.published_at DESC, e.id DESC';

const ownedEntry = `
    FROM entries e
    JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = ?
    LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
    WHERE e.id = ? AND ei.filtered_at IS NULL`;
const canonicalInteractionStatement = (
    userId: number,
    entryId: number,
): D1Statement => ({
    sql: `SELECT ${interactionColumns}
        FROM entries e
        JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = ?
        LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
        WHERE e.id = ? AND ei.filtered_at IS NULL`,
    bindings: [userId, entryId],
});
const mutationResult = (
    operation: string,
    results: D1Result<unknown>[],
    mutationIndexes: readonly number[],
    rowIndex: number,
): Effect.Effect<
    ReaderInteractionResponse,
    ReaderNotFound | ReaderInvariantError
> =>
    Effect.gen(function* () {
        const mutationChanges = yield* Effect.forEach(
            mutationIndexes,
            (index) => changes(operation, results[index]),
        );
        if (
            mutationChanges.some((count) => count > 1) ||
            mutationChanges.reduce((total, count) => total + count, 0) > 1
        ) {
            return yield* Effect.fail(invariantError(operation));
        }
        const rows = results[rowIndex]?.results ?? [];
        if (rows.length === 0) return yield* Effect.fail(new ReaderNotFound());
        if (rows.length !== 1)
            return yield* Effect.fail(invariantError(operation));
        return interactionFromRow(
            yield* decode(operation, InteractionRow, rows[0]),
        );
    });

export const makeReaderRepository = (d1: D1): ReaderRepository => ({
    listCategories: (userId) =>
        Effect.gen(function* () {
            const operation = 'reader.categories.list';
            const result = yield* withStorageError(
                operation,
                d1.all({
                    sql: `SELECT id, name FROM subscription_categories
                WHERE user_id = ? ORDER BY name COLLATE NOCASE, id`,
                    bindings: [userId],
                }),
            );
            return (yield* decodeRows(
                operation,
                CategoryRow,
                result.results,
            )).map(categoryFromRow);
        }),

    listSubscriptions: (userId) =>
        Effect.gen(function* () {
            const operation = 'reader.subscriptions.list';
            const result = yield* withStorageError(
                operation,
                d1.all({
                    sql: `SELECT fs.feed_id, fs.category_id, f.name AS feed_name,
                    fs.custom_feed_name, f.favicon_url, f.favicon_asset_hash,
                    f.favicon_is_dark,
                    COALESCE(SUM(CASE WHEN ei.filtered_at IS NULL AND e.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_count,
                    COALESCE(SUM(CASE WHEN ei.filtered_at IS NULL AND e.id IS NOT NULL AND ${effectiveRead} = 0 THEN 1 ELSE 0 END), 0) AS unread_count
                FROM feed_subscriptions fs
                JOIN feeds f ON f.id = fs.feed_id
                LEFT JOIN entries e ON e.feed_id = fs.feed_id
                LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                WHERE fs.user_id = ?
                GROUP BY fs.user_id, fs.feed_id, fs.category_id, f.name,
                    fs.custom_feed_name, f.favicon_url, f.favicon_asset_hash,
                    f.favicon_is_dark
                ORDER BY COALESCE(fs.custom_feed_name, f.name) COLLATE NOCASE, fs.feed_id`,
                    bindings: [userId],
                }),
            );
            return (yield* decodeRows(
                operation,
                SubscriptionRow,
                result.results,
            )).map(subscriptionFromRow);
        }),

    getCounts: (userId) =>
        Effect.gen(function* () {
            const operation = 'reader.entries.counts';
            const value = yield* withStorageError(
                operation,
                d1.first({
                    sql: `SELECT COALESCE(SUM(1), 0) AS total,
                    COALESCE(SUM(CASE WHEN ${effectiveRead} = 0 THEN 1 ELSE 0 END), 0) AS unread,
                    COALESCE(SUM(CASE WHEN ${effectiveRead} = 1 THEN 1 ELSE 0 END), 0) AS read,
                    COALESCE(SUM(CASE WHEN ei.starred_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS starred
                FROM entries e
                JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = ?
                LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                WHERE ei.filtered_at IS NULL`,
                    bindings: [userId],
                }),
            );
            if (value === null)
                return yield* Effect.fail(invariantError(operation));
            return countsFromRow(yield* decode(operation, CountsRow, value));
        }),

    listEntries: (userId, query) =>
        Effect.gen(function* () {
            const operation = 'reader.entries.list';
            const scope = scopeSql(query.scope, userId);
            const orderColumn =
                query.orderBy === 'created_at'
                    ? 'e.created_at'
                    : 'e.published_at';
            const fromWhere = `FROM entries e
            JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
            JOIN feeds f ON f.id = e.feed_id
            LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
            WHERE ${scope.clause} AND ei.filtered_at IS NULL AND ${filterSql(query.filter)}`;
            // Keyset pagination: an OFFSET shifts when reads or new arrivals
            // change the filtered set, skipping or repeating entries.
            const cursorClause =
                query.cursor === null
                    ? ''
                    : ` AND (${orderColumn} < ? OR (${orderColumn} = ? AND e.id < ?))`;
            const cursorBindings =
                query.cursor === null
                    ? []
                    : [
                          query.cursor.orderValue,
                          query.cursor.orderValue,
                          query.cursor.id,
                      ];
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `SELECT COUNT(*) AS total ${fromWhere}`,
                        bindings: scope.bindings,
                    },
                    {
                        sql: `SELECT ${entryColumns} ${fromWhere}${cursorClause}
                    ORDER BY ${orderSql(query.orderBy)} LIMIT ?`,
                        bindings: [
                            ...scope.bindings,
                            ...cursorBindings,
                            query.pageSize + 1,
                        ],
                    },
                ]),
            );
            if (results.length !== 2)
                return yield* Effect.fail(invariantError(operation));
            const totalRows = results[0]?.results ?? [];
            if (totalRows.length !== 1)
                return yield* Effect.fail(invariantError(operation));
            const total = yield* decode(operation, TotalRow, totalRows[0]);
            const rows = yield* decodeRows(
                operation,
                EntryRow,
                results[1]?.results ?? [],
            );
            const hasMore = rows.length > query.pageSize;
            const pageRows = hasMore ? rows.slice(0, query.pageSize) : rows;
            const entries = pageRows.map(entryFromRow);
            const lastEntry = entries.at(-1);
            return {
                total: total.total,
                entries,
                nextCursor:
                    hasMore && lastEntry !== undefined
                        ? {
                              orderValue:
                                  query.orderBy === 'created_at'
                                      ? lastEntry.createdAt
                                      : lastEntry.publishedAt,
                              id: lastEntry.id,
                          }
                        : null,
            };
        }),

    findEntry: (userId, entryId) =>
        Effect.gen(function* () {
            const operation = 'reader.entries.find';
            const value = yield* withStorageError(
                operation,
                d1.first({
                    sql: `SELECT ${entryColumns}, ec.content_html,
                    ei.read_changed_at, ei.starred_at, ei.archived_at
                FROM entries e
                JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = ?
                JOIN feeds f ON f.id = e.feed_id
                LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                LEFT JOIN entry_contents ec ON ec.entry_id = e.id
                WHERE e.id = ? AND ei.filtered_at IS NULL`,
                    bindings: [userId, entryId],
                }),
            );
            if (value === null) return yield* Effect.fail(new ReaderNotFound());
            return detailFromRow(
                yield* decode(operation, EntryDetailRow, value),
            );
        }),

    setRead: (userId, entryId, desired, now) =>
        Effect.gen(function* () {
            const operation = 'reader.entry.read.set';
            const desiredInt = desired ? 1 : 0;
            const targetCte = `WITH target AS (
            SELECT CASE WHEN ? = ${naturalRead} THEN NULL ELSE ? END AS expected_override
            ${ownedEntry})`;
            const targetBindings = [desiredInt, desiredInt, userId, entryId];
            const dayStart = utcDayStart(now);
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `INSERT INTO chart_daily_activity (
                            user_id, feed_id, day_start, marked_read_count,
                            marked_unread_count, saved_count, unsaved_count,
                            created_at, updated_at
                        )
                        SELECT ?, e.feed_id, ?, ?, ?, 0, 0, ?, ? ${ownedEntry}
                          AND ${effectiveRead} <> ?
                        ON CONFLICT(user_id, feed_id, day_start) DO UPDATE SET
                            marked_read_count = marked_read_count + excluded.marked_read_count,
                            marked_unread_count = marked_unread_count + excluded.marked_unread_count,
                            updated_at = excluded.updated_at`,
                        bindings: [
                            userId,
                            dayStart,
                            desired ? 1 : 0,
                            desired ? 0 : 1,
                            now,
                            now,
                            userId,
                            entryId,
                            desiredInt,
                        ],
                    },
                    {
                        sql: `${targetCte}
                    DELETE FROM entry_interactions
                    WHERE user_id = ? AND entry_id = ? AND read_override IS NOT NULL
                        AND starred_at IS NULL AND archived_at IS NULL AND filtered_at IS NULL
                        AND EXISTS (SELECT 1 FROM target WHERE expected_override IS NULL)`,
                        bindings: [...targetBindings, userId, entryId],
                    },
                    {
                        sql: `${targetCte}
                    UPDATE entry_interactions
                    SET read_override = (SELECT expected_override FROM target),
                        read_changed_at = CASE WHEN (SELECT expected_override FROM target) IS NULL THEN NULL ELSE ? END,
                        updated_at = ?
                    WHERE user_id = ? AND entry_id = ? AND EXISTS (SELECT 1 FROM target)
                        AND read_override IS NOT (SELECT expected_override FROM target)`,
                        bindings: [
                            ...targetBindings,
                            now,
                            now,
                            userId,
                            entryId,
                        ],
                    },
                    {
                        sql: `INSERT INTO entry_interactions (
                        user_id, feed_id, entry_id, read_override, read_changed_at, created_at, updated_at)
                    SELECT ?, e.feed_id, e.id, ?, ?, ?, ?
                    FROM entries e
                    JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id AND fs.user_id = ?
                    LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                    WHERE e.id = ? AND ei.filtered_at IS NULL AND ? <> ${naturalRead}
                    ON CONFLICT(user_id, entry_id) DO NOTHING`,
                        bindings: [
                            userId,
                            desiredInt,
                            now,
                            now,
                            now,
                            userId,
                            entryId,
                            desiredInt,
                        ],
                    },
                    canonicalInteractionStatement(userId, entryId),
                ]),
            );
            const activityChanges = yield* changes(operation, results[0]);
            if (activityChanges > 1)
                return yield* Effect.fail(invariantError(operation));
            return yield* mutationResult(operation, results, [1, 2, 3], 4);
        }),

    setStarred: (userId, entryId, desired, now) =>
        setTimestampState(d1, {
            operation: 'reader.entry.star.set',
            userId,
            entryId,
            desired,
            now,
            column: 'starred_at',
            otherColumn: 'archived_at',
            activity: 'saved',
        }),

    setArchived: (userId, entryId, desired, now) =>
        setTimestampState(d1, {
            operation: 'reader.entry.archive.set',
            userId,
            entryId,
            desired,
            now,
            column: 'archived_at',
            otherColumn: 'starred_at',
        }),

    advanceReadThrough: (userId, feedId, now) =>
        Effect.gen(function* () {
            const operation = 'reader.subscription.readThrough.advance';
            const dayStart = utcDayStart(now);
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `INSERT INTO chart_daily_activity (
                            user_id, feed_id, day_start, marked_read_count,
                            marked_unread_count, saved_count, unsaved_count,
                            created_at, updated_at
                        )
                        SELECT ?, fs.feed_id, ?, COUNT(*), 0, 0, 0, ?, ?
                        FROM entries e
                        JOIN feed_subscriptions fs
                          ON fs.feed_id = e.feed_id AND fs.user_id = ?
                        LEFT JOIN entry_interactions ei
                          ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                        WHERE fs.feed_id = ? AND ei.filtered_at IS NULL
                          AND ${effectiveRead} = 0
                        HAVING COUNT(*) > 0
                        ON CONFLICT(user_id, feed_id, day_start) DO UPDATE SET
                            marked_read_count = marked_read_count + excluded.marked_read_count,
                            updated_at = excluded.updated_at`,
                        bindings: [userId, dayStart, now, now, userId, feedId],
                    },
                    {
                        sql: `UPDATE feed_subscriptions
                    SET read_through_entry_id = (SELECT MAX(id) FROM entries WHERE feed_id = ?), updated_at = ?
                    WHERE user_id = ? AND feed_id = ?
                        AND (SELECT MAX(id) FROM entries WHERE feed_id = ?) IS NOT NULL
                        AND (read_through_entry_id IS NULL OR read_through_entry_id < (SELECT MAX(id) FROM entries WHERE feed_id = ?))`,
                        bindings: [feedId, now, userId, feedId, feedId, feedId],
                    },
                    {
                        sql: `DELETE FROM entry_interactions
                    WHERE user_id = ? AND feed_id = ? AND read_override IS NOT NULL
                        AND starred_at IS NULL AND archived_at IS NULL AND filtered_at IS NULL
                        AND entry_id <= COALESCE((SELECT read_through_entry_id FROM feed_subscriptions WHERE user_id = ? AND feed_id = ?), 0)`,
                        bindings: [userId, feedId, userId, feedId],
                    },
                    {
                        sql: `UPDATE entry_interactions SET read_override = NULL, read_changed_at = NULL, updated_at = ?
                    WHERE user_id = ? AND feed_id = ? AND read_override IS NOT NULL
                        AND entry_id <= COALESCE((SELECT read_through_entry_id FROM feed_subscriptions WHERE user_id = ? AND feed_id = ?), 0)`,
                        bindings: [now, userId, feedId, userId, feedId],
                    },
                    {
                        sql: `SELECT feed_id, read_through_entry_id FROM feed_subscriptions WHERE user_id = ? AND feed_id = ?`,
                        bindings: [userId, feedId],
                    },
                ]),
            );
            const activityChanges = yield* changes(operation, results[0]);
            const mutationChanges = yield* Effect.forEach([1, 2, 3], (index) =>
                changes(operation, results[index]),
            );
            if (activityChanges > 1 || mutationChanges[0] > 1)
                return yield* Effect.fail(invariantError(operation));
            const rows = results[4]?.results ?? [];
            if (rows.length === 0)
                return yield* Effect.fail(new ReaderNotFound());
            if (rows.length !== 1)
                return yield* Effect.fail(invariantError(operation));
            const row = yield* decode(operation, ReadThroughRow, rows[0]);
            return {
                feedId: row.feed_id,
                readThroughEntryId: row.read_through_entry_id,
            };
        }),
});

interface TimestampStateInput {
    readonly operation: string;
    readonly userId: number;
    readonly entryId: number;
    readonly desired: boolean;
    readonly now: number;
    readonly column: 'starred_at' | 'archived_at';
    readonly otherColumn: 'starred_at' | 'archived_at';
    readonly activity?: 'saved';
}

const setTimestampState = (
    d1: D1,
    input: TimestampStateInput,
): Effect.Effect<
    ReaderInteractionResponse,
    ReaderNotFound | ReaderStorageError | ReaderInvariantError
> =>
    Effect.gen(function* () {
        const stateStatements: D1Statement[] = input.desired
            ? [
                  {
                      sql: `INSERT INTO entry_interactions (
                          user_id, feed_id, entry_id, ${input.column}, created_at, updated_at)
                      SELECT ?, e.feed_id, e.id, ?, ?, ? ${ownedEntry}
                      ON CONFLICT(user_id, entry_id) DO UPDATE SET
                          ${input.column} = excluded.${input.column}, updated_at = excluded.updated_at
                      WHERE entry_interactions.${input.column} IS NULL
                          AND entry_interactions.filtered_at IS NULL`,
                      bindings: [
                          input.userId,
                          input.now,
                          input.now,
                          input.now,
                          input.userId,
                          input.entryId,
                      ],
                  },
              ]
            : [
                  {
                      sql: `DELETE FROM entry_interactions
                          WHERE user_id = ? AND entry_id = ? AND ${input.column} IS NOT NULL
                              AND read_override IS NULL AND ${input.otherColumn} IS NULL AND filtered_at IS NULL
                              AND EXISTS (SELECT 1 ${ownedEntry})`,
                      bindings: [
                          input.userId,
                          input.entryId,
                          input.userId,
                          input.entryId,
                      ],
                  },
                  {
                      sql: `UPDATE entry_interactions SET ${input.column} = NULL, updated_at = ?
                          WHERE user_id = ? AND entry_id = ? AND ${input.column} IS NOT NULL
                              AND EXISTS (SELECT 1 ${ownedEntry})`,
                      bindings: [
                          input.now,
                          input.userId,
                          input.entryId,
                          input.userId,
                          input.entryId,
                      ],
                  },
              ];
        const activityStatements: D1Statement[] =
            input.activity === 'saved'
                ? [
                      {
                          sql: `INSERT INTO chart_daily_activity (
                              user_id, feed_id, day_start, marked_read_count,
                              marked_unread_count, saved_count, unsaved_count,
                              created_at, updated_at
                          )
                          SELECT ?, e.feed_id, ?, 0, 0, ?, ?, ?, ? ${ownedEntry}
                            AND (ei.starred_at IS NULL) = ?
                          ON CONFLICT(user_id, feed_id, day_start) DO UPDATE SET
                              saved_count = saved_count + excluded.saved_count,
                              unsaved_count = unsaved_count + excluded.unsaved_count,
                              updated_at = excluded.updated_at`,
                          bindings: [
                              input.userId,
                              utcDayStart(input.now),
                              input.desired ? 1 : 0,
                              input.desired ? 0 : 1,
                              input.now,
                              input.now,
                              input.userId,
                              input.entryId,
                              input.desired ? 1 : 0,
                          ],
                      },
                  ]
                : [];
        const statements = [...activityStatements, ...stateStatements];
        const results = yield* withStorageError(
            input.operation,
            d1.batch([
                ...statements,
                canonicalInteractionStatement(input.userId, input.entryId),
            ]),
        );
        if (activityStatements.length === 1) {
            const activityChanges = yield* changes(input.operation, results[0]);
            if (activityChanges > 1)
                return yield* Effect.fail(invariantError(input.operation));
        }
        const stateOffset = activityStatements.length;
        return yield* mutationResult(
            input.operation,
            results,
            stateStatements.map((_, index) => stateOffset + index),
            statements.length,
        );
    });

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
    countInteractionsJoin,
    subscriptionCountsSql,
    subscriptionTotalCount,
    subscriptionUnreadCount,
} from './counts';
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
const SearchRow = Schema.Struct({
    ...EntryRow.fields,
    snippet: Schema.NullOr(Schema.String),
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
    /**
     * Optional bounds in epoch milliseconds on the order column: inclusive
     * `from`, exclusive `to`. The total counts only entries inside them.
     */
    readonly range?: {
        readonly from?: number;
        readonly to?: number;
    };
}

export interface ReaderSearchQuery {
    /** An FTS5 query string; build it with `toFtsQuery`. */
    readonly match: string;
    readonly scope: ReaderEntryScope;
    readonly filter: ReaderFilter;
    readonly range?: ReaderEntryQuery['range'];
    readonly limit: number;
    readonly offset: number;
}

export interface ReaderSearchResult extends ReaderEntry {
    /** Text around the best match, with matched terms wrapped in `**`. */
    readonly snippet: string;
}

export interface ReaderSearchPage {
    readonly results: readonly ReaderSearchResult[];
    readonly hasMore: boolean;
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
    /** Like `listEntries`, without the scope total and the scan it costs. */
    readonly listEntriesUncounted: (
        userId: number,
        query: ReaderEntryQuery,
    ) => Effect.Effect<
        Omit<ReaderEntryPage, 'total'>,
        ReaderStorageError | ReaderInvariantError
    >;
    readonly searchEntries: (
        userId: number,
        query: ReaderSearchQuery,
    ) => Effect.Effect<
        ReaderSearchPage,
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
    /** Sets the read state of many entries; returns how many were found. */
    readonly setReadMany: (
        userId: number,
        entryIds: readonly number[],
        desired: boolean,
        now: number,
    ) => Effect.Effect<number, ReaderStorageError | ReaderInvariantError>;
    /** Stars or unstars many entries; returns how many were found. */
    readonly setStarredMany: (
        userId: number,
        entryIds: readonly number[],
        desired: boolean,
        now: number,
    ) => Effect.Effect<number, ReaderStorageError | ReaderInvariantError>;
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
    /** Marks every subscription of a category, or all of them, as read. */
    readonly advanceReadThroughScope: (
        userId: number,
        scope: ReaderEntryScope,
        now: number,
    ) => Effect.Effect<
        readonly ReaderReadThroughResponse[],
        ReaderStorageError | ReaderInvariantError
    >;
}

const effectiveReadOf = (entry: string, interaction: string) => `CASE
    WHEN ${interaction}.read_override IS NOT NULL THEN ${interaction}.read_override
    WHEN fs.read_through_entry_id IS NOT NULL AND ${entry}.id <= fs.read_through_entry_id THEN 1
    ELSE 0 END`;
const effectiveRead = effectiveReadOf('e', 'ei');
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
const filterSql = (
    filter: ReaderFilter,
    entry = 'e',
    interaction = 'ei',
): string => {
    switch (filter) {
        case 'unread':
            return `${effectiveReadOf(entry, interaction)} = 0`;
        case 'read':
            return `${effectiveReadOf(entry, interaction)} = 1`;
        case 'favorites':
            return `${interaction}.starred_at IS NOT NULL`;
        case 'all':
            return '1 = 1';
    }
};
const rangeSql = (
    column: string,
    range: ReaderEntryQuery['range'],
): { readonly clause: string; readonly bindings: readonly number[] } => {
    const clauses: string[] = [];
    const bindings: number[] = [];
    if (range?.from !== undefined) {
        clauses.push(` AND ${column} >= ?`);
        bindings.push(range.from);
    }
    if (range?.to !== undefined) {
        clauses.push(` AND ${column} < ?`);
        bindings.push(range.to);
    }
    return { clause: clauses.join(''), bindings };
};
const orderSql = (orderBy: ReaderOrder, entry = 'e'): string =>
    orderBy === 'created_at'
        ? `${entry}.created_at DESC, ${entry}.id DESC`
        : `${entry}.published_at DESC, ${entry}.id DESC`;

/** The same scope as `scopeSql`, over `fs` only. */
const subscriptionScopeSql = (
    scope: ReaderEntryScope,
    userId: number,
): { readonly clause: string; readonly bindings: readonly number[] } =>
    scope.type === 'feed'
        ? {
              clause: 'fs.user_id = ? AND fs.feed_id = ?',
              bindings: [userId, scope.id],
          }
        : scopeSql(scope, userId);

/**
 * How a page of entries is read. Each plan returns the same rows; they
 * differ in which index drives the query, so a page reads close to one
 * page of entries instead of every entry in the scope.
 *
 * - `feed`: one feed's ordering index.
 * - `starred`: the user's starred interactions, which are few.
 * - `global`: the global ordering index, in order, stopping after one page.
 * - `perFeed`: each feed's ordering index, at most one page per feed, then
 *   a sort. A scope with few feeds would otherwise walk the global index
 *   past every other feed's entries.
 */
type EntryListPlan = 'feed' | 'starred' | 'global' | 'perFeed';

// Scopes with at most this many subscriptions use the `perFeed` plan.
const PER_FEED_PLAN_MAX_FEEDS = 16;

const scopeFeedCountStatement = (
    userId: number,
    scope: ReaderEntryScope,
): D1Statement => ({
    sql: `SELECT COUNT(*) AS total FROM (
            SELECT 1 FROM feed_subscriptions
            WHERE user_id = ?${scope.type === 'category' ? ' AND category_id = ?' : ''}
            LIMIT ?)`,
    bindings: [
        userId,
        ...(scope.type === 'category' ? [scope.id] : []),
        PER_FEED_PLAN_MAX_FEEDS + 1,
    ],
});

const entryListPlan = (
    d1: D1,
    operation: string,
    userId: number,
    query: ReaderEntryQuery,
): Effect.Effect<EntryListPlan, ReaderStorageError | ReaderInvariantError> =>
    Effect.gen(function* () {
        if (query.filter === 'favorites') return 'starred';
        if (query.scope.type === 'feed') return 'feed';
        const row = yield* withStorageError(
            operation,
            d1.first(scopeFeedCountStatement(userId, query.scope)),
        );
        const { total } = yield* decode(operation, TotalRow, row);
        return total > PER_FEED_PLAN_MAX_FEEDS ? 'global' : 'perFeed';
    });

const cursorSql = (
    orderColumn: string,
    entry: string,
    cursor: ReaderEntryCursor | null,
): { readonly clause: string; readonly bindings: readonly number[] } =>
    // Keyset pagination: an OFFSET shifts when reads or new arrivals
    // change the filtered set, skipping or repeating entries.
    cursor === null
        ? { clause: '', bindings: [] }
        : {
              clause: ` AND (${orderColumn} < ? OR (${orderColumn} = ? AND ${entry}.id < ?))`,
              bindings: [cursor.orderValue, cursor.orderValue, cursor.id],
          };

const orderColumnOf = (orderBy: ReaderOrder, entry = 'e'): string =>
    orderBy === 'created_at' ? `${entry}.created_at` : `${entry}.published_at`;

/** The page query of an entry list: one row more than the page size. */
const entryPageStatement = (
    userId: number,
    query: ReaderEntryQuery,
    plan: EntryListPlan,
): D1Statement => {
    const scope = scopeSql(query.scope, userId);
    const range = rangeSql(orderColumnOf(query.orderBy), query.range);
    const cursor = cursorSql(orderColumnOf(query.orderBy), 'e', query.cursor);
    const order = orderSql(query.orderBy);
    const limit = query.pageSize + 1;
    const filtered = `ei.filtered_at IS NULL AND ${filterSql(query.filter)}${range.clause}${cursor.clause}`;
    const filteredBindings = [...range.bindings, ...cursor.bindings];
    switch (plan) {
        case 'feed':
            return {
                sql: `SELECT ${entryColumns}
                    FROM entries e
                    JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
                    JOIN feeds f ON f.id = e.feed_id
                    LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                    WHERE ${scope.clause} AND ${filtered}
                    ORDER BY ${order} LIMIT ?`,
                bindings: [...scope.bindings, ...filteredBindings, limit],
            };
        case 'global':
            // CROSS JOIN keeps entries as the outer loop, so SQLite reads
            // the global ordering index in order and stops after one page.
            return {
                sql: `SELECT ${entryColumns}
                    FROM entries e
                    CROSS JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
                    JOIN feeds f ON f.id = e.feed_id
                    LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                    WHERE ${scope.clause} AND ${filtered}
                    ORDER BY ${order} LIMIT ?`,
                bindings: [...scope.bindings, ...filteredBindings, limit],
            };
        case 'starred':
            return {
                sql: `SELECT ${entryColumns}
                    FROM entry_interactions ei
                    CROSS JOIN entries e ON e.id = ei.entry_id
                    CROSS JOIN feed_subscriptions fs
                      ON fs.user_id = ei.user_id AND fs.feed_id = ei.feed_id
                    JOIN feeds f ON f.id = e.feed_id
                    WHERE ei.user_id = ? AND ei.starred_at IS NOT NULL
                      AND ${scope.clause} AND ${filtered}
                    ORDER BY ${order} LIMIT ?`,
                bindings: [
                    userId,
                    ...scope.bindings,
                    ...filteredBindings,
                    limit,
                ],
            };
        case 'perFeed': {
            const feedRange = rangeSql(
                orderColumnOf(query.orderBy, 'pe'),
                query.range,
            );
            const feedCursor = cursorSql(
                orderColumnOf(query.orderBy, 'pe'),
                'pe',
                query.cursor,
            );
            return {
                sql: `SELECT ${entryColumns}
                    FROM feed_subscriptions fs
                    JOIN entries e ON e.id IN (
                        SELECT pe.id FROM entries pe
                        LEFT JOIN entry_interactions pei
                          ON pei.user_id = fs.user_id AND pei.entry_id = pe.id
                        WHERE pe.feed_id = fs.feed_id AND pei.filtered_at IS NULL
                          AND ${filterSql(query.filter, 'pe', 'pei')}${feedRange.clause}${feedCursor.clause}
                        ORDER BY ${orderSql(query.orderBy, 'pe')} LIMIT ?)
                    JOIN feeds f ON f.id = e.feed_id
                    LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                    WHERE ${scope.clause}
                    ORDER BY ${order} LIMIT ?`,
                bindings: [
                    ...feedRange.bindings,
                    ...feedCursor.bindings,
                    limit,
                    ...scope.bindings,
                    limit,
                ],
            };
        }
    }
};

/**
 * The number of entries in the scope, for the first page. Without a range
 * it adds up the stored per-subscription counts, or counts the starred
 * interactions, instead of reading every entry.
 */
const entryTotalStatement = (
    userId: number,
    query: ReaderEntryQuery,
): D1Statement => {
    if (query.range !== undefined) {
        // The reader asks for a range to count recent arrivals, which the
        // ingestion-time indexes find directly.
        const scope = scopeSql(query.scope, userId);
        const range = rangeSql(orderColumnOf(query.orderBy), query.range);
        return {
            sql: `SELECT COUNT(*) AS total
                FROM entries e
                JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
                LEFT JOIN entry_interactions ei ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                WHERE ${scope.clause} AND ei.filtered_at IS NULL AND ${filterSql(query.filter)}${range.clause}`,
            bindings: [...scope.bindings, ...range.bindings],
        };
    }
    const scope = subscriptionScopeSql(query.scope, userId);
    if (query.filter === 'favorites') {
        return {
            sql: `SELECT COUNT(*) AS total
                FROM entry_interactions ei
                CROSS JOIN feed_subscriptions fs
                  ON fs.user_id = ei.user_id AND fs.feed_id = ei.feed_id
                WHERE ei.user_id = ? AND ei.starred_at IS NOT NULL
                  AND ei.filtered_at IS NULL AND ${scope.clause}`,
            bindings: [userId, ...scope.bindings],
        };
    }
    const column =
        query.filter === 'unread'
            ? 'unread_count'
            : query.filter === 'read'
              ? 'total_count - unread_count'
              : 'total_count';
    return {
        sql: `SELECT COALESCE(SUM(${column}), 0) AS total
            FROM (${subscriptionCountsSql(scope.clause)})`,
        bindings: scope.bindings,
    };
};

const entryPageFromRows = (
    operation: string,
    query: ReaderEntryQuery,
    rawRows: readonly unknown[],
) =>
    Effect.gen(function* () {
        const rows = yield* decodeRows(operation, EntryRow, rawRows);
        const hasMore = rows.length > query.pageSize;
        const pageRows = hasMore ? rows.slice(0, query.pageSize) : rows;
        const entries = pageRows.map(entryFromRow);
        const lastEntry = entries.at(-1);
        return {
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
    });

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

/** The statements of one read-state change; the last one reads the result. */
const readStatements = (
    userId: number,
    entryId: number,
    desired: boolean,
    now: number,
): D1Statement[] => {
    const desiredInt = desired ? 1 : 0;
    const targetCte = `WITH target AS (
    SELECT CASE WHEN ? = ${naturalRead} THEN NULL ELSE ? END AS expected_override
    ${ownedEntry})`;
    const targetBindings = [desiredInt, desiredInt, userId, entryId];
    const dayStart = utcDayStart(now);
    return [
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
            bindings: [...targetBindings, now, now, userId, entryId],
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
    ];
};

const readOutcome = (
    operation: string,
    results: D1Result<unknown>[],
): Effect.Effect<
    ReaderInteractionResponse,
    ReaderNotFound | ReaderInvariantError
> =>
    Effect.gen(function* () {
        const activityChanges = yield* changes(operation, results[0]);
        if (activityChanges > 1)
            return yield* Effect.fail(invariantError(operation));
        return yield* mutationResult(operation, results, [1, 2, 3], 4);
    });

// Entries per D1 batch for bulk changes. One entry is at most five
// statements; a batch counts as one query against the invocation limit.
const BULK_ENTRIES_PER_BATCH = 40;

interface EntryChange {
    readonly statements: D1Statement[];
    readonly outcome: (
        operation: string,
        results: D1Result<unknown>[],
    ) => Effect.Effect<
        ReaderInteractionResponse,
        ReaderNotFound | ReaderInvariantError
    >;
}

/**
 * Applies one change to many entries, several entries per D1 batch.
 * Entries the user cannot see are skipped. Returns how many were found.
 */
const applyToEntries = (
    d1: D1,
    operation: string,
    entryIds: readonly number[],
    change: (entryId: number) => EntryChange,
): Effect.Effect<number, ReaderStorageError | ReaderInvariantError> =>
    Effect.gen(function* () {
        const unique = [...new Set(entryIds)];
        let found = 0;
        for (
            let start = 0;
            start < unique.length;
            start += BULK_ENTRIES_PER_BATCH
        ) {
            const changes = unique
                .slice(start, start + BULK_ENTRIES_PER_BATCH)
                .map(change);
            const results = yield* withStorageError(
                operation,
                d1.batch(changes.flatMap((entry) => entry.statements)),
            );
            let offset = 0;
            for (const entry of changes) {
                const slice = results.slice(
                    offset,
                    offset + entry.statements.length,
                );
                offset += entry.statements.length;
                found += yield* entry.outcome(operation, slice).pipe(
                    Effect.as(1),
                    Effect.catchTag('ReaderNotFound', () => Effect.succeed(0)),
                );
            }
        }
        return found;
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
                    ${subscriptionTotalCount} AS total_count,
                    ${subscriptionUnreadCount} AS unread_count
                FROM feed_subscriptions fs
                JOIN feeds f ON f.id = fs.feed_id
                ${countInteractionsJoin}
                WHERE fs.user_id = ?
                GROUP BY fs.user_id, fs.feed_id
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
                    sql: `SELECT COALESCE(SUM(total_count), 0) AS total,
                    COALESCE(SUM(unread_count), 0) AS unread,
                    COALESCE(SUM(total_count - unread_count), 0) AS read,
                    (SELECT COUNT(*) FROM entry_interactions
                        WHERE user_id = ? AND starred_at IS NOT NULL
                          AND filtered_at IS NULL) AS starred
                FROM (${subscriptionCountsSql('fs.user_id = ?')})`,
                    bindings: [userId, userId],
                }),
            );
            if (value === null)
                return yield* Effect.fail(invariantError(operation));
            return countsFromRow(yield* decode(operation, CountsRow, value));
        }),

    listEntries: (userId, query) =>
        Effect.gen(function* () {
            const operation = 'reader.entries.list';
            const plan = yield* entryListPlan(d1, operation, userId, query);
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    entryTotalStatement(userId, query),
                    entryPageStatement(userId, query, plan),
                ]),
            );
            if (results.length !== 2)
                return yield* Effect.fail(invariantError(operation));
            const totalRows = results[0]?.results ?? [];
            if (totalRows.length !== 1)
                return yield* Effect.fail(invariantError(operation));
            const total = yield* decode(operation, TotalRow, totalRows[0]);
            return {
                total: total.total,
                ...(yield* entryPageFromRows(
                    operation,
                    query,
                    results[1]?.results ?? [],
                )),
            };
        }),

    listEntriesUncounted: (userId, query) =>
        Effect.gen(function* () {
            const operation = 'reader.entries.page';
            const plan = yield* entryListPlan(d1, operation, userId, query);
            const result = yield* withStorageError(
                operation,
                d1.all(entryPageStatement(userId, query, plan)),
            );
            return yield* entryPageFromRows(operation, query, result.results);
        }),

    searchEntries: (userId, query) =>
        Effect.gen(function* () {
            const operation = 'reader.entries.search';
            const scope = scopeSql(query.scope, userId);
            const range = rangeSql('e.published_at', query.range);
            // The full-text table drives the query. Ownership, filters, and
            // the date range then narrow its matches to this user's entries.
            const result = yield* withStorageError(
                operation,
                d1.all({
                    sql: `SELECT ${entryColumns},
                        snippet(entry_search, -1, '**', '**', '…', 32) AS snippet
                    FROM entry_search
                    JOIN entries e ON e.id = entry_search.rowid
                    JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
                    JOIN feeds f ON f.id = e.feed_id
                    LEFT JOIN entry_interactions ei
                      ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                    WHERE entry_search MATCH ? AND ${scope.clause}
                      AND ei.filtered_at IS NULL AND ${filterSql(query.filter)}${range.clause}
                    -- Weights: a match in the title counts most, then author.
                    ORDER BY bm25(entry_search, 5.0, 2.0, 1.0), e.id DESC
                    LIMIT ? OFFSET ?`,
                    bindings: [
                        query.match,
                        ...scope.bindings,
                        ...range.bindings,
                        query.limit + 1,
                        query.offset,
                    ],
                }),
            );
            const rows = yield* decodeRows(
                operation,
                SearchRow,
                result.results,
            );
            return {
                results: rows.slice(0, query.limit).map((row) => ({
                    ...entryFromRow(row),
                    snippet: row.snippet ?? '',
                })),
                hasMore: rows.length > query.limit,
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
            const results = yield* withStorageError(
                operation,
                d1.batch(readStatements(userId, entryId, desired, now)),
            );
            return yield* readOutcome(operation, results);
        }),

    setReadMany: (userId, entryIds, desired, now) =>
        applyToEntries(d1, 'reader.entries.read.set', entryIds, (entryId) => ({
            statements: readStatements(userId, entryId, desired, now),
            outcome: readOutcome,
        })),

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

    setStarredMany: (userId, entryIds, desired, now) =>
        applyToEntries(d1, 'reader.entries.star.set', entryIds, (entryId) =>
            timestampChange({
                operation: 'reader.entries.star.set',
                userId,
                entryId,
                desired,
                now,
                column: 'starred_at',
                otherColumn: 'archived_at',
                activity: 'saved',
            }),
        ),

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
            const { results, rows } = yield* readThroughScope(
                d1,
                operation,
                userId,
                { type: 'feed', id: feedId },
                now,
            );
            const activityChanges = yield* changes(operation, results[0]);
            const subscriptionChanges = yield* changes(operation, results[1]);
            if (activityChanges > 1 || subscriptionChanges > 1)
                return yield* Effect.fail(invariantError(operation));
            const row = rows[0];
            if (row === undefined)
                return yield* Effect.fail(new ReaderNotFound());
            if (rows.length !== 1)
                return yield* Effect.fail(invariantError(operation));
            return row;
        }),

    advanceReadThroughScope: (userId, scope, now) =>
        readThroughScope(
            d1,
            'reader.subscriptions.readThrough.advance',
            userId,
            scope,
            now,
        ).pipe(Effect.map(({ rows }) => rows)),
});

/**
 * Marks every entry of the scope's subscriptions as read: each watermark
 * moves to its feed's newest entry, and read overrides at or below it are
 * dropped. One batch of set-based statements covers the whole scope.
 */
const readThroughScope = (
    d1: D1,
    operation: string,
    userId: number,
    scope: ReaderEntryScope,
    now: number,
): Effect.Effect<
    {
        readonly results: D1Result<unknown>[];
        readonly rows: readonly ReaderReadThroughResponse[];
    },
    ReaderStorageError | ReaderInvariantError
> =>
    Effect.gen(function* () {
        const owned = subscriptionScopeSql(scope, userId);
        const newestEntry =
            '(SELECT MAX(id) FROM entries WHERE feed_id = fs.feed_id)';
        const watermarkOf = `(SELECT fs.read_through_entry_id
            FROM feed_subscriptions fs
            WHERE fs.user_id = entry_interactions.user_id
              AND fs.feed_id = entry_interactions.feed_id)`;
        const scopedInteractions = `user_id = ? AND feed_id IN (
            SELECT fs.feed_id FROM feed_subscriptions fs WHERE ${owned.clause})
            AND read_override IS NOT NULL AND entry_id <= ${watermarkOf}`;
        const results = yield* withStorageError(
            operation,
            d1.batch([
                {
                    // Every unread entry is about to be marked read.
                    sql: `INSERT INTO chart_daily_activity (
                            user_id, feed_id, day_start, marked_read_count,
                            marked_unread_count, saved_count, unsaved_count,
                            created_at, updated_at
                        )
                        SELECT ?, counts.feed_id, ?, counts.unread_count, 0, 0, 0, ?, ?
                        FROM (${subscriptionCountsSql(owned.clause)}) counts
                        WHERE counts.unread_count > 0
                        ON CONFLICT(user_id, feed_id, day_start) DO UPDATE SET
                            marked_read_count = marked_read_count + excluded.marked_read_count,
                            updated_at = excluded.updated_at`,
                    bindings: [
                        userId,
                        utcDayStart(now),
                        now,
                        now,
                        ...owned.bindings,
                    ],
                },
                {
                    // Every entry is at or below the newest one, so the
                    // feed's entry count is the new read_through_count.
                    sql: `UPDATE feed_subscriptions AS fs
                        SET read_through_entry_id = ${newestEntry},
                            read_through_count = (
                                SELECT entry_count FROM feeds WHERE id = fs.feed_id),
                            updated_at = ?
                        WHERE ${owned.clause}
                            AND ${newestEntry} IS NOT NULL
                            AND (fs.read_through_entry_id IS NULL
                                OR fs.read_through_entry_id < ${newestEntry})`,
                    bindings: [now, ...owned.bindings],
                },
                {
                    sql: `DELETE FROM entry_interactions
                        WHERE ${scopedInteractions}
                            AND starred_at IS NULL AND archived_at IS NULL
                            AND filtered_at IS NULL`,
                    bindings: [userId, ...owned.bindings],
                },
                {
                    sql: `UPDATE entry_interactions
                        SET read_override = NULL, read_changed_at = NULL, updated_at = ?
                        WHERE ${scopedInteractions}`,
                    bindings: [now, userId, ...owned.bindings],
                },
                {
                    sql: `SELECT fs.feed_id, fs.read_through_entry_id
                        FROM feed_subscriptions fs
                        WHERE ${owned.clause}
                        ORDER BY fs.feed_id`,
                    bindings: owned.bindings,
                },
            ]),
        );
        if (results.length !== 5)
            return yield* Effect.fail(invariantError(operation));
        const rows = yield* decodeRows(
            operation,
            ReadThroughRow,
            results[4]?.results ?? [],
        );
        return {
            results,
            rows: rows.map((row) => ({
                feedId: row.feed_id,
                readThroughEntryId: row.read_through_entry_id,
            })),
        };
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

/** The statements of one starred or archived change, and how to read them. */
const timestampChange = (input: TimestampStateInput): EntryChange => {
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
    const statements = [
        ...activityStatements,
        ...stateStatements,
        canonicalInteractionStatement(input.userId, input.entryId),
    ];
    const stateOffset = activityStatements.length;
    return {
        statements,
        outcome: (operation, results) =>
            Effect.gen(function* () {
                if (activityStatements.length === 1) {
                    const activityChanges = yield* changes(
                        operation,
                        results[0],
                    );
                    if (activityChanges > 1)
                        return yield* Effect.fail(invariantError(operation));
                }
                return yield* mutationResult(
                    operation,
                    results,
                    stateStatements.map((_, index) => stateOffset + index),
                    statements.length - 1,
                );
            }),
    };
};

const setTimestampState = (
    d1: D1,
    input: TimestampStateInput,
): Effect.Effect<
    ReaderInteractionResponse,
    ReaderNotFound | ReaderStorageError | ReaderInvariantError
> =>
    Effect.gen(function* () {
        const change = timestampChange(input);
        const results = yield* withStorageError(
            input.operation,
            d1.batch(change.statements),
        );
        return yield* change.outcome(input.operation, results);
    });

import type {
    ManagedCategory,
    ManagedSubscription,
    SubscriptionFilterRules,
    SubscriptionRefreshRecord,
} from '@shared/schemas/subscriptions';
import { Effect, Schema } from 'effect';

import type { D1, D1OperationError } from '../infrastructure/d1';
import {
    SubscriptionConflict,
    SubscriptionInvariantError,
    SubscriptionNotFound,
    SubscriptionStorageError,
} from './errors';
import { parseStoredFilterRules, serializeFilterRules } from './filter';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const BooleanInt = Schema.Literals([0, 1]);
const NullableTimestamp = Schema.NullOr(Timestamp);

const CategoryRow = Schema.Struct({
    id: SafeId,
    name: Schema.String,
    subscription_count: Count,
});
const SubscriptionRow = Schema.Struct({
    feed_id: SafeId,
    category_id: SafeId,
    category_name: Schema.String,
    feed_name: Schema.String,
    custom_feed_name: Schema.NullOr(Schema.String),
    feed_url: Schema.String,
    site_url: Schema.NullOr(Schema.String),
    favicon_is_dark: Schema.NullOr(BooleanInt),
    entry_count: Count,
    unread_count: Count,
    is_gone: BooleanInt,
    consecutive_failures: Count,
    last_attempt_at: NullableTimestamp,
    last_successful_refresh_at: NullableTimestamp,
    last_failed_refresh_at: NullableTimestamp,
    last_error_class: Schema.NullOr(Schema.String),
    last_error_message: Schema.NullOr(Schema.String),
    filter_rules_json: Schema.NullOr(Schema.String),
    refreshes_json: Schema.String,
});
const RefreshRow = Schema.Struct({
    id: SafeId,
    refreshedAt: Timestamp,
    successful: BooleanInt,
    notModified: BooleanInt,
    httpStatus: Schema.NullOr(Schema.Int),
    entriesCreated: Count,
    errorClass: Schema.NullOr(Schema.String),
    errorMessage: Schema.NullOr(Schema.String),
});
const FilterCandidateRow = Schema.Struct({
    id: SafeId,
    title: Schema.String,
    author: Schema.NullOr(Schema.String),
    content_html: Schema.NullOr(Schema.String),
});
const TotalRow = Schema.Struct({
    total: Count,
    subscription_exists: BooleanInt,
});
const MaxIdRow = Schema.Struct({
    max_id: Schema.NullOr(SafeId),
    subscription_exists: BooleanInt,
});
const FeedIdRow = Schema.Struct({ id: SafeId });

export interface DiscoveredFeedInput {
    readonly proposedId: number;
    readonly feedUrl: string;
    readonly name: string;
    readonly siteUrl: string | null;
    readonly faviconUrl: string | null;
    readonly categoryId: number;
    readonly userId: number;
    readonly now: number;
}

export interface SubscribeDiscoveredResult {
    readonly feedId: number;
    readonly createdFeed: boolean;
    readonly createdSubscription: boolean;
}

export interface SubscriptionFilterCandidate {
    readonly id: number;
    readonly title: string;
    readonly author: string | null;
    readonly contentHtml: string | null;
}

export interface SubscriptionRepository {
    readonly listManagement: (userId: number) => Effect.Effect<
        {
            readonly categories: readonly ManagedCategory[];
            readonly subscriptions: readonly ManagedSubscription[];
        },
        SubscriptionStorageError | SubscriptionInvariantError
    >;
    readonly findSubscription: (
        userId: number,
        feedId: number,
    ) => Effect.Effect<
        ManagedSubscription,
        | SubscriptionNotFound
        | SubscriptionStorageError
        | SubscriptionInvariantError
    >;
    readonly createCategory: (
        id: number,
        userId: number,
        name: string,
        now: number,
    ) => Effect.Effect<
        ManagedCategory,
        | SubscriptionConflict
        | SubscriptionStorageError
        | SubscriptionInvariantError
    >;
    readonly findOrCreateCategory: (
        id: number,
        userId: number,
        name: string,
        now: number,
    ) => Effect.Effect<
        ManagedCategory,
        SubscriptionStorageError | SubscriptionInvariantError
    >;
    readonly updateCategory: (
        userId: number,
        categoryId: number,
        name: string,
        now: number,
    ) => Effect.Effect<
        ManagedCategory,
        | SubscriptionNotFound
        | SubscriptionConflict
        | SubscriptionStorageError
        | SubscriptionInvariantError
    >;
    readonly deleteCategory: (
        userId: number,
        categoryId: number,
    ) => Effect.Effect<
        void,
        | SubscriptionNotFound
        | SubscriptionConflict
        | SubscriptionStorageError
        | SubscriptionInvariantError
    >;
    readonly findFeedByUrl: (
        feedUrl: string,
    ) => Effect.Effect<
        number | null,
        SubscriptionStorageError | SubscriptionInvariantError
    >;
    readonly subscribeExisting: (
        userId: number,
        feedId: number,
        categoryId: number,
        now: number,
    ) => Effect.Effect<
        boolean,
        | SubscriptionNotFound
        | SubscriptionStorageError
        | SubscriptionInvariantError
    >;
    readonly subscribeDiscovered: (
        input: DiscoveredFeedInput,
    ) => Effect.Effect<
        SubscribeDiscoveredResult,
        | SubscriptionNotFound
        | SubscriptionStorageError
        | SubscriptionInvariantError
    >;
    readonly updateSubscription: (
        userId: number,
        feedId: number,
        categoryId: number,
        customFeedName: string | null,
        rules: SubscriptionFilterRules,
        now: number,
    ) => Effect.Effect<
        void,
        | SubscriptionNotFound
        | SubscriptionStorageError
        | SubscriptionInvariantError
    >;
    readonly unsubscribe: (
        userId: number,
        feedId: number,
    ) => Effect.Effect<
        void,
        | SubscriptionNotFound
        | SubscriptionStorageError
        | SubscriptionInvariantError
    >;
    readonly filterEntryCount: (
        userId: number,
        feedId: number,
    ) => Effect.Effect<
        number,
        | SubscriptionNotFound
        | SubscriptionStorageError
        | SubscriptionInvariantError
    >;
    readonly filterHighWatermark: (
        userId: number,
        feedId: number,
    ) => Effect.Effect<
        number | null,
        | SubscriptionNotFound
        | SubscriptionStorageError
        | SubscriptionInvariantError
    >;
    readonly listFilterCandidates: (
        userId: number,
        feedId: number,
        afterId: number,
        throughId: number,
        limit: number,
        includeContent: boolean,
    ) => Effect.Effect<
        readonly SubscriptionFilterCandidate[],
        SubscriptionStorageError | SubscriptionInvariantError
    >;
    readonly replaceFilteredEntries: (
        userId: number,
        feedId: number,
        throughId: number,
        matchedEntryIds: readonly number[],
        now: number,
    ) => Effect.Effect<
        void,
        SubscriptionStorageError | SubscriptionInvariantError
    >;
}

const effectiveRead = `CASE
    WHEN ei.read_override IS NOT NULL THEN ei.read_override
    WHEN fs.read_through_entry_id IS NOT NULL AND e.id <= fs.read_through_entry_id THEN 1
    ELSE 0 END`;
const subscriptionSelect = `SELECT
    fs.feed_id, fs.category_id, c.name AS category_name,
    f.name AS feed_name, fs.custom_feed_name, f.feed_url, f.site_url,
    f.favicon_is_dark,
    (SELECT COUNT(*) FROM entries counted
        LEFT JOIN entry_interactions counted_i
            ON counted_i.user_id = fs.user_id AND counted_i.entry_id = counted.id
        WHERE counted.feed_id = fs.feed_id AND counted_i.filtered_at IS NULL) AS entry_count,
    (SELECT COUNT(*) FROM entries e
        LEFT JOIN entry_interactions ei
            ON ei.user_id = fs.user_id AND ei.entry_id = e.id
        WHERE e.feed_id = fs.feed_id AND ei.filtered_at IS NULL
          AND ${effectiveRead} = 0) AS unread_count,
    f.is_gone, f.consecutive_failures, f.last_attempt_at,
    f.last_successful_refresh_at, f.last_failed_refresh_at,
    f.last_error_class, f.last_error_message,
    fs.filter_rules_json,
    COALESCE((SELECT json_group_array(json_object(
        'id', history.id,
        'refreshedAt', history.refreshed_at,
        'successful', history.was_successful,
        'notModified', history.was_not_modified,
        'httpStatus', history.http_status,
        'entriesCreated', history.entries_created,
        'errorClass', history.error_class,
        'errorMessage', history.error_message
    )) FROM (
        SELECT id, refreshed_at, was_successful, was_not_modified,
            http_status, entries_created, error_class, error_message
        FROM feed_refreshes
        WHERE feed_id = fs.feed_id
        ORDER BY refreshed_at DESC, id DESC LIMIT 10
    ) history), '[]') AS refreshes_json
FROM feed_subscriptions fs
JOIN feeds f ON f.id = fs.feed_id
JOIN subscription_categories c
    ON c.user_id = fs.user_id AND c.id = fs.category_id`;

const invariant = (operation: string) =>
    new SubscriptionInvariantError({ operation });
const storage = (operation: string, cause: D1OperationError) =>
    new SubscriptionStorageError({ operation, cause });
const mapStorage = <A, R>(
    operation: string,
    effect: Effect.Effect<A, D1OperationError, R>,
): Effect.Effect<A, SubscriptionStorageError, R> =>
    effect.pipe(Effect.mapError((cause) => storage(operation, cause)));
const decode = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    value: unknown,
): Effect.Effect<S['Type'], SubscriptionInvariantError> =>
    Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(value),
        catch: () => invariant(operation),
    });
const decodeRows = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    rows: readonly unknown[],
) => Effect.forEach(rows, (row) => decode(operation, schema, row));
const changeCount = (
    operation: string,
    result: D1Result<unknown> | undefined,
): Effect.Effect<number, SubscriptionInvariantError> =>
    result !== undefined &&
    typeof result.meta.changes === 'number' &&
    result.meta.changes >= 0
        ? Effect.succeed(result.meta.changes)
        : Effect.fail(invariant(operation));

const categoryFromRow = (row: typeof CategoryRow.Type): ManagedCategory => ({
    id: row.id,
    name: row.name,
    subscriptionCount: row.subscription_count,
});
const refreshesFromJson = (
    operation: string,
    value: string,
): Effect.Effect<
    readonly SubscriptionRefreshRecord[],
    SubscriptionInvariantError
> =>
    Effect.gen(function* () {
        const parsed = yield* Effect.try({
            try: () => JSON.parse(value) as unknown,
            catch: () => invariant(operation),
        });
        const rows = yield* decode(operation, Schema.Array(RefreshRow), parsed);
        return rows.map((row) => ({
            id: row.id,
            refreshedAt: row.refreshedAt,
            successful: row.successful === 1,
            notModified: row.notModified === 1,
            httpStatus: row.httpStatus,
            entriesCreated: row.entriesCreated,
            errorClass: row.errorClass,
            errorMessage: row.errorMessage,
        }));
    });
const subscriptionFromRow = (
    operation: string,
    row: typeof SubscriptionRow.Type,
): Effect.Effect<ManagedSubscription, SubscriptionInvariantError> =>
    refreshesFromJson(operation, row.refreshes_json).pipe(
        Effect.map((refreshes) => ({
            feedId: row.feed_id,
            categoryId: row.category_id,
            categoryName: row.category_name,
            feedName: row.feed_name,
            customFeedName: row.custom_feed_name,
            feedUrl: row.feed_url,
            siteUrl: row.site_url,
            faviconUrl: `/api/images/feeds/${row.feed_id}/small`,
            faviconIsDark:
                row.favicon_is_dark === null ? null : row.favicon_is_dark === 1,
            entryCount: row.entry_count,
            unreadCount: row.unread_count,
            isGone: row.is_gone === 1,
            consecutiveFailures: row.consecutive_failures,
            lastAttemptAt: row.last_attempt_at,
            lastSuccessfulRefreshAt: row.last_successful_refresh_at,
            lastFailedRefreshAt: row.last_failed_refresh_at,
            lastErrorClass: row.last_error_class,
            lastErrorMessage: row.last_error_message,
            filterRules: parseStoredFilterRules(row.filter_rules_json),
            refreshes,
        })),
    );

const findCategory = (
    d1: D1,
    userId: number,
    categoryId: number,
    operation: string,
): Effect.Effect<
    ManagedCategory | null,
    SubscriptionStorageError | SubscriptionInvariantError
> =>
    Effect.gen(function* () {
        const row = yield* mapStorage(
            operation,
            d1.first({
                sql: `SELECT c.id, c.name,
                    (SELECT COUNT(*) FROM feed_subscriptions fs
                        WHERE fs.user_id = c.user_id AND fs.category_id = c.id) AS subscription_count
                    FROM subscription_categories c
                    WHERE c.user_id = ? AND c.id = ?`,
                bindings: [userId, categoryId],
            }),
        );
        if (row === null) return null;
        return categoryFromRow(yield* decode(operation, CategoryRow, row));
    });

export const makeSubscriptionRepository = (d1: D1): SubscriptionRepository => {
    const findSubscription = (
        userId: number,
        feedId: number,
    ): ReturnType<SubscriptionRepository['findSubscription']> =>
        Effect.gen(function* () {
            const operation = 'subscriptions.find';
            const row = yield* mapStorage(
                operation,
                d1.first({
                    sql: `${subscriptionSelect}
                        WHERE fs.user_id = ? AND fs.feed_id = ?`,
                    bindings: [userId, feedId],
                }),
            );
            if (row === null)
                return yield* Effect.fail(new SubscriptionNotFound());
            return yield* subscriptionFromRow(
                operation,
                yield* decode(operation, SubscriptionRow, row),
            );
        });

    return {
        listManagement: (userId) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.listManagement';
                const [categoryResult, subscriptionResult] = yield* Effect.all(
                    [
                        mapStorage(
                            operation,
                            d1.all({
                                sql: `SELECT c.id, c.name, COUNT(fs.feed_id) AS subscription_count
                                    FROM subscription_categories c
                                    LEFT JOIN feed_subscriptions fs
                                        ON fs.user_id = c.user_id AND fs.category_id = c.id
                                    WHERE c.user_id = ?
                                    GROUP BY c.id, c.name
                                    ORDER BY c.name COLLATE NOCASE, c.id`,
                                bindings: [userId],
                            }),
                        ),
                        mapStorage(
                            operation,
                            d1.all({
                                sql: `${subscriptionSelect}
                                    WHERE fs.user_id = ?
                                    ORDER BY COALESCE(fs.custom_feed_name, f.name) COLLATE NOCASE, fs.feed_id`,
                                bindings: [userId],
                            }),
                        ),
                    ],
                    { concurrency: 'unbounded' },
                );
                const categoryRows = yield* decodeRows(
                    operation,
                    CategoryRow,
                    categoryResult.results,
                );
                const subscriptionRows = yield* decodeRows(
                    operation,
                    SubscriptionRow,
                    subscriptionResult.results,
                );
                const subscriptions = yield* Effect.forEach(
                    subscriptionRows,
                    (row) => subscriptionFromRow(operation, row),
                );
                return {
                    categories: categoryRows.map(categoryFromRow),
                    subscriptions,
                };
            }),

        findSubscription,

        createCategory: (id, userId, name, now) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.category.create';
                const result = yield* mapStorage(
                    operation,
                    d1.run({
                        sql: `INSERT OR IGNORE INTO subscription_categories
                            (id, user_id, name, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?)`,
                        bindings: [id, userId, name, now, now],
                    }),
                );
                const changed = yield* changeCount(operation, result);
                if (changed === 0) {
                    return yield* Effect.fail(
                        new SubscriptionConflict({
                            reason: 'category_name_exists',
                        }),
                    );
                }
                if (changed !== 1)
                    return yield* Effect.fail(invariant(operation));
                const category = yield* findCategory(d1, userId, id, operation);
                if (category === null)
                    return yield* Effect.fail(invariant(operation));
                return category;
            }),

        findOrCreateCategory: (id, userId, name, now) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.category.findOrCreate';
                const result = yield* mapStorage(
                    operation,
                    d1.run({
                        sql: `INSERT OR IGNORE INTO subscription_categories
                            (id, user_id, name, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?)`,
                        bindings: [id, userId, name, now, now],
                    }),
                );
                const changed = yield* changeCount(operation, result);
                if (changed > 1) {
                    return yield* Effect.fail(invariant(operation));
                }
                const row = yield* mapStorage(
                    operation,
                    d1.first({
                        sql: `SELECT c.id, c.name,
                            (SELECT COUNT(*) FROM feed_subscriptions fs
                                WHERE fs.user_id = c.user_id
                                  AND fs.category_id = c.id) AS subscription_count
                            FROM subscription_categories c
                            WHERE c.user_id = ? AND c.name = ? COLLATE NOCASE`,
                        bindings: [userId, name],
                    }),
                );
                if (row === null) {
                    return yield* Effect.fail(invariant(operation));
                }
                return categoryFromRow(
                    yield* decode(operation, CategoryRow, row),
                );
            }),

        updateCategory: (userId, categoryId, name, now) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.category.update';
                const duplicate = yield* mapStorage(
                    operation,
                    d1.first(
                        {
                            sql: `SELECT COUNT(*) AS total
                                FROM subscription_categories
                                WHERE user_id = ? AND id <> ? AND name = ? COLLATE NOCASE`,
                            bindings: [userId, categoryId, name],
                        },
                        'total',
                    ),
                );
                if (duplicate !== 0) {
                    return yield* Effect.fail(
                        new SubscriptionConflict({
                            reason: 'category_name_exists',
                        }),
                    );
                }
                const result = yield* mapStorage(
                    operation,
                    d1.run({
                        sql: `UPDATE subscription_categories
                            SET name = ?, updated_at = ?
                            WHERE user_id = ? AND id = ?`,
                        bindings: [name, now, userId, categoryId],
                    }),
                );
                if ((yield* changeCount(operation, result)) !== 1) {
                    return yield* Effect.fail(new SubscriptionNotFound());
                }
                const category = yield* findCategory(
                    d1,
                    userId,
                    categoryId,
                    operation,
                );
                if (category === null)
                    return yield* Effect.fail(invariant(operation));
                return category;
            }),

        deleteCategory: (userId, categoryId) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.category.delete';
                const category = yield* findCategory(
                    d1,
                    userId,
                    categoryId,
                    operation,
                );
                if (category === null) {
                    return yield* Effect.fail(new SubscriptionNotFound());
                }
                if (category.subscriptionCount > 0) {
                    return yield* Effect.fail(
                        new SubscriptionConflict({ reason: 'category_in_use' }),
                    );
                }
                const result = yield* mapStorage(
                    operation,
                    d1.run({
                        sql: `DELETE FROM subscription_categories
                            WHERE user_id = ? AND id = ?
                              AND NOT EXISTS (
                                SELECT 1 FROM feed_subscriptions
                                WHERE user_id = ? AND category_id = ?
                              )`,
                        bindings: [userId, categoryId, userId, categoryId],
                    }),
                );
                if ((yield* changeCount(operation, result)) !== 1) {
                    return yield* Effect.fail(
                        new SubscriptionConflict({ reason: 'category_in_use' }),
                    );
                }
            }),

        findFeedByUrl: (feedUrl) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.feed.findByUrl';
                const row = yield* mapStorage(
                    operation,
                    d1.first({
                        sql: 'SELECT id FROM feeds WHERE feed_url = ?',
                        bindings: [feedUrl],
                    }),
                );
                if (row === null) return null;
                return (yield* decode(operation, FeedIdRow, row)).id;
            }),

        subscribeExisting: (userId, feedId, categoryId, now) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.subscribeExisting';
                const result = yield* mapStorage(
                    operation,
                    d1.run({
                        sql: `INSERT OR IGNORE INTO feed_subscriptions
                            (user_id, feed_id, category_id, custom_feed_name,
                             filter_rules_json, read_through_entry_id,
                             created_at, updated_at)
                            SELECT ?, f.id, c.id, NULL, NULL, NULL, ?, ?
                            FROM feeds f
                            JOIN subscription_categories c
                              ON c.user_id = ? AND c.id = ?
                            WHERE f.id = ?`,
                        bindings: [
                            userId,
                            now,
                            now,
                            userId,
                            categoryId,
                            feedId,
                        ],
                    }),
                );
                const changed = yield* changeCount(operation, result);
                if (changed === 1) return true;
                if (changed > 1)
                    return yield* Effect.fail(invariant(operation));
                const existing = yield* mapStorage(
                    operation,
                    d1.first<number>(
                        {
                            sql: `SELECT COUNT(*) AS total
                                FROM feed_subscriptions
                                WHERE user_id = ? AND feed_id = ?`,
                            bindings: [userId, feedId],
                        },
                        'total',
                    ),
                );
                if (existing === 1) return false;
                return yield* Effect.fail(new SubscriptionNotFound());
            }),

        subscribeDiscovered: (input) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.subscribe';
                const results = yield* mapStorage(
                    operation,
                    d1.batch([
                        {
                            sql: `INSERT OR IGNORE INTO feeds
                                (id, name, feed_url, site_url, favicon_url,
                                 is_gone, consecutive_failures, next_refresh_at,
                                 created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
                            bindings: [
                                input.proposedId,
                                input.name,
                                input.feedUrl,
                                input.siteUrl,
                                input.faviconUrl,
                                input.now,
                                input.now,
                                input.now,
                            ],
                        },
                        {
                            sql: `INSERT OR IGNORE INTO feed_subscriptions
                                (user_id, feed_id, category_id, custom_feed_name,
                                 filter_rules_json, read_through_entry_id,
                                 created_at, updated_at)
                                SELECT ?, f.id, c.id, NULL, NULL, NULL, ?, ?
                                FROM feeds f
                                JOIN subscription_categories c
                                    ON c.user_id = ? AND c.id = ?
                                WHERE f.feed_url = ?`,
                            bindings: [
                                input.userId,
                                input.now,
                                input.now,
                                input.userId,
                                input.categoryId,
                                input.feedUrl,
                            ],
                        },
                    ]),
                );
                const createdFeed = yield* changeCount(operation, results[0]);
                const createdSubscription = yield* changeCount(
                    operation,
                    results[1],
                );
                if (createdFeed > 1 || createdSubscription > 1) {
                    return yield* Effect.fail(invariant(operation));
                }
                const row = yield* mapStorage(
                    operation,
                    d1.first<{ id: number }>({
                        sql: `SELECT f.id FROM feeds f
                            JOIN feed_subscriptions fs ON fs.feed_id = f.id
                            WHERE f.feed_url = ? AND fs.user_id = ?`,
                        bindings: [input.feedUrl, input.userId],
                    }),
                );
                if (row === null)
                    return yield* Effect.fail(new SubscriptionNotFound());
                const feedId = yield* decode(
                    operation,
                    Schema.Struct({ id: SafeId }),
                    row,
                );
                return {
                    feedId: feedId.id,
                    createdFeed: createdFeed === 1,
                    createdSubscription: createdSubscription === 1,
                };
            }),

        updateSubscription: (
            userId,
            feedId,
            categoryId,
            customFeedName,
            rules,
            now,
        ) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.update';
                const result = yield* mapStorage(
                    operation,
                    d1.run({
                        sql: `UPDATE feed_subscriptions
                            SET category_id = ?, custom_feed_name = ?,
                                filter_rules_json = ?, updated_at = ?
                            WHERE user_id = ? AND feed_id = ?
                              AND EXISTS (
                                SELECT 1 FROM subscription_categories c
                                WHERE c.user_id = ? AND c.id = ?
                              )`,
                        bindings: [
                            categoryId,
                            customFeedName,
                            serializeFilterRules(rules),
                            now,
                            userId,
                            feedId,
                            userId,
                            categoryId,
                        ],
                    }),
                );
                if ((yield* changeCount(operation, result)) !== 1) {
                    return yield* Effect.fail(new SubscriptionNotFound());
                }
            }),

        unsubscribe: (userId, feedId) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.unsubscribe';
                const results = yield* mapStorage(
                    operation,
                    d1.batch([
                        {
                            sql: `DELETE FROM feed_subscriptions
                                WHERE user_id = ? AND feed_id = ?`,
                            bindings: [userId, feedId],
                        },
                        {
                            sql: `DELETE FROM feeds
                                WHERE id = ? AND NOT EXISTS (
                                    SELECT 1 FROM feed_subscriptions
                                    WHERE feed_id = ?
                                )`,
                            bindings: [feedId, feedId],
                        },
                    ]),
                );
                if ((yield* changeCount(operation, results[0])) !== 1) {
                    return yield* Effect.fail(new SubscriptionNotFound());
                }
                const feedChanges = yield* changeCount(operation, results[1]);
                if (feedChanges > 1)
                    return yield* Effect.fail(invariant(operation));
            }),

        filterEntryCount: (userId, feedId) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.filter.count';
                const row = yield* mapStorage(
                    operation,
                    d1.first({
                        sql: `SELECT
                            (SELECT COUNT(*) FROM entries e
                                WHERE e.feed_id = ?) AS total,
                            CASE WHEN EXISTS (
                                SELECT 1 FROM feed_subscriptions fs
                                WHERE fs.user_id = ? AND fs.feed_id = ?
                            ) THEN 1 ELSE 0 END AS subscription_exists`,
                        bindings: [feedId, userId, feedId],
                    }),
                );
                if (row === null)
                    return yield* Effect.fail(invariant(operation));
                const decoded = yield* decode(operation, TotalRow, row);
                if (decoded.subscription_exists === 0) {
                    return yield* Effect.fail(new SubscriptionNotFound());
                }
                return decoded.total;
            }),

        filterHighWatermark: (userId, feedId) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.filter.highWatermark';
                const row = yield* mapStorage(
                    operation,
                    d1.first({
                        sql: `SELECT
                            (SELECT MAX(e.id) FROM entries e
                                WHERE e.feed_id = ?) AS max_id,
                            CASE WHEN EXISTS (
                                SELECT 1 FROM feed_subscriptions fs
                                WHERE fs.user_id = ? AND fs.feed_id = ?
                            ) THEN 1 ELSE 0 END AS subscription_exists`,
                        bindings: [feedId, userId, feedId],
                    }),
                );
                if (row === null)
                    return yield* Effect.fail(invariant(operation));
                const decoded = yield* decode(operation, MaxIdRow, row);
                if (decoded.subscription_exists === 0) {
                    return yield* Effect.fail(new SubscriptionNotFound());
                }
                return decoded.max_id;
            }),

        listFilterCandidates: (
            userId,
            feedId,
            afterId,
            throughId,
            limit,
            includeContent,
        ) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.filter.candidates';
                const result = yield* mapStorage(
                    operation,
                    d1.all({
                        sql: `SELECT e.id, e.title, e.author,
                            ${includeContent ? 'ec.content_html' : 'NULL'} AS content_html
                            FROM feed_subscriptions fs
                            JOIN entries e ON e.feed_id = fs.feed_id
                            LEFT JOIN entry_contents ec ON ec.entry_id = e.id
                            WHERE fs.user_id = ? AND fs.feed_id = ?
                              AND e.id > ? AND e.id <= ?
                            ORDER BY e.id LIMIT ?`,
                        bindings: [
                            userId,
                            feedId,
                            afterId,
                            throughId,
                            Math.max(1, Math.min(100, Math.trunc(limit))),
                        ],
                    }),
                );
                return (yield* decodeRows(
                    operation,
                    FilterCandidateRow,
                    result.results,
                )).map((row) => ({
                    id: row.id,
                    title: row.title,
                    author: row.author,
                    contentHtml: row.content_html,
                }));
            }),

        replaceFilteredEntries: (
            userId,
            feedId,
            throughId,
            matchedEntryIds,
            now,
        ) =>
            Effect.gen(function* () {
                const operation = 'subscriptions.filter.replace';
                const idsJson = JSON.stringify(matchedEntryIds);
                const results = yield* mapStorage(
                    operation,
                    d1.batch([
                        {
                            sql: `DELETE FROM entry_interactions
                                WHERE user_id = ? AND feed_id = ?
                                  AND entry_id <= ? AND filtered_at IS NOT NULL
                                  AND read_override IS NULL
                                  AND starred_at IS NULL AND archived_at IS NULL`,
                            bindings: [userId, feedId, throughId],
                        },
                        {
                            sql: `UPDATE entry_interactions
                                SET filtered_at = NULL, updated_at = ?
                                WHERE user_id = ? AND feed_id = ?
                                  AND entry_id <= ? AND filtered_at IS NOT NULL`,
                            bindings: [now, userId, feedId, throughId],
                        },
                        {
                            sql: `INSERT INTO entry_interactions
                                (user_id, feed_id, entry_id, read_override,
                                 read_changed_at, starred_at, archived_at,
                                 filtered_at, created_at, updated_at)
                                SELECT ?, ?, CAST(ids.value AS INTEGER),
                                    NULL, NULL, NULL, NULL, ?, ?, ?
                                FROM json_each(?) ids
                                JOIN entries e
                                    ON e.id = CAST(ids.value AS INTEGER)
                                   AND e.feed_id = ?
                                WHERE 1
                                ON CONFLICT(user_id, entry_id) DO UPDATE SET
                                    filtered_at = excluded.filtered_at,
                                    updated_at = excluded.updated_at`,
                            bindings: [
                                userId,
                                feedId,
                                now,
                                now,
                                now,
                                idsJson,
                                feedId,
                            ],
                        },
                    ]),
                );
                for (const result of results) {
                    yield* changeCount(operation, result);
                }
            }),
    };
};

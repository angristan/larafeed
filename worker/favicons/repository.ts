import { Effect, Schema } from 'effect';

import type { D1, D1OperationError } from '../infrastructure/d1';

const TargetRow = Schema.Struct({
    feed_id: Schema.Int,
    feed_url: Schema.String,
    site_url: Schema.NullOr(Schema.String),
    favicon_url: Schema.NullOr(Schema.String),
    favicon_is_dark: Schema.NullOr(Schema.Literals([0, 1])),
});

export interface FaviconTarget {
    readonly feedId: number;
    readonly feedUrl: string;
    readonly siteUrl: string | null;
    readonly faviconUrl: string | null;
    readonly faviconIsDark: boolean | null;
}

export class FaviconStorageError extends Schema.TaggedErrorClass<FaviconStorageError>()(
    'FaviconStorageError',
    { operation: Schema.String, cause: Schema.Defect() },
) {}
export class FaviconNotFound extends Schema.TaggedErrorClass<FaviconNotFound>()(
    'FaviconNotFound',
    {},
) {}
export class FaviconInvariantError extends Schema.TaggedErrorClass<FaviconInvariantError>()(
    'FaviconInvariantError',
    { operation: Schema.String },
) {}

export interface FaviconRepository {
    readonly findOwnedTarget: (
        userId: number,
        feedId: number,
    ) => Effect.Effect<
        FaviconTarget,
        FaviconNotFound | FaviconStorageError | FaviconInvariantError
    >;
    readonly findStaleTarget: (
        feedId: number,
        cutoff: number,
    ) => Effect.Effect<
        FaviconTarget | null,
        FaviconStorageError | FaviconInvariantError
    >;
    readonly listStaleTargets: (
        cutoff: number,
        limit: number,
    ) => Effect.Effect<
        readonly FaviconTarget[],
        FaviconStorageError | FaviconInvariantError
    >;
    readonly update: (
        feedId: number,
        faviconUrl: string | null,
        faviconIsDark: boolean | null,
        now: number,
    ) => Effect.Effect<
        void,
        FaviconNotFound | FaviconStorageError | FaviconInvariantError
    >;
}

const storage = (operation: string, cause: D1OperationError) =>
    new FaviconStorageError({ operation, cause });
const decodeRows = (
    operation: string,
    rows: readonly unknown[],
): Effect.Effect<readonly FaviconTarget[], FaviconInvariantError> =>
    Effect.try({
        try: () =>
            rows.map((value) => {
                const row = Schema.decodeUnknownSync(TargetRow)(value);
                return {
                    feedId: row.feed_id,
                    feedUrl: row.feed_url,
                    siteUrl: row.site_url,
                    faviconUrl: row.favicon_url,
                    faviconIsDark:
                        row.favicon_is_dark === null
                            ? null
                            : row.favicon_is_dark === 1,
                };
            }),
        catch: () => new FaviconInvariantError({ operation }),
    });

export const makeFaviconRepository = (d1: D1): FaviconRepository => ({
    findOwnedTarget: (userId, feedId) =>
        Effect.gen(function* () {
            const operation = 'favicon.findOwned';
            const result = yield* d1
                .all({
                    sql: `SELECT f.id AS feed_id, f.feed_url, f.site_url,
                            f.favicon_url, f.favicon_is_dark
                        FROM feeds f
                        JOIN feed_subscriptions fs ON fs.feed_id = f.id
                        WHERE fs.user_id = ? AND fs.feed_id = ?`,
                    bindings: [userId, feedId],
                })
                .pipe(Effect.mapError((cause) => storage(operation, cause)));
            const rows = yield* decodeRows(operation, result.results);
            if (rows.length === 0)
                return yield* Effect.fail(new FaviconNotFound());
            if (rows.length !== 1)
                return yield* Effect.fail(
                    new FaviconInvariantError({ operation }),
                );
            return rows[0] as FaviconTarget;
        }),
    findStaleTarget: (feedId, cutoff) =>
        Effect.gen(function* () {
            const operation = 'favicon.findStale';
            const result = yield* d1
                .all({
                    sql: `SELECT id AS feed_id, feed_url, site_url, favicon_url,
                            favicon_is_dark
                        FROM feeds
                        WHERE id = ?
                          AND (favicon_updated_at IS NULL OR favicon_updated_at < ?)
                          AND EXISTS (
                            SELECT 1 FROM feed_subscriptions fs
                            WHERE fs.feed_id = feeds.id
                          )`,
                    bindings: [feedId, cutoff],
                })
                .pipe(Effect.mapError((cause) => storage(operation, cause)));
            const rows = yield* decodeRows(operation, result.results);
            if (rows.length > 1)
                return yield* Effect.fail(
                    new FaviconInvariantError({ operation }),
                );
            return rows[0] ?? null;
        }),
    listStaleTargets: (cutoff, limit) =>
        d1
            .all({
                sql: `SELECT id AS feed_id, feed_url, site_url, favicon_url,
                        favicon_is_dark
                    FROM feeds
                    WHERE (favicon_updated_at IS NULL OR favicon_updated_at < ?)
                      AND EXISTS (
                        SELECT 1 FROM feed_subscriptions fs
                        WHERE fs.feed_id = feeds.id
                      )
                    ORDER BY COALESCE(favicon_updated_at, 0), id
                    LIMIT ?`,
                bindings: [cutoff, limit],
            })
            .pipe(
                Effect.mapError((cause) => storage('favicon.listStale', cause)),
                Effect.flatMap((result) =>
                    decodeRows('favicon.listStale', result.results),
                ),
            ),
    update: (feedId, faviconUrl, faviconIsDark, now) =>
        Effect.gen(function* () {
            const operation = 'favicon.update';
            const result = yield* d1
                .run({
                    sql: `UPDATE feeds
                        SET favicon_url = ?, favicon_is_dark = ?,
                            favicon_updated_at = ?, updated_at = ?
                        WHERE id = ?`,
                    bindings: [
                        faviconUrl,
                        faviconIsDark === null ? null : faviconIsDark ? 1 : 0,
                        now,
                        now,
                        feedId,
                    ],
                })
                .pipe(Effect.mapError((cause) => storage(operation, cause)));
            const count = result.meta.changes;
            if (count === 1) return;
            if (count === 0) return yield* Effect.fail(new FaviconNotFound());
            return yield* Effect.fail(new FaviconInvariantError({ operation }));
        }),
});

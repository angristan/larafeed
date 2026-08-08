import { Effect, Schema } from 'effect';

import type { D1 } from '../infrastructure/d1';
import {
    FullContentInvariantError,
    FullContentNotFound,
    FullContentStorageError,
} from './errors';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const OwnedEntryRow = Schema.Struct({
    entry_id: SafeId,
    title: Schema.String,
    url: Schema.NullOr(Schema.String),
});

export interface OwnedFullContentEntry {
    readonly entryId: number;
    readonly title: string;
    readonly url: string | null;
}

export interface FullContentRepository {
    readonly findOwnedEntry: (
        userId: number,
        entryId: number,
    ) => Effect.Effect<
        OwnedFullContentEntry,
        | FullContentNotFound
        | FullContentStorageError
        | FullContentInvariantError
    >;
}

export const makeFullContentRepository = (d1: D1): FullContentRepository => ({
    findOwnedEntry: (userId, entryId) =>
        Effect.gen(function* () {
            const operation = 'fullContent.entry.find';
            const value = yield* d1
                .first({
                    sql: `SELECT e.id AS entry_id, e.title, e.url
                        FROM entries e
                        JOIN feed_subscriptions fs
                            ON fs.feed_id = e.feed_id AND fs.user_id = ?
                        LEFT JOIN entry_interactions ei
                            ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                        WHERE e.id = ? AND ei.filtered_at IS NULL
                        LIMIT 1`,
                    bindings: [userId, entryId],
                })
                .pipe(
                    Effect.mapError(
                        (cause) =>
                            new FullContentStorageError({ operation, cause }),
                    ),
                );
            if (value === null) {
                return yield* Effect.fail(new FullContentNotFound());
            }
            const row = yield* Effect.try({
                try: () => Schema.decodeUnknownSync(OwnedEntryRow)(value),
                catch: () => new FullContentInvariantError({ operation }),
            });
            return { entryId: row.entry_id, title: row.title, url: row.url };
        }),
});

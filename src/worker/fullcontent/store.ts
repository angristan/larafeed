import { Effect, Schema } from 'effect';

import { FullContentStorageError } from './errors';

export const FULL_CONTENT_TTL_SECONDS = 60 * 24 * 60 * 60;

const StoredSummary = Schema.Struct({
    html: Schema.String,
    model: Schema.String,
    promptVersion: Schema.String,
    generatedAt: Schema.Int,
});

export const StoredFullContent = Schema.Struct({
    version: Schema.Literals([1]),
    entryId: Schema.Int,
    sourceUrl: Schema.String,
    fetchedAt: Schema.Int,
    html: Schema.String,
    summary: Schema.NullOr(StoredSummary),
});
export type StoredFullContent = typeof StoredFullContent.Type;

export interface FullContentStore {
    readonly load: (
        entryId: number,
    ) => Effect.Effect<StoredFullContent | null, FullContentStorageError>;
    readonly save: (
        record: StoredFullContent,
    ) => Effect.Effect<void, FullContentStorageError>;
}

const storeKey = (entryId: number): string => `entry:${entryId}:full:v1`;

export const makeKvFullContentStore = (kv: KVNamespace): FullContentStore => ({
    load: (entryId) =>
        Effect.tryPromise({
            try: () => kv.get(storeKey(entryId), 'json'),
            catch: (cause) =>
                new FullContentStorageError({
                    operation: 'fullContent.load',
                    cause,
                }),
        }).pipe(
            Effect.map((value) => {
                if (value === null) return null;
                // A corrupt or outdated record is treated as a cache miss so
                // the next fetch replaces it.
                try {
                    return Schema.decodeUnknownSync(StoredFullContent)(value);
                } catch {
                    return null;
                }
            }),
        ),
    save: (record) =>
        Effect.tryPromise({
            try: () =>
                kv.put(
                    storeKey(record.entryId),
                    JSON.stringify(
                        Schema.encodeUnknownSync(StoredFullContent)(record),
                    ),
                    { expirationTtl: FULL_CONTENT_TTL_SECONDS },
                ),
            catch: (cause) =>
                new FullContentStorageError({
                    operation: 'fullContent.save',
                    cause,
                }),
        }).pipe(Effect.asVoid),
});

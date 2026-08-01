import type { EntrySummary } from '@shared/schemas/summaries';
import { Effect, Schema } from 'effect';

import type { D1, D1OperationError } from '../infrastructure/d1';
import {
    SummaryInvariantError,
    SummaryNotFound,
    SummaryStorageError,
} from './errors';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const OwnedEntryRow = Schema.Struct({
    entry_id: SafeId,
    title: Schema.String,
    url: Schema.NullOr(Schema.String),
    content_html: Schema.NullOr(Schema.String),
    content_hash: Schema.Unknown,
    summary_id: Schema.NullOr(SafeId),
    summary_html: Schema.NullOr(Schema.String),
    summary_model: Schema.NullOr(Schema.String),
    summary_prompt_version: Schema.NullOr(Schema.String),
    summary_created_at: Schema.NullOr(Timestamp),
});

export interface SummaryCacheKey {
    readonly model: string;
    readonly promptVersion: string;
}

export interface OwnedSummaryEntry {
    readonly entryId: number;
    readonly title: string;
    readonly url: string | null;
    readonly contentHtml: string | null;
    readonly contentHash: Uint8Array | null;
    readonly summary: EntrySummary | null;
}

export interface SaveSummaryInput extends SummaryCacheKey {
    readonly id: number;
    readonly userId: number;
    readonly entryId: number;
    readonly contentHash: Uint8Array;
    readonly html: string;
    readonly now: number;
}

export interface SummaryRepository {
    readonly findOwnedEntry: (
        userId: number,
        entryId: number,
        key: SummaryCacheKey,
    ) => Effect.Effect<
        OwnedSummaryEntry,
        SummaryNotFound | SummaryStorageError | SummaryInvariantError
    >;
    readonly saveSummary: (
        input: SaveSummaryInput,
    ) => Effect.Effect<
        EntrySummary,
        SummaryNotFound | SummaryStorageError | SummaryInvariantError
    >;
}

const invariant = (operation: string) =>
    new SummaryInvariantError({ operation });
const withStorageError = <A, R>(
    operation: string,
    effect: Effect.Effect<A, D1OperationError, R>,
): Effect.Effect<A, SummaryStorageError, R> =>
    effect.pipe(
        Effect.mapError(
            (cause) => new SummaryStorageError({ operation, cause }),
        ),
    );
const decode = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    value: unknown,
): Effect.Effect<S['Type'], SummaryInvariantError> =>
    Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(value),
        catch: () => invariant(operation),
    });

const blob = (
    operation: string,
    value: unknown,
): Effect.Effect<Uint8Array | null, SummaryInvariantError> => {
    if (value === null) return Effect.succeed(null);

    return Effect.try({
        try: () => {
            let source: Uint8Array;
            if (value instanceof ArrayBuffer) {
                source = new Uint8Array(value);
            } else if (ArrayBuffer.isView(value)) {
                source = new Uint8Array(
                    value.buffer,
                    value.byteOffset,
                    value.byteLength,
                );
            } else if (
                Array.isArray(value) &&
                value.length === 32 &&
                value.every(
                    (byte) =>
                        Number.isInteger(byte) && byte >= 0 && byte <= 255,
                )
            ) {
                source = Uint8Array.from(value as number[]);
            } else {
                throw new Error('Expected BLOB');
            }
            if (source.byteLength !== 32) {
                throw new Error('Unexpected BLOB length');
            }
            return Uint8Array.from(source);
        },
        catch: () => invariant(operation),
    });
};

const fromRow = (
    operation: string,
    row: typeof OwnedEntryRow.Type,
): Effect.Effect<OwnedSummaryEntry, SummaryInvariantError> =>
    Effect.gen(function* () {
        const contentHash = yield* blob(operation, row.content_hash);
        if ((row.content_html === null) !== (contentHash === null)) {
            return yield* Effect.fail(invariant(operation));
        }

        const summaryMissing =
            row.summary_id === null &&
            row.summary_html === null &&
            row.summary_model === null &&
            row.summary_prompt_version === null &&
            row.summary_created_at === null;
        const summaryComplete =
            row.summary_id !== null &&
            row.summary_html !== null &&
            row.summary_model !== null &&
            row.summary_prompt_version !== null &&
            row.summary_created_at !== null;
        if (!summaryMissing && !summaryComplete) {
            return yield* Effect.fail(invariant(operation));
        }

        return {
            entryId: row.entry_id,
            title: row.title,
            url: row.url,
            contentHtml: row.content_html,
            contentHash,
            summary: summaryComplete
                ? {
                      id: row.summary_id,
                      entryId: row.entry_id,
                      html: row.summary_html,
                      model: row.summary_model,
                      promptVersion: row.summary_prompt_version,
                      generatedAt: row.summary_created_at,
                  }
                : null,
        };
    });

export const makeSummaryRepository = (d1: D1): SummaryRepository => {
    const findOwnedEntry: SummaryRepository['findOwnedEntry'] = (
        userId,
        entryId,
        key,
    ) =>
        Effect.gen(function* () {
            const operation = 'summaries.entry.find';
            const value = yield* withStorageError(
                operation,
                d1.first({
                    sql: `SELECT e.id AS entry_id, e.title, e.url,
                        ec.content_html, ec.content_hash,
                        es.id AS summary_id, es.summary_html,
                        es.model AS summary_model,
                        es.prompt_version AS summary_prompt_version,
                        es.created_at AS summary_created_at
                    FROM entries e
                    JOIN feed_subscriptions fs
                        ON fs.feed_id = e.feed_id AND fs.user_id = ?
                    LEFT JOIN entry_interactions ei
                        ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                    LEFT JOIN entry_contents ec ON ec.entry_id = e.id
                    LEFT JOIN entry_summaries es
                        ON es.entry_id = e.id
                        AND es.content_hash = ec.content_hash
                        AND es.model = ? AND es.prompt_version = ?
                    WHERE e.id = ? AND ei.filtered_at IS NULL`,
                    bindings: [userId, key.model, key.promptVersion, entryId],
                }),
            );
            if (value === null)
                return yield* Effect.fail(new SummaryNotFound());
            return yield* fromRow(
                operation,
                yield* decode(operation, OwnedEntryRow, value),
            );
        });

    return {
        findOwnedEntry,
        saveSummary: (input) =>
            Effect.gen(function* () {
                const operation = 'summaries.entry.save';
                yield* withStorageError(
                    operation,
                    d1.run({
                        sql: `INSERT INTO entry_summaries (
                            id, entry_id, requested_by_user_id, content_hash,
                            model, prompt_version, summary_html,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(entry_id, content_hash, model, prompt_version)
                        DO NOTHING`,
                        bindings: [
                            input.id,
                            input.entryId,
                            input.userId,
                            input.contentHash,
                            input.model,
                            input.promptVersion,
                            input.html,
                            input.now,
                            input.now,
                        ],
                    }),
                );

                const reloaded = yield* findOwnedEntry(
                    input.userId,
                    input.entryId,
                    input,
                );
                if (reloaded.summary === null) {
                    return yield* Effect.fail(invariant(operation));
                }
                return reloaded.summary;
            }),
    };
};

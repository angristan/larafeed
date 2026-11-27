import { Effect } from 'effect';

import type { D1, D1Statement } from '../infrastructure/d1';
import { htmlToText } from '../mcp/content';
import { recordCronResult } from '../observability';

/*
 * Keeps `entry_search` in step with `entries`, from the scheduled handler.
 *
 *   entries (new, or updated_at > search_indexed_at)
 *        │  read up to BATCH_SIZE, oldest ID first
 *        ▼
 *   HTML → plain text (HTMLRewriter)
 *        │
 *        ▼  one D1 batch (a transaction)
 *   delete old index rows → insert new rows → stamp search_indexed_at
 *
 * Feed refreshes bump `entries.updated_at` when the title, author, or content
 * changes, so stale entries show up in the same pending query. Deleting an
 * entry removes its index row through the `entries_delete_search` trigger.
 */

// About 200 entries of typical feed HTML is under 2 MB of text work and a
// few dozen D1 statements, well inside one cron invocation.
const BATCH_SIZE = 200;
// The index stores the first 100,000 characters of each article body.
const MAX_BODY_CHARS = 100_000;
// D1 allows at most 100 bound parameters per statement.
const INSERT_ROWS_PER_STATEMENT = 25; // 4 parameters per row
const STAMP_ROWS_PER_STATEMENT = 50; // 2 parameters per row
const DELETE_IDS_PER_STATEMENT = 100;

interface PendingEntry {
    readonly id: number;
    readonly title: string;
    readonly author: string | null;
    readonly updated_at: number;
    readonly content_html: string | null;
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        result.push(items.slice(index, index + size));
    }
    return result;
};

const placeholders = (count: number, group: string): string =>
    Array.from({ length: count }, () => group).join(', ');

/** Builds the statements that replace the index rows for a batch. */
export const indexStatements = (
    rows: readonly {
        readonly id: number;
        readonly title: string;
        readonly author: string;
        readonly body: string;
        readonly updatedAt: number;
    }[],
): D1Statement[] => [
    ...chunks(rows, DELETE_IDS_PER_STATEMENT).map((chunk) => ({
        sql: `DELETE FROM entry_search WHERE rowid IN (${placeholders(chunk.length, '?')})`,
        bindings: chunk.map((row) => row.id),
    })),
    ...chunks(rows, INSERT_ROWS_PER_STATEMENT).map((chunk) => ({
        // An entry deleted after the pending read has already lost its row
        // to the delete trigger. Skip it instead of indexing it again.
        sql: `INSERT INTO entry_search (rowid, title, author, body)
              SELECT v.column1, v.column2, v.column3, v.column4
              FROM (VALUES ${placeholders(chunk.length, '(?, ?, ?, ?)')}) v
              WHERE EXISTS (SELECT 1 FROM entries e WHERE e.id = v.column1)`,
        bindings: chunk.flatMap((row) => [
            row.id,
            row.title,
            row.author,
            row.body,
        ]),
    })),
    // Stamp with the updated_at that was read. If a refresh changed the
    // entry meanwhile, its newer updated_at keeps it pending for next run.
    ...chunks(rows, STAMP_ROWS_PER_STATEMENT).map((chunk) => ({
        sql: `UPDATE entries SET search_indexed_at = updated_at
              WHERE (id, updated_at) IN (VALUES ${placeholders(chunk.length, '(?, ?)')})`,
        bindings: chunk.flatMap((row) => [row.id, row.updatedAt]),
    })),
];

export interface SearchIndexRun {
    readonly indexed: number;
    /** True when the run filled a whole batch, so more may be pending. */
    readonly backlog: boolean;
}

export const runSearchIndexer = (d1: D1) =>
    Effect.gen(function* () {
        const pending = yield* d1.all<PendingEntry>({
            sql: `SELECT e.id, e.title, e.author, e.updated_at,
                    substr(ec.content_html, 1, ?) AS content_html
                  FROM entries e
                  LEFT JOIN entry_contents ec ON ec.entry_id = e.id
                  WHERE e.search_indexed_at IS NULL
                     OR e.search_indexed_at < e.updated_at
                  ORDER BY e.id
                  LIMIT ?`,
            // HTML is longer than its text; read enough to fill the body.
            bindings: [MAX_BODY_CHARS * 2, BATCH_SIZE],
        });

        const rows = yield* Effect.forEach(
            pending.results,
            (entry) =>
                Effect.promise(() => htmlToText(entry.content_html ?? '')).pipe(
                    Effect.map((text) => ({
                        id: entry.id,
                        title: entry.title,
                        author: entry.author ?? '',
                        body: text.slice(0, MAX_BODY_CHARS),
                        updatedAt: entry.updated_at,
                    })),
                ),
            { concurrency: 8 },
        );
        if (rows.length > 0) {
            yield* d1.batch(indexStatements(rows));
        }

        return {
            indexed: rows.length,
            backlog: pending.results.length === BATCH_SIZE,
        } satisfies SearchIndexRun;
    });

export const handleSearchIndexCron = (d1: D1): Promise<SearchIndexRun> =>
    Effect.runPromise(
        runSearchIndexer(d1).pipe(
            Effect.tap((run) =>
                Effect.sync(() =>
                    recordCronResult('search', {
                        'app.search.indexed': run.indexed,
                        'app.search.backlog': run.backlog,
                    }),
                ),
            ),
        ),
    );

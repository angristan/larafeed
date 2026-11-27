import { Effect } from 'effect';

import type { D1 } from '../infrastructure/d1';

/** A D1 that adds up the rows each statement reads. */
export const measuredD1 = (inner: D1) => {
    let rowsRead = 0;
    const add = (result: D1Result<unknown>) => {
        rowsRead += result.meta.rows_read;
    };
    const d1: D1 = {
        ...inner,
        all: <T>(statement: Parameters<D1['all']>[0]) =>
            inner.all<T>(statement).pipe(
                Effect.map((result) => {
                    add(result);
                    return result;
                }),
            ),
        batch: <T>(statements: Parameters<D1['batch']>[0]) =>
            inner.batch<T>(statements).pipe(
                Effect.map((results) => {
                    results.forEach(add);
                    return results;
                }),
            ),
        first: ((statement: Parameters<D1['all']>[0], column?: string) =>
            inner.all<Record<string, unknown>>(statement).pipe(
                Effect.map((result) => {
                    add(result);
                    const row = result.results[0] ?? null;
                    return column === undefined ? row : (row?.[column] ?? null);
                }),
            )) as D1['first'],
    };
    return {
        d1,
        take: () => {
            const value = rowsRead;
            rowsRead = 0;
            return value;
        },
    };
};

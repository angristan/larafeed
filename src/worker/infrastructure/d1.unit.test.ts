import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
    type D1Operation,
    D1OperationError,
    D1Service,
    makeD1,
    makeD1Layer,
} from './d1';

const makeResult = <T>(marker: string): D1Result<T> => ({
    success: true,
    results: [],
    meta: {
        duration: 1,
        size_after: 2,
        rows_read: 3,
        rows_written: 4,
        last_row_id: 5,
        changed_db: true,
        changes: 6,
        served_by_region: 'WEUR',
        served_by_primary: false,
        marker,
    },
});

type StatementOperation = 'first' | 'all' | 'run';

interface StatementCall {
    readonly sql: string;
    bindings?: readonly unknown[];
    operation?: StatementOperation;
    columnName?: string;
}

class FakePreparedStatement implements D1PreparedStatement {
    constructor(
        private readonly call: StatementCall,
        private readonly rejectedOperation?: StatementOperation,
        private readonly rejection?: unknown,
    ) {}

    bind(...values: unknown[]): D1PreparedStatement {
        this.call.bindings = values;
        return this;
    }

    first<T = unknown>(columnName: string): Promise<T | null>;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    first<T>(columnName?: string): Promise<T | null> {
        this.call.operation = 'first';
        this.call.columnName = columnName;

        return this.rejectedOperation === 'first'
            ? Promise.reject(this.rejection)
            : Promise.resolve(null);
    }

    run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        this.call.operation = 'run';
        return this.complete('run', makeResult<T>('run'));
    }

    all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        this.call.operation = 'all';
        return this.complete('all', makeResult<T>('all'));
    }

    raw<T = unknown[]>(options: {
        columnNames: true;
    }): Promise<[string[], ...T[]]>;
    raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
    raw<T = unknown[]>(_options?: {
        columnNames?: boolean;
    }): Promise<T[] | [string[], ...T[]]> {
        return Promise.resolve([]);
    }

    private complete<T>(operation: StatementOperation, value: T): Promise<T> {
        return operation === this.rejectedOperation
            ? Promise.reject(this.rejection)
            : Promise.resolve(value);
    }
}

class FakeSession implements D1DatabaseSession {
    readonly calls: StatementCall[] = [];
    batchCalls = 0;
    bookmarkCalls = 0;
    rejectedOperation?: StatementOperation | 'batch';
    rejection?: unknown;

    constructor(public bookmark: D1SessionBookmark | null = null) {}

    prepare(query: string): D1PreparedStatement {
        const call: StatementCall = { sql: query };
        this.calls.push(call);

        return new FakePreparedStatement(
            call,
            this.rejectedOperation === 'batch'
                ? undefined
                : this.rejectedOperation,
            this.rejection,
        );
    }

    batch<T = unknown>(
        statements: D1PreparedStatement[],
    ): Promise<D1Result<T>[]> {
        this.batchCalls += 1;

        if (this.rejectedOperation === 'batch') {
            return Promise.reject(this.rejection);
        }

        return Promise.resolve(
            statements.map((_, index) => makeResult<T>(`batch-${index}`)),
        );
    }

    getBookmark(): D1SessionBookmark | null {
        this.bookmarkCalls += 1;
        return this.bookmark;
    }
}

class FakeDatabase implements D1Database {
    readonly calls: StatementCall[] = [];
    readonly session = new FakeSession();
    readonly sessionAnchors: Array<
        D1SessionBookmark | D1SessionConstraint | undefined
    > = [];
    batchCalls = 0;
    rejectedOperation?: StatementOperation | 'batch';
    rejection?: unknown;

    prepare(query: string): D1PreparedStatement {
        const call: StatementCall = { sql: query };
        this.calls.push(call);

        return new FakePreparedStatement(
            call,
            this.rejectedOperation === 'batch'
                ? undefined
                : this.rejectedOperation,
            this.rejection,
        );
    }

    batch<T = unknown>(
        statements: D1PreparedStatement[],
    ): Promise<D1Result<T>[]> {
        this.batchCalls += 1;

        if (this.rejectedOperation === 'batch') {
            return Promise.reject(this.rejection);
        }

        return Promise.resolve(
            statements.map((_, index) => makeResult<T>(`batch-${index}`)),
        );
    }

    exec(_query: string): Promise<D1ExecResult> {
        return Promise.resolve({ count: 0, duration: 0 });
    }

    withSession(
        constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint,
    ): D1DatabaseSession {
        this.sessionAnchors.push(constraintOrBookmark);
        this.session.rejectedOperation = this.rejectedOperation;
        this.session.rejection = this.rejection;
        return this.session;
    }

    dump(): Promise<ArrayBuffer> {
        return Promise.resolve(new ArrayBuffer(0));
    }
}

describe('native D1 Effect adapter', () => {
    it('prepares descriptors and preserves first overloads', async () => {
        const database = new FakeDatabase();
        const d1 = makeD1(database);

        await Effect.runPromise(d1.first({ sql: 'SELECT * FROM feeds' }));
        await Effect.runPromise(
            d1.first(
                {
                    sql: 'SELECT title FROM feeds WHERE id = ?',
                    bindings: [42],
                },
                'title',
            ),
        );

        expect(database.sessionAnchors).toEqual(['first-primary']);
        expect(database.calls).toEqual([]);
        expect(database.session.calls).toEqual([
            {
                sql: 'SELECT * FROM feeds',
                operation: 'first',
                columnName: undefined,
            },
            {
                sql: 'SELECT title FROM feeds WHERE id = ?',
                bindings: [42],
                operation: 'first',
                columnName: 'title',
            },
        ]);
    });

    it('reuses one lazy primary session and preserves complete metadata', async () => {
        const database = new FakeDatabase();
        const d1 = makeD1(database);

        expect(database.sessionAnchors).toEqual([]);
        const allResult = await Effect.runPromise(
            d1.all({ sql: 'SELECT * FROM feeds' }),
        );
        const runResult = await Effect.runPromise(
            d1.run({
                sql: 'UPDATE feeds SET title = ? WHERE id = ?',
                bindings: ['New title', 42],
            }),
        );
        await Effect.runPromise(
            d1.first({ sql: 'SELECT title FROM feeds WHERE id = 42' }),
        );

        expect(database.sessionAnchors).toEqual(['first-primary']);
        expect(database.calls).toEqual([]);
        expect(database.session.calls).toHaveLength(3);
        expect(allResult).toEqual(makeResult('all'));
        expect(runResult).toEqual(makeResult('run'));
        expect(runResult.meta).toMatchObject({
            rows_read: 3,
            rows_written: 4,
            last_row_id: 5,
            changes: 6,
            served_by_region: 'WEUR',
            served_by_primary: false,
            marker: 'run',
        });
    });

    it('uses one native batch call for an atomic descriptor batch', async () => {
        const database = new FakeDatabase();
        const results = await Effect.runPromise(
            makeD1(database).batch([
                { sql: 'INSERT INTO feeds(url) VALUES (?)', bindings: ['a'] },
                { sql: 'INSERT INTO feeds(url) VALUES (?)', bindings: ['b'] },
            ]),
        );

        expect(database.batchCalls).toBe(0);
        expect(database.session.batchCalls).toBe(1);
        expect(database.sessionAnchors).toEqual(['first-primary']);
        expect(database.calls).toEqual([]);
        expect(database.session.calls).toEqual([
            {
                sql: 'INSERT INTO feeds(url) VALUES (?)',
                bindings: ['a'],
            },
            {
                sql: 'INSERT INTO feeds(url) VALUES (?)',
                bindings: ['b'],
            },
        ]);
        expect(results).toEqual([makeResult('batch-0'), makeResult('batch-1')]);
    });

    it('provides the current binding through an Effect layer', async () => {
        const database = new FakeDatabase();
        const result = await Effect.runPromise(
            Effect.gen(function* () {
                const d1 = yield* D1Service;
                return yield* d1.run({ sql: 'SELECT 1' });
            }).pipe(Effect.provide(makeD1Layer(database))),
        );

        expect(result.meta.marker).toBe('run');
        expect(database.sessionAnchors).toEqual(['first-primary']);
        expect(database.calls).toEqual([]);
        expect(database.session.calls).toEqual([
            { sql: 'SELECT 1', operation: 'run' },
        ]);
    });

    it('allows explicitly unconstrained replica-first operations', async () => {
        const database = new FakeDatabase();
        const d1 = makeD1(database, 'first-unconstrained');

        await Effect.runPromise(
            d1.all({ sql: 'SELECT * FROM favicon_assets' }),
        );
        await Effect.runPromise(
            d1.first({ sql: 'SELECT COUNT(*) FROM feeds' }),
        );

        expect(database.sessionAnchors).toEqual(['first-unconstrained']);
        expect(database.session.calls).toHaveLength(2);
    });

    it('keeps explicit session queries and bookmarks on the native session', async () => {
        const database = new FakeDatabase();
        database.session.bookmark = 'bookmark-after-write';
        const d1 = makeD1(database);

        const session = await Effect.runPromise(
            d1.withSession('first-primary'),
        );
        await Effect.runPromise(
            session.run({
                sql: 'UPDATE feeds SET title = ? WHERE id = ?',
                bindings: ['Session title', 7],
            }),
        );
        const bookmark = await Effect.runPromise(session.getBookmark);

        expect(database.sessionAnchors).toEqual(['first-primary']);
        expect(database.calls).toEqual([]);
        expect(database.session.calls).toEqual([
            {
                sql: 'UPDATE feeds SET title = ? WHERE id = ?',
                bindings: ['Session title', 7],
                operation: 'run',
            },
        ]);
        expect(database.session.bookmarkCalls).toBe(1);
        expect(bookmark).toBe('bookmark-after-write');
    });

    it.each([
        [
            'first',
            (database: FakeDatabase) =>
                makeD1(database).first({ sql: 'secret first' }),
        ],
        [
            'all',
            (database: FakeDatabase) =>
                makeD1(database).all({ sql: 'secret all' }),
        ],
        [
            'run',
            (database: FakeDatabase) =>
                makeD1(database).run({ sql: 'secret run' }),
        ],
        [
            'batch',
            (database: FakeDatabase) =>
                makeD1(database).batch([
                    { sql: 'secret batch', bindings: ['secret binding'] },
                ]),
        ],
    ] satisfies ReadonlyArray<
        readonly [
            StatementOperation | 'batch',
            (
                database: FakeDatabase,
            ) => Effect.Effect<unknown, D1OperationError>,
        ]
    >)('maps rejected %s promises without attaching SQL or bindings', async (operation, evaluate) => {
        const nativeFailure = new Error('native unavailable');
        const database = new FakeDatabase();
        database.rejectedOperation = operation;
        database.rejection = nativeFailure;

        const error = await Effect.runPromise(Effect.flip(evaluate(database)));

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(D1OperationError);
        expect(error).toMatchObject({
            _tag: 'D1OperationError',
            operation,
            cause: nativeFailure,
        });
        expect(error).not.toHaveProperty('sql');
        expect(error).not.toHaveProperty('bindings');
        expect(error.message).not.toContain('secret');
    });

    it('maps synchronous native session failures to tagged operations', async () => {
        const nativeFailure = new Error('session unavailable');
        const database = new FakeDatabase();
        database.withSession = () => {
            throw nativeFailure;
        };

        const error = await Effect.runPromise(
            Effect.flip(makeD1(database).withSession('existing-bookmark')),
        );

        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({
            _tag: 'D1OperationError',
            operation: 'withSession' satisfies D1Operation,
            cause: nativeFailure,
        });
    });
});

import { Context, Effect, Layer, Schema } from 'effect';

export interface D1Statement {
    readonly sql: string;
    readonly bindings?: readonly unknown[];
}

export type D1Operation =
    | 'first'
    | 'all'
    | 'run'
    | 'batch'
    | 'withSession'
    | 'getBookmark';

export class D1OperationError extends Schema.TaggedErrorClass<D1OperationError>()(
    'D1OperationError',
    {
        operation: Schema.Literals([
            'first',
            'all',
            'run',
            'batch',
            'withSession',
            'getBookmark',
        ]),
        cause: Schema.Defect(),
    },
) {}

interface D1Queries {
    readonly first: {
        <T = Record<string, unknown>>(
            statement: D1Statement,
        ): Effect.Effect<T | null, D1OperationError>;
        <T = unknown>(
            statement: D1Statement,
            columnName: string,
        ): Effect.Effect<T | null, D1OperationError>;
    };
    readonly all: <T = Record<string, unknown>>(
        statement: D1Statement,
    ) => Effect.Effect<D1Result<T>, D1OperationError>;
    readonly run: <T = Record<string, unknown>>(
        statement: D1Statement,
    ) => Effect.Effect<D1Result<T>, D1OperationError>;
    readonly batch: <T = unknown>(
        statements: readonly D1Statement[],
    ) => Effect.Effect<D1Result<T>[], D1OperationError>;
}

export interface D1Session extends D1Queries {
    readonly getBookmark: Effect.Effect<
        D1SessionBookmark | null,
        D1OperationError
    >;
}

export interface D1 extends D1Queries {
    readonly withSession: (
        constraintOrBookmark?: D1SessionConstraint | D1SessionBookmark,
    ) => Effect.Effect<D1Session, D1OperationError>;
}

export class D1Service extends Context.Service<D1Service, D1>()(
    'larafeed/D1Service',
) {}

type D1Executor = Pick<D1DatabaseSession, 'prepare' | 'batch'>;

const operationError = (operation: D1Operation, cause: unknown) =>
    new D1OperationError({ operation, cause });

const tryPromise = <A>(
    operation: D1Operation,
    evaluate: () => PromiseLike<A>,
): Effect.Effect<A, D1OperationError> =>
    Effect.tryPromise({
        try: evaluate,
        catch: (cause) => operationError(operation, cause),
    });

const trySync = <A>(
    operation: D1Operation,
    evaluate: () => A,
): Effect.Effect<A, D1OperationError> =>
    Effect.try({
        try: evaluate,
        catch: (cause) => operationError(operation, cause),
    });

const prepare = (executor: D1Executor, descriptor: D1Statement) => {
    const statement = executor.prepare(descriptor.sql);

    return descriptor.bindings === undefined
        ? statement
        : statement.bind(...descriptor.bindings);
};

const makeQueries = (executor: D1Executor): D1Queries => {
    function first<T = Record<string, unknown>>(
        descriptor: D1Statement,
    ): Effect.Effect<T | null, D1OperationError>;
    function first<T = unknown>(
        descriptor: D1Statement,
        columnName: string,
    ): Effect.Effect<T | null, D1OperationError>;
    function first<T>(
        descriptor: D1Statement,
        columnName?: string,
    ): Effect.Effect<T | null, D1OperationError> {
        return tryPromise('first', () => {
            const statement = prepare(executor, descriptor);

            return columnName === undefined
                ? statement.first<T>()
                : statement.first<T>(columnName);
        });
    }

    return {
        first,
        all: <T = Record<string, unknown>>(descriptor: D1Statement) =>
            tryPromise('all', () => prepare(executor, descriptor).all<T>()),
        run: <T = Record<string, unknown>>(descriptor: D1Statement) =>
            tryPromise('run', () => prepare(executor, descriptor).run<T>()),
        batch: <T = unknown>(descriptors: readonly D1Statement[]) =>
            tryPromise('batch', () =>
                executor.batch<T>(
                    descriptors.map((descriptor) =>
                        prepare(executor, descriptor),
                    ),
                ),
            ),
    };
};

const makeSession = (session: D1DatabaseSession): D1Session => ({
    ...makeQueries(session),
    getBookmark: trySync('getBookmark', () => session.getBookmark()),
});

export const makeD1 = (database: D1Database): D1 => ({
    ...makeQueries(database),
    withSession: (constraintOrBookmark) =>
        trySync('withSession', () =>
            makeSession(
                constraintOrBookmark === undefined
                    ? database.withSession()
                    : database.withSession(constraintOrBookmark),
            ),
        ),
});

export const makeD1Layer = (database: D1Database) =>
    Layer.succeed(D1Service)(makeD1(database));

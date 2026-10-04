import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

/*
 * Worker tests run with `--no-isolate`: each workerd runtime is reused across
 * test files, which avoids paying the runtime boot and module-graph load for
 * every file (that cost dominated the suite). The trade-off is that D1 storage
 * is shared by every file that lands on the same runtime.
 *
 * To keep each file starting from the same empty, fully migrated database, this
 * setup file (which runs before every test file) drops every schema object the
 * application owns, then replays all migrations. Dropping the schema rather
 * than deleting rows matters: some tests change the schema itself, for example
 * by dropping a trigger to replay a migration.
 */
await dropApplicationSchema();
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

async function dropApplicationSchema(): Promise<void> {
    // SQLite internals (`sqlite_*`) and the runtime's own metadata tables
    // (`_cf_*`) are left alone; D1 rejects changes to them.
    const { results: objects } = await env.DB.prepare(
        `SELECT type, name FROM sqlite_master
         WHERE type IN ('table', 'view', 'trigger')
           AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
           AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`,
    ).all<{ type: 'table' | 'view' | 'trigger'; name: string }>();
    if (objects.length === 0) {
        return;
    }

    // D1 rejects the `pragma_foreign_key_list()` table function, so ask each
    // table for its foreign keys with the plain pragma, in one round trip.
    const tables = objects
        .filter(({ type }) => type === 'table')
        .map(({ name }) => name);
    const foreignKeys = await env.DB.batch<{ table: string }>(
        tables.map((name) =>
            env.DB.prepare(`PRAGMA foreign_key_list(${quote(name)})`),
        ),
    );
    const references = tables.flatMap((child, index) =>
        (foreignKeys[index]?.results ?? []).map(({ table: parent }) => ({
            child,
            parent,
        })),
    );

    // Triggers and views go first: SQLite refuses to drop a table while a
    // remaining trigger or view still references a table dropped before it.
    // Indexes go away with their tables, so they are not listed separately.
    const statements = [
        ...objects
            .filter(({ type }) => type !== 'table')
            .map(
                ({ type, name }) => `DROP ${type.toUpperCase()} ${quote(name)}`,
            ),
        ...childrenFirst(tables, references).map(
            (name) => `DROP TABLE ${quote(name)}`,
        ),
    ];

    // D1 cannot turn foreign keys off, and dropping a table runs an implicit
    // DELETE that checks them. Dropping children before parents keeps every
    // check satisfied; deferring covers self-references and cycles.
    await env.DB.batch([
        env.DB.prepare('PRAGMA defer_foreign_keys = ON'),
        ...statements.map((sql) => env.DB.prepare(sql)),
    ]);
}

/** Orders tables so every table comes before the tables it references. */
function childrenFirst(
    tables: readonly string[],
    references: readonly { child: string; parent: string }[],
): string[] {
    const ordered: string[] = [];
    const visited = new Set<string>();

    // Depth-first post-order over "is referenced by" edges: a parent is
    // emitted only after all of its children.
    const visit = (table: string): void => {
        if (visited.has(table)) {
            return;
        }
        visited.add(table);
        for (const { child, parent } of references) {
            if (parent === table && child !== table) {
                visit(child);
            }
        }
        ordered.push(table);
    };
    for (const table of tables) {
        visit(table);
    }

    return ordered;
}

function quote(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}

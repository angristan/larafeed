import { Effect, Schema } from 'effect';

import type { D1, D1OperationError } from '../infrastructure/d1';
import { McpStorageError } from './errors';

const AccessRow = Schema.Struct({
    mcp_enabled_at: Schema.NullOr(Schema.Int),
});

export interface McpAccess {
    /** True only for an active user who turned MCP access on. */
    readonly enabled: boolean;
}

const storageError =
    (operation: string) =>
    (cause: D1OperationError | Schema.SchemaError): McpStorageError =>
        new McpStorageError({ operation, cause });

// Client IDs are attacker-chosen for dynamic and CIMD clients. Bound the
// stored value; the full ID stays in KV.
const boundedClientId = (clientId: string): string => clientId.slice(0, 512);

/** A security event that is written only if the statement before it changed a row. */
const clientEvent = (
    input: {
        readonly userId: number;
        readonly clientId: string;
        readonly eventId: number;
        readonly now: number;
    },
    kind: 'mcp.client.authorized' | 'mcp.client.revoked',
) => ({
    sql: `INSERT INTO security_events (
              id, user_id, actor_user_id, kind, metadata_json, created_at
          )
          SELECT ?, ?, ?, ?, json_object('clientId', ?), ?
          WHERE changes() = 1`,
    bindings: [
        input.eventId,
        input.userId,
        input.userId,
        kind,
        boundedClientId(input.clientId),
        input.now,
    ],
});

export const makeMcpRepository = (d1: D1) => ({
    /**
     * Reads whether a user may use MCP. A missing or disabled user has no
     * access, so deleted and suspended accounts lose MCP access with the rest
     * of their sessions.
     */
    getAccess: (userId: number): Effect.Effect<McpAccess, McpStorageError> =>
        d1
            .first({
                sql: `SELECT mcp_enabled_at FROM users
                      WHERE id = ? AND disabled_at IS NULL`,
                bindings: [userId],
            })
            .pipe(
                Effect.flatMap((row) =>
                    row === null
                        ? Effect.succeed({ enabled: false })
                        : Schema.decodeUnknownEffect(AccessRow)(row).pipe(
                              Effect.map((decoded) => ({
                                  enabled: decoded.mcp_enabled_at !== null,
                              })),
                          ),
                ),
                Effect.mapError(storageError('mcp.access.get')),
            ),

    /**
     * Turns MCP access on or off. The user update only matches when the value
     * changes, so a repeated request records no security event. Turning it
     * off always revokes every active connection.
     */
    setEnabled: (input: {
        readonly userId: number;
        readonly enabled: boolean;
        readonly eventId: number;
        readonly now: number;
    }): Effect.Effect<void, McpStorageError> =>
        d1
            .batch([
                {
                    sql: `UPDATE users
                          SET mcp_enabled_at = CASE WHEN ? = 1 THEN ? END,
                              updated_at = max(updated_at, ?)
                          WHERE id = ? AND disabled_at IS NULL
                            AND (mcp_enabled_at IS NULL) = (? = 1)`,
                    bindings: [
                        input.enabled ? 1 : 0,
                        input.now,
                        input.now,
                        input.userId,
                        input.enabled ? 1 : 0,
                    ],
                },
                {
                    sql: `INSERT INTO security_events (
                              id, user_id, actor_user_id, kind,
                              metadata_json, created_at
                          )
                          SELECT ?, ?, ?, ?, '{}', ?
                          WHERE changes() = 1`,
                    bindings: [
                        input.eventId,
                        input.userId,
                        input.userId,
                        input.enabled ? 'mcp.enabled' : 'mcp.disabled',
                        input.now,
                    ],
                },
                {
                    // Turning MCP off revokes every connection in one
                    // statement, however many grants the user has.
                    sql: `UPDATE mcp_connections SET revoked_at = ?
                          WHERE user_id = ? AND revoked_at IS NULL AND ? = 0`,
                    bindings: [input.now, input.userId, input.enabled ? 1 : 0],
                },
            ])
            .pipe(
                Effect.asVoid,
                Effect.mapError(storageError('mcp.access.set')),
            ),

    /**
     * Records a new connection for a user who has MCP turned on, with its
     * security event. Returns false when access was turned off meanwhile.
     */
    createConnection: (input: {
        readonly connectionId: number;
        readonly userId: number;
        readonly clientId: string;
        readonly eventId: number;
        readonly now: number;
    }): Effect.Effect<boolean, McpStorageError> =>
        d1
            .batch([
                {
                    sql: `INSERT INTO mcp_connections (
                              id, user_id, client_id, created_at
                          )
                          SELECT ?, id, ?, ? FROM users
                          WHERE id = ? AND disabled_at IS NULL
                            AND mcp_enabled_at IS NOT NULL`,
                    bindings: [
                        input.connectionId,
                        boundedClientId(input.clientId),
                        input.now,
                        input.userId,
                    ],
                },
                clientEvent(input, 'mcp.client.authorized'),
            ])
            .pipe(
                Effect.map((results) => results[0]?.meta.changes === 1),
                Effect.mapError(storageError('mcp.connection.create')),
            ),

    /**
     * True when the connection is active and its user still has MCP on and
     * is not disabled. Runs on every MCP request, so it is one indexed query.
     */
    isConnectionActive: (
        userId: number,
        connectionId: number,
    ): Effect.Effect<boolean, McpStorageError> =>
        d1
            .first({
                sql: `SELECT 1 AS active
                      FROM mcp_connections c
                      JOIN users u ON u.id = c.user_id
                      WHERE c.id = ? AND c.user_id = ?
                        AND c.revoked_at IS NULL
                        AND u.disabled_at IS NULL
                        AND u.mcp_enabled_at IS NOT NULL`,
                bindings: [connectionId, userId],
            })
            .pipe(
                Effect.map((row) => row !== null),
                Effect.mapError(storageError('mcp.connection.check')),
            ),

    /** IDs of the user's active connections, for the settings list. */
    activeConnectionIds: (
        userId: number,
    ): Effect.Effect<ReadonlySet<number>, McpStorageError> =>
        d1
            .all<{ id: number }>({
                sql: `SELECT id FROM mcp_connections
                      WHERE user_id = ? AND revoked_at IS NULL`,
                bindings: [userId],
            })
            .pipe(
                Effect.map(
                    (result) => new Set(result.results.map((row) => row.id)),
                ),
                Effect.mapError(storageError('mcp.connection.list')),
            ),

    /**
     * Revokes one connection and records the event. Every token tied to it
     * stops working with this write, before the KV grant is deleted.
     */
    revokeConnection: (input: {
        readonly connectionId: number;
        readonly userId: number;
        readonly clientId: string;
        readonly eventId: number;
        readonly now: number;
    }): Effect.Effect<void, McpStorageError> =>
        d1
            .batch([
                {
                    sql: `UPDATE mcp_connections SET revoked_at = ?
                          WHERE id = ? AND user_id = ?
                            AND revoked_at IS NULL`,
                    bindings: [input.now, input.connectionId, input.userId],
                },
                clientEvent(input, 'mcp.client.revoked'),
            ])
            .pipe(
                Effect.asVoid,
                Effect.mapError(storageError('mcp.connection.revoke')),
            ),

    /**
     * Returns the start of each owned entry's stored HTML, for list excerpts.
     * Reading a prefix keeps a page of excerpts to a few KB per entry.
     */
    contentPrefixes: (
        userId: number,
        entryIds: readonly number[],
        maxChars: number,
    ): Effect.Effect<ReadonlyMap<number, string>, McpStorageError> =>
        entryIds.length === 0
            ? Effect.succeed(new Map())
            : d1
                  .all<{ entry_id: number; html: string | null }>({
                      sql: `SELECT ec.entry_id, substr(ec.content_html, 1, ?) AS html
                            FROM entry_contents ec
                            JOIN entries e ON e.id = ec.entry_id
                            JOIN feed_subscriptions fs
                              ON fs.feed_id = e.feed_id AND fs.user_id = ?
                            WHERE ec.entry_id IN (SELECT value FROM json_each(?))`,
                      // One JSON array instead of one parameter per ID: D1
                      // allows at most 100 bound parameters per statement,
                      // and a page can hold 100 entries.
                      bindings: [maxChars, userId, JSON.stringify(entryIds)],
                  })
                  .pipe(
                      Effect.map(
                          (result) =>
                              new Map(
                                  result.results.map((row) => [
                                      row.entry_id,
                                      row.html ?? '',
                                  ]),
                              ),
                      ),
                      Effect.mapError(storageError('mcp.entries.excerpts')),
                  ),
});

export type McpRepository = ReturnType<typeof makeMcpRepository>;

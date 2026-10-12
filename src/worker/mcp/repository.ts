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
     * Turns MCP access on or off. The update only matches when the value
     * changes, so a repeated request is a no-op and records no security event.
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
            ])
            .pipe(
                Effect.asVoid,
                Effect.mapError(storageError('mcp.access.set')),
            ),

    /** Records an MCP client authorization or revocation for the audit log. */
    recordClientEvent: (input: {
        readonly userId: number;
        readonly kind: 'mcp.client.authorized' | 'mcp.client.revoked';
        readonly clientId: string;
        readonly eventId: number;
        readonly now: number;
    }): Effect.Effect<void, McpStorageError> =>
        d1
            .run({
                sql: `INSERT INTO security_events (
                          id, user_id, actor_user_id, kind,
                          metadata_json, created_at
                      )
                      SELECT ?, id, id, ?, json_object('clientId', ?), ?
                      FROM users WHERE id = ?`,
                bindings: [
                    input.eventId,
                    input.kind,
                    // Client IDs are attacker-chosen for dynamic and CIMD
                    // clients. Bound the stored value; the full ID stays in KV.
                    input.clientId.slice(0, 512),
                    input.now,
                    input.userId,
                ],
            })
            .pipe(
                Effect.asVoid,
                Effect.mapError(storageError('mcp.client.event')),
            ),
});

export type McpRepository = ReturnType<typeof makeMcpRepository>;

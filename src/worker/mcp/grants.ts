import type {
    GrantSummary,
    OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { McpConnectedClient } from '@shared/schemas/mcp';
import { Effect } from 'effect';

import { McpGrantStoreError } from './errors';

// The settings page lists at most this many clients. One user with more than
// 100 live MCP grants is not a realistic case for a personal reader.
const MAX_LISTED_GRANTS = 100;
// Turning MCP off deletes grants from KV after D1 has revoked them. Each
// deletion costs a few KV operations, so the cleanup stops well before the
// Worker subrequest limit. Grants it leaves behind cannot be used (their D1
// connection is revoked), are hidden from settings, and expire on their own.
const MAX_REVOKED_GRANTS = 200;

/**
 * Client details captured on the consent page and stored, unencrypted, as the
 * grant's metadata. Storing them avoids a client lookup (and a remote fetch
 * for Client ID Metadata Document clients) every time settings load.
 */
export interface McpGrantMetadata {
    /** The `mcp_connections` row that gates this grant's tokens. */
    readonly connectionId: number;
    readonly clientName: string;
    readonly clientDomain: string | null;
}

const grantStoreError = (operation: string) => (cause: unknown) =>
    new McpGrantStoreError({ operation, cause });

const metadataString = (metadata: unknown, key: string): string | null => {
    if (typeof metadata !== 'object' || metadata === null) return null;
    const value = Reflect.get(metadata, key);
    return typeof value === 'string' && value.length > 0
        ? value.slice(0, 200)
        : null;
};

const metadataConnectionId = (metadata: unknown): number | null => {
    if (typeof metadata !== 'object' || metadata === null) return null;
    const value = Reflect.get(metadata, 'connectionId');
    return Number.isSafeInteger(value) && (value as number) > 0
        ? (value as number)
        : null;
};

const fallbackClientName = (clientId: string): string => {
    try {
        return new URL(clientId).hostname || clientId;
    } catch {
        return clientId;
    }
};

const toConnectedClient = (grant: GrantSummary): McpConnectedClient =>
    McpConnectedClient.make({
        grantId: grant.id,
        clientId: grant.clientId,
        clientName:
            metadataString(grant.metadata, 'clientName') ??
            fallbackClientName(grant.clientId),
        clientDomain: metadataString(grant.metadata, 'clientDomain'),
        scopes: grant.scope,
        // The library reports grant times in Unix seconds.
        createdAt: grant.createdAt * 1_000,
        expiresAt:
            grant.expiresAt === undefined ? null : grant.expiresAt * 1_000,
    });

const listGrants = (
    oauth: OAuthHelpers,
    userId: number,
    maximum: number,
): Effect.Effect<GrantSummary[], McpGrantStoreError> =>
    Effect.gen(function* () {
        const grants: GrantSummary[] = [];
        let cursor: string | undefined;
        do {
            const page = yield* Effect.tryPromise({
                try: () =>
                    oauth.listUserGrants(String(userId), {
                        limit: Math.min(100, maximum - grants.length),
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                catch: grantStoreError('mcp.grants.list'),
            });
            grants.push(...page.items);
            cursor = page.cursor;
        } while (cursor !== undefined && grants.length < maximum);
        return grants;
    });

/** Lists grants whose D1 connection is still active. */
export const listConnectedClients = (
    oauth: OAuthHelpers,
    userId: number,
    activeConnectionIds: ReadonlySet<number>,
) =>
    listGrants(oauth, userId, MAX_LISTED_GRANTS).pipe(
        Effect.map((grants) =>
            grants
                .filter((grant) => {
                    const id = metadataConnectionId(grant.metadata);
                    return id !== null && activeConnectionIds.has(id);
                })
                .map(toConnectedClient)
                .sort((left, right) => right.createdAt - left.createdAt),
        ),
    );

export interface OwnedGrant {
    readonly grantId: string;
    readonly clientId: string;
    readonly connectionId: number | null;
}

/** Finds one grant owned by the user, or null. */
export const findConnectedClient = (
    oauth: OAuthHelpers,
    userId: number,
    grantId: string,
): Effect.Effect<OwnedGrant | null, McpGrantStoreError> =>
    listGrants(oauth, userId, MAX_REVOKED_GRANTS).pipe(
        Effect.map((grants) => {
            const grant = grants.find((candidate) => candidate.id === grantId);
            return grant === undefined
                ? null
                : {
                      grantId: grant.id,
                      clientId: grant.clientId,
                      connectionId: metadataConnectionId(grant.metadata),
                  };
        }),
    );

/** Deletes one grant and its tokens from KV. */
export const deleteGrant = (
    oauth: OAuthHelpers,
    userId: number,
    grantId: string,
): Effect.Effect<void, McpGrantStoreError> =>
    Effect.tryPromise({
        try: () => oauth.revokeGrant(grantId, String(userId)),
        catch: grantStoreError('mcp.grants.revoke'),
    });

/** Deletes up to 200 of the user's grants from KV; returns how many. */
export const deleteAllGrants = (
    oauth: OAuthHelpers,
    userId: number,
): Effect.Effect<number, McpGrantStoreError> =>
    listGrants(oauth, userId, MAX_REVOKED_GRANTS).pipe(
        Effect.flatMap((grants) =>
            Effect.forEach(
                grants,
                (grant) =>
                    Effect.tryPromise({
                        try: () => oauth.revokeGrant(grant.id, String(userId)),
                        catch: grantStoreError('mcp.grants.revoke'),
                    }),
                { concurrency: 4, discard: true },
            ).pipe(Effect.as(grants.length)),
        ),
    );

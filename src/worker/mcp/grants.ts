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
// Disabling MCP revokes every grant. Each revocation costs a few KV
// operations, so stop well before the Worker subrequest limit; the D1 opt-in
// check already rejects any token a partial revocation leaves behind.
const MAX_REVOKED_GRANTS = 200;

/**
 * Client details captured on the consent page and stored, unencrypted, as the
 * grant's metadata. Storing them avoids a client lookup (and a remote fetch
 * for Client ID Metadata Document clients) every time settings load.
 */
export interface McpGrantMetadata {
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

export const listConnectedClients = (oauth: OAuthHelpers, userId: number) =>
    listGrants(oauth, userId, MAX_LISTED_GRANTS).pipe(
        Effect.map((grants) =>
            grants
                .map(toConnectedClient)
                .sort((left, right) => right.createdAt - left.createdAt),
        ),
    );

/**
 * Revokes one grant owned by the user. Returns the client ID for the audit
 * log, or null when the user owns no grant with that ID.
 */
export const revokeConnectedClient = (
    oauth: OAuthHelpers,
    userId: number,
    grantId: string,
): Effect.Effect<string | null, McpGrantStoreError> =>
    Effect.gen(function* () {
        const grants = yield* listGrants(oauth, userId, MAX_REVOKED_GRANTS);
        const grant = grants.find((candidate) => candidate.id === grantId);
        if (grant === undefined) return null;
        yield* Effect.tryPromise({
            try: () => oauth.revokeGrant(grant.id, String(userId)),
            catch: grantStoreError('mcp.grants.revoke'),
        });
        return grant.clientId;
    });

/** Revokes every MCP grant the user holds and returns how many it revoked. */
export const revokeAllConnectedClients = (
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

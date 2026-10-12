import {
    OAuthAuthorizationServer,
    type OAuthResourceContext,
    OAuthResourceServer,
} from '@cloudflare/workers-oauth-provider';
import type { McpScope } from '@shared/schemas/mcp';

/*
 * Larafeed is both the OAuth authorization server and the only protected
 * resource (the MCP endpoint), all in this Worker:
 *
 *   MCP client                         Larafeed Worker
 *   ----------                         ---------------
 *   POST /mcp (no token)  ───────────▶ 401 + resource_metadata URL
 *   GET  /.well-known/oauth-protected-resource/mcp
 *   GET  /.well-known/oauth-authorization-server
 *   POST /oauth/register (DCR) or a CIMD client_id URL
 *   browser ─▶ GET /authorize ───────▶ passkey session + consent page (ours)
 *   POST /oauth/token ───────────────▶ access + refresh tokens (library)
 *   POST /mcp (Bearer) ──────────────▶ token check + D1 connection check + tools
 *
 * The library stores clients, grants, and token hashes in the OAUTH_KV
 * namespace. Larafeed keeps the per-user opt-in and one row per connection in
 * D1, and checks both on every request. Revocation writes D1 first, so it
 * takes effect at once even if a racing refresh rewrites the KV grant.
 */

export const MCP_PATH = '/mcp';
export const AUTHORIZE_PATH = '/authorize';
export const TOKEN_PATH = '/oauth/token';
export const REGISTER_PATH = '/oauth/register';

export const MCP_READ_SCOPE = 'mcp:read' satisfies McpScope;
export const MCP_WRITE_SCOPE = 'mcp:write' satisfies McpScope;
export const MCP_SCOPES: readonly McpScope[] = [
    MCP_READ_SCOPE,
    MCP_WRITE_SCOPE,
];

const DAY_SECONDS = 24 * 60 * 60;
// A grant stays alive while its client keeps refreshing and expires after 30
// idle days, so a forgotten client loses access on its own.
const REFRESH_TOKEN_IDLE_TTL_SECONDS = 30 * DAY_SECONDS;

/** What a completed authorization stores (encrypted) with every token. */
export interface McpProps {
    readonly userId: number;
    /** Row in `mcp_connections`; revoking it revokes every token at once. */
    readonly connectionId: number;
}

export type McpResourceContext = OAuthResourceContext<McpProps>;

export interface McpOAuthOptions {
    /** The canonical HTTPS origin from `AUTH_ORIGIN`. */
    readonly origin: string;
    /**
     * Runs after the library accepts a token. Return false to reject it with a
     * 401: the connection was revoked, MCP was turned off, or the user was
     * disabled.
     */
    readonly hasAccess: (env: Env, props: McpProps) => Promise<boolean>;
    /** Serves an authenticated MCP request. */
    readonly handleMcp: (
        request: Request,
        env: Env,
        ctx: McpResourceContext,
    ) => Promise<Response>;
}

export interface McpOAuth {
    readonly issuer: string;
    /** Canonical resource identifier and the URL users give to MCP clients. */
    readonly resource: string;
    readonly resourceMetadataUrl: string;
    readonly authorizationServer: OAuthAuthorizationServer<Env>;
    readonly resourceServer: OAuthResourceServer<Env, McpProps>;
}

const isSafeId = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) > 0;

const isMcpProps = (value: unknown): value is McpProps =>
    typeof value === 'object' &&
    value !== null &&
    isSafeId(Reflect.get(value, 'userId')) &&
    isSafeId(Reflect.get(value, 'connectionId'));

// OAuth errors are client mistakes or probing, not Worker faults. Log the
// stable reason only: descriptions can echo client input.
const logOAuthError = (error: {
    readonly code: string;
    readonly status: number;
    readonly internal: { readonly category: string; readonly reason: string };
}): void => {
    console.warn({
        event: 'mcp.oauth.error',
        code: error.code,
        status: error.status,
        category: error.internal.category,
        reason: error.internal.reason,
    });
};

export const makeMcpOAuth = (options: McpOAuthOptions): McpOAuth => {
    const issuer = options.origin;
    const resource = `${options.origin}${MCP_PATH}`;

    const authorizationServer = new OAuthAuthorizationServer<Env>({
        issuer,
        resources: [resource],
        authorizeEndpoint: AUTHORIZE_PATH,
        tokenEndpoint: TOKEN_PATH,
        // Dynamic registration is deprecated by MCP in favor of Client ID
        // Metadata Documents, but most installed clients still use it.
        clientRegistrationEndpoint: REGISTER_PATH,
        clientIdMetadataDocumentEnabled: true,
        scopesSupported: [...MCP_SCOPES, 'offline_access'],
        refreshTokenIdleTTL: REFRESH_TOKEN_IDLE_TTL_SECONDS,
        onError: logOAuthError,
    });

    const resourceServer = new OAuthResourceServer<Env, McpProps>({
        resourceMetadata: {
            resource,
            authorization_servers: [issuer],
            bearer_methods_supported: ['header'],
            resource_name: 'Larafeed',
        },
        // The 401 challenge asks for read access. The consent page offers
        // write access too, and write tools step up when it was declined.
        requiredScopes: [MCP_READ_SCOPE],
        validateToken: (env) => async (requestedResource, token) => {
            const validated = await authorizationServer.validateToken<unknown>(
                requestedResource,
                token,
                env,
            );
            if (validated === null || !isMcpProps(validated.props)) {
                return null;
            }
            if (!(await options.hasAccess(env, validated.props))) {
                return null;
            }
            return { ...validated, props: validated.props };
        },
        handler: {
            fetch: (request, env, ctx) => options.handleMcp(request, env, ctx),
        },
    });

    return {
        issuer,
        resource,
        resourceMetadataUrl: `${options.origin}/.well-known/oauth-protected-resource${MCP_PATH}`,
        authorizationServer,
        resourceServer,
    };
};

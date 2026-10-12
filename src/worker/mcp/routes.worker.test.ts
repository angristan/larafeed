import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AuthConfig } from '../auth/config';
import { Unauthenticated } from '../auth/errors';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import type { FullContentService } from '../fullcontent/service';
import { makeD1 } from '../infrastructure/d1';
import { runSearchIndexer } from '../search/indexer';
import { makeMcpOAuth } from './oauth';
import { makeMcpRepository } from './repository';
import {
    defaultMcpToolServices,
    type McpRuntime,
    type McpToolServicesFactory,
    makeMcpRequestHandler,
    registerMcpRoutes,
} from './routes';

/*
 * Drives the real OAuth library, KV, D1, and MCP SDK the way an MCP client
 * does: discovery, dynamic registration, the consent page, the PKCE token
 * exchange, tool calls, and revocation. Only the passkey session is stubbed:
 * the cookie value `valid-<userId>` signs that user in.
 */

const ORIGIN = 'https://example.test';
const REDIRECT_URI = 'http://127.0.0.1:43123/callback';
// In the past: the reader service stamps writes with the real clock, and
// tables check that updated_at is not before created_at.
const now = 1_760_000_000_000;
const d1 = makeD1(env.DB);
const repository = makeMcpRepository(d1);

const OWNER = 7_610_001;
const OTHER = 7_610_002;
const FEED = 7_620_001;
const OTHER_FEED = 7_620_002;
const CATEGORY = 7_630_001;
const OTHER_CATEGORY = 7_630_002;
const ENTRY = 7_640_001;
const OTHER_ENTRY = 7_640_002;

const ARTICLE_HTML =
    '<p>Hello &amp; <a href="https://example.test/x">welcome</a></p>';

const bytes = (value: number) => new Uint8Array(32).fill(value % 251 || 1);

const session = (userId: number): AuthenticatedSession => ({
    sessionId: userId,
    user: {
        id: userId,
        username: `user-${userId}`,
        displayName: 'MCP Test',
        isAdmin: false,
    },
    expiresAt: now + 3_600_000,
    createdAt: now,
    csrfTokenHash: new Uint8Array(32),
});

const authRuntime: AuthRuntime = {
    config: {
        origin: ORIGIN,
        sessionCookie: { name: 'session' },
        csrfCookie: { name: 'csrf' },
    } as AuthConfig,
    service: {
        authenticateSession: (token: string | undefined) => {
            const match = /^valid-(\d+)$/u.exec(token ?? '');
            return match === null
                ? Effect.fail(new Unauthenticated())
                : Effect.succeed(session(Number(match[1])));
        },
        authorizeMutation: () => Effect.void,
    } as unknown as AuthService,
};

// Article fetching reaches the public web, so the test replaces it with a
// fixed page. Everything else is the production wiring.
const toolServices: McpToolServicesFactory = (workerEnv) =>
    defaultMcpToolServices(workerEnv).pipe(
        Effect.map((services) => ({
            ...services,
            limitFullContent: () => Effect.void,
            fullContent: {
                fetchContent: (_userId: number, entryId: number) =>
                    Effect.succeed({
                        fullContent: {
                            entryId,
                            html: '<p>Full article from the website.</p>',
                            sourceUrl: 'https://example.test/item',
                            fetchedAt: now,
                            summary: null,
                        },
                    }),
            } as unknown as FullContentService,
        })),
    );

const oauth = makeMcpOAuth({
    origin: ORIGIN,
    hasAccess: (_env, props) =>
        Effect.runPromise(
            repository.isConnectionActive(props.userId, props.connectionId),
        ),
    handleMcp: makeMcpRequestHandler(toolServices),
});

let nextEventId = 7_690_000;
const runtime: McpRuntime = {
    auth: authRuntime,
    repository,
    oauth,
    now: () => now,
    safeId: () => Effect.sync(() => ++nextEventId),
};

const app = registerMcpRoutes(new Hono<{ Bindings: Env }>(), {
    runtimeFactory: () => Effect.succeed(runtime),
});

const request = (path: string, init: RequestInit = {}) =>
    app.request(`${ORIGIN}${path}`, init, env);

const setEnabled = (userId: number, enabled: boolean) =>
    Effect.runPromise(
        repository.setEnabled({
            userId,
            enabled,
            eventId: ++nextEventId,
            now,
        }),
    );

const base64Url = (data: ArrayBuffer | Uint8Array): string =>
    btoa(String.fromCharCode(...new Uint8Array(data)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, '');

const cookiePairs = (response: Response): string[] =>
    response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';', 1)[0] ?? '');

interface Tokens {
    readonly access_token: string;
    readonly refresh_token?: string;
    readonly scope: string;
    readonly clientId: string;
}

const registerClient = async (): Promise<string> => {
    const registration = await request('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_name: 'Test <MCP> client',
            redirect_uris: [REDIRECT_URI],
            token_endpoint_auth_method: 'none',
        }),
    });
    expect(registration.status).toBe(201);
    return ((await registration.json()) as { client_id: string }).client_id;
};

const authorizeQuery = (clientId: string, challenge: string) =>
    new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'state-123',
        scope: 'mcp:read',
        resource: `${ORIGIN}/mcp`,
    });

/** Registers a client and runs the browser consent flow for one user. */
const connectClient = async (
    userId: number,
    options: {
        readonly allowWrite: boolean;
        /** Session that submits the form, when it differs from the viewer. */
        readonly submitAs?: number;
    },
): Promise<Tokens> => {
    const clientId = await registerClient();
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64Url(
        await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(verifier),
        ),
    );

    const consentPage = await request(
        `/authorize?${authorizeQuery(clientId, challenge)}`,
        {
            headers: { cookie: `session=valid-${userId}` },
        },
    );
    expect(consentPage.status).toBe(200);
    // Browsers send `Origin: null` on form POSTs from a `no-referrer` page,
    // which the consent POST's origin check refuses. The POST below sets the
    // header by hand, so check the policy that makes browsers send it.
    expect(consentPage.headers.get('referrer-policy')).toBe('same-origin');
    const html = await consentPage.text();
    expect(html).not.toContain('content="no-referrer"');
    // Client-chosen names are escaped, never rendered as markup.
    expect(html).toContain('Test &#60;MCP&#62; client');
    expect(html).not.toContain('<MCP>');
    expect(html).toContain('127.0.0.1');
    const handle = /name="handle" value="([^"]+)"/u.exec(html)?.[1];
    expect(handle).toBeDefined();

    const form = new URLSearchParams({
        handle: handle ?? '',
        user: /name="user" value="(\d+)"/u.exec(html)?.[1] ?? '',
        decision: 'approve',
        ...(options.allowWrite ? { write: 'on' } : {}),
    });
    const approval = await request('/authorize', {
        method: 'POST',
        headers: {
            origin: ORIGIN,
            'content-type': 'application/x-www-form-urlencoded',
            cookie: [
                `session=valid-${options.submitAs ?? userId}`,
                ...cookiePairs(consentPage),
            ].join('; '),
        },
        body: form.toString(),
    });
    if (approval.status !== 302) {
        throw new ConsentRefused(approval.status, await approval.text());
    }
    const callback = new URL(approval.headers.get('location') ?? '');
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI);
    expect(callback.searchParams.get('state')).toBe('state-123');
    const code = callback.searchParams.get('code');
    expect(code).not.toBeNull();

    const token = await request('/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code ?? '',
            redirect_uri: REDIRECT_URI,
            client_id: clientId,
            code_verifier: verifier,
            resource: `${ORIGIN}/mcp`,
        }).toString(),
    });
    expect(token.status).toBe(200);
    return { ...((await token.json()) as Omit<Tokens, 'clientId'>), clientId };
};

class ConsentRefused extends Error {
    constructor(
        readonly status: number,
        readonly html: string,
    ) {
        super(`Consent POST returned ${status}`);
    }
}

/** Copies the user's OAuth KV records so a test can put them back later. */
const snapshotKv = async (userId: number) => {
    const records: { name: string; value: string; metadata: unknown }[] = [];
    for (const prefix of [`grant:${userId}:`, `token:${userId}:`]) {
        const listed = await env.OAUTH_KV.list({ prefix });
        for (const key of listed.keys) {
            const value = await env.OAUTH_KV.get(key.name);
            if (value !== null) {
                records.push({ name: key.name, value, metadata: key.metadata });
            }
        }
    }
    return records;
};

/**
 * Writes KV records back, as a token refresh racing a revocation can: it
 * reads the grant before the revocation and writes it after.
 */
const restoreKv = async (records: Awaited<ReturnType<typeof snapshotKv>>) => {
    for (const record of records) {
        await env.OAUTH_KV.put(record.name, record.value, {
            metadata: record.metadata,
        });
    }
};

let rpcId = 0;

/** Sends one stateless (2025-era) JSON-RPC request to the MCP endpoint. */
const rpc = async (
    accessToken: string,
    method: string,
    params: Record<string, unknown> = {},
): Promise<Response> =>
    request('/mcp', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${accessToken}`,
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });

const rpcResult = async (response: Response) => {
    expect(response.status).toBe(200);
    const text = await response.text();
    // Stateless serving may answer with JSON or with a one-event SSE stream.
    const json = text.trimStart().startsWith('{')
        ? text
        : (text
              .split('\n')
              .find((line) => line.startsWith('data:'))
              ?.slice(5) ?? '');
    const message = JSON.parse(json) as {
        result?: {
            content?: { type: string; text: string }[];
            structuredContent?: Record<string, unknown>;
            isError?: boolean;
            tools?: { name: string }[];
        };
        error?: unknown;
    };
    expect(message.error).toBeUndefined();
    return message.result ?? {};
};

const callTool = async (
    accessToken: string,
    name: string,
    args: Record<string, unknown> = {},
) => {
    const result = await rpcResult(
        await rpc(accessToken, 'tools/call', { name, arguments: args }),
    );
    return {
        isError: result.isError === true,
        text: result.content?.map((block) => block.text).join('\n') ?? '',
        data: result.structuredContent ?? {},
    };
};

beforeAll(async () => {
    const statements = [OWNER, OTHER].flatMap((userId, index) => {
        const feedId = index === 0 ? FEED : OTHER_FEED;
        const categoryId = index === 0 ? CATEGORY : OTHER_CATEGORY;
        const entryId = index === 0 ? ENTRY : OTHER_ENTRY;
        return [
            {
                sql: `INSERT INTO users (
                    id, webauthn_user_handle, username, email, display_name,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'MCP Test', ?, ?)`,
                bindings: [
                    userId,
                    bytes(userId),
                    `user-${userId}`,
                    `user-${userId}@example.test`,
                    now,
                    now,
                ],
            },
            {
                sql: `INSERT INTO feeds (
                    id, name, feed_url, site_url, next_refresh_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'https://example.test', ?, ?, ?)`,
                bindings: [
                    feedId,
                    `Feed ${userId}`,
                    `https://example.test/${feedId}.xml`,
                    now,
                    now,
                    now,
                ],
            },
            {
                sql: `INSERT INTO subscription_categories (
                    id, user_id, name, created_at, updated_at
                ) VALUES (?, ?, 'News', ?, ?)`,
                bindings: [categoryId, userId, now, now],
            },
            {
                sql: `INSERT INTO feed_subscriptions (
                    user_id, feed_id, category_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)`,
                bindings: [userId, feedId, categoryId, now, now],
            },
            {
                sql: `INSERT INTO entries (
                    id, feed_id, deduplication_key, title, url, author,
                    published_at, content_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'https://example.test/item', NULL,
                    ?, 'stored', ?, ?)`,
                bindings: [
                    entryId,
                    feedId,
                    bytes(entryId),
                    `Private article ${userId}`,
                    now,
                    now,
                    now,
                ],
            },
            {
                sql: `INSERT INTO entry_contents (
                    entry_id, content_html, content_hash,
                    encoded_size_bytes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                bindings: [
                    entryId,
                    ARTICLE_HTML,
                    bytes(entryId + 1),
                    new TextEncoder().encode(ARTICLE_HTML).byteLength,
                    now,
                    now,
                ],
            },
        ];
    });
    await Effect.runPromise(d1.batch(statements));
});

describe('MCP over OAuth with Workerd KV and D1', () => {
    it('publishes discovery metadata and challenges anonymous MCP calls', async () => {
        const anonymous = await request('/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });
        expect(anonymous.status).toBe(401);
        expect(anonymous.headers.get('www-authenticate')).toContain(
            `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
        );

        const resource = await request(
            '/.well-known/oauth-protected-resource/mcp',
        );
        expect(await resource.json()).toMatchObject({
            resource: `${ORIGIN}/mcp`,
            authorization_servers: [ORIGIN],
        });

        const server = await request('/.well-known/oauth-authorization-server');
        expect(await server.json()).toMatchObject({
            issuer: ORIGIN,
            authorization_endpoint: `${ORIGIN}/authorize`,
            token_endpoint: `${ORIGIN}/oauth/token`,
            registration_endpoint: `${ORIGIN}/oauth/register`,
        });
    });

    it('sends signed-out users to login and refuses users who did not opt in', async () => {
        const query = new URLSearchParams({
            response_type: 'code',
            client_id: 'unknown',
            redirect_uri: REDIRECT_URI,
        });
        // An unknown client is rejected before any session check, without a
        // redirect to the untrusted redirect URI.
        const unknownClient = await request(`/authorize?${query}`);
        expect(unknownClient.status).toBe(400);
        expect(unknownClient.headers.get('location')).toBeNull();

        const signInQuery = authorizeQuery(
            await registerClient(),
            'x'.repeat(43),
        );
        const signedOut = await request(`/authorize?${signInQuery}`);
        expect(signedOut.status).toBe(302);
        const login = new URL(signedOut.headers.get('location') ?? '', ORIGIN);
        expect(login.pathname).toBe('/login');
        expect(login.searchParams.get('returnTo')).toBe(
            `/authorize?${signInQuery}`,
        );

        await setEnabled(OWNER, false);
        const optedOut = await request(`/authorize?${signInQuery}`, {
            headers: { cookie: `session=valid-${OWNER}` },
        });
        expect(optedOut.status).toBe(403);
        expect(await optedOut.text()).toContain('MCP access is off');
    });

    it('serves only the authorizing user’s data and enforces write scope', async () => {
        await setEnabled(OWNER, true);
        const tokens = await connectClient(OWNER, { allowWrite: true });
        expect(tokens.scope.split(' ').sort()).toEqual([
            'mcp:read',
            'mcp:write',
        ]);

        const tools = await rpcResult(
            await rpc(tokens.access_token, 'tools/list'),
        );
        expect(tools.tools?.map((tool) => tool.name).sort()).toEqual([
            'feed_health',
            'get_entries',
            'list_entries',
            'list_subscriptions',
            'search_entries',
            'subscribe',
            'unsubscribe',
            'update_entries',
        ]);
        // The tool list is sent in every conversation: Effect's nested
        // checks and safe-integer bounds are flattened out of it.
        const toolList = JSON.stringify(tools);
        expect(toolList).not.toContain('allOf');
        expect(toolList).not.toContain(String(Number.MAX_SAFE_INTEGER));
        expect(toolList.length).toBeLessThan(6_000);

        const listed = await callTool(tokens.access_token, 'list_entries');
        expect(listed.isError).toBe(false);
        expect(listed.text).toContain(`Private article ${OWNER}`);
        expect(listed.text).not.toContain(`Private article ${OTHER}`);

        const entry = await callTool(tokens.access_token, 'get_entries', {
            entryIds: [ENTRY],
        });
        expect(entry.text).toContain(
            'Hello & welcome (https://example.test/x)',
        );

        const foreign = await callTool(tokens.access_token, 'get_entries', {
            entryIds: [OTHER_ENTRY],
        });
        expect(foreign.data).toEqual({ entries: [], notFound: [OTHER_ENTRY] });
        expect(foreign.text).not.toContain(`Private article ${OTHER}`);

        const update = await callTool(tokens.access_token, 'update_entries', {
            entryIds: [ENTRY, OTHER_ENTRY],
            read: true,
            starred: true,
        });
        expect(JSON.parse(update.text)).toEqual({
            updated: [
                { id: ENTRY, read: true, starred: true, archived: false },
            ],
            notFound: [OTHER_ENTRY],
        });
        const otherInteraction = await env.DB.prepare(
            'SELECT count(*) AS count FROM entry_interactions WHERE entry_id = ?',
        )
            .bind(OTHER_ENTRY)
            .first<{ count: number }>();
        expect(otherInteraction?.count).toBe(0);

        // A whole feed can be marked read, but only with read: true.
        const feedRead = await callTool(tokens.access_token, 'update_entries', {
            feedId: FEED,
            read: true,
        });
        expect(feedRead.data).toEqual({ feedId: FEED, read: true });
        const feedStar = await callTool(tokens.access_token, 'update_entries', {
            feedId: FEED,
            starred: true,
        });
        expect(feedStar.isError).toBe(true);

        const readOnly = await connectClient(OWNER, { allowWrite: false });
        expect(readOnly.scope).toBe('mcp:read');
        const denied = await rpc(readOnly.access_token, 'tools/call', {
            name: 'update_entries',
            arguments: { entryIds: [ENTRY], read: false },
        });
        expect(denied.status).toBe(403);
        expect(denied.headers.get('www-authenticate')).toContain(
            'insufficient_scope',
        );
        // Read tools keep working with the read-only token.
        expect(
            (await callTool(readOnly.access_token, 'list_subscriptions'))
                .isError,
        ).toBe(false);
    });

    it('reads with excerpts, date ranges, batches, full articles, and feed health', async () => {
        await setEnabled(OWNER, true);
        const { access_token: token } = await connectClient(OWNER, {
            allowWrite: false,
        });

        type Listed = {
            total: number;
            entries: { id: number; excerpt?: string }[];
        };
        const listed = await callTool(token, 'list_entries', {
            filter: 'all',
        });
        const page = listed.data as Listed;
        // Text is one line per entry with the excerpt indented below.
        expect(listed.text).toBe(
            [
                '1 entries',
                // The previous test read and starred this entry.
                `${ENTRY} · ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} · Feed ${OWNER} · Private article ${OWNER} [read, starred]`,
                '  Hello & welcome (https://example.test/x)',
            ].join('\n'),
        );
        expect(page.entries).toEqual([
            expect.objectContaining({
                id: ENTRY,
                excerpt: 'Hello & welcome (https://example.test/x)',
            }),
        ]);
        const bare = (
            await callTool(token, 'list_entries', {
                filter: 'all',
                excerptChars: 0,
            })
        ).data as Listed;
        expect(bare.entries[0]).not.toHaveProperty('excerpt');

        // since is inclusive and until exclusive, on publication time.
        const at = (offset: number) => new Date(now + offset).toISOString();
        const totalFor = async (range: Record<string, string>) =>
            (
                (
                    await callTool(token, 'list_entries', {
                        filter: 'all',
                        ...range,
                    })
                ).data as Listed
            ).total;
        expect(await totalFor({ since: at(0) })).toBe(1);
        expect(await totalFor({ since: at(1) })).toBe(0);
        expect(await totalFor({ until: at(0) })).toBe(0);
        expect(await totalFor({ until: at(1) })).toBe(1);
        const badDate = await callTool(token, 'list_entries', {
            since: 'yesterday',
        });
        expect(badDate.isError).toBe(true);
        expect(badDate.text).toContain('Invalid since');

        const batch = await callTool(token, 'get_entries', {
            entryIds: [ENTRY, OTHER_ENTRY],
        });
        expect(batch.data).toMatchObject({
            entries: [{ id: ENTRY, contentSource: 'feed' }],
            notFound: [OTHER_ENTRY],
        });
        expect(batch.text).toContain(`Private article ${OWNER}`);
        expect(batch.text).not.toContain(`Private article ${OTHER}`);

        const full = await callTool(token, 'get_entries', {
            entryIds: [ENTRY],
            fullContent: true,
        });
        expect(full.data).toMatchObject({
            entries: [
                {
                    contentSource: 'article',
                    content: 'Full article from the website.',
                    truncated: false,
                },
            ],
        });

        // Both users' entries contain "welcome"; search sees only the owner's.
        await Effect.runPromise(runSearchIndexer(d1));
        const found = await callTool(token, 'search_entries', {
            query: 'welcome',
        });
        expect(found.data).toEqual({
            results: [
                expect.objectContaining({
                    id: ENTRY,
                    snippet: expect.stringContaining('**welcome**'),
                }),
            ],
            nextOffset: null,
        });
        const badQuery = await callTool(token, 'search_entries', {
            query: '-welcome',
        });
        expect(badQuery.isError).toBe(true);

        type Health = {
            totalFeeds: number;
            failing: number;
            feeds: { feedId: number; status: string; lastError: string }[];
        };
        const healthy = (await callTool(token, 'feed_health')).data as Health;
        expect(healthy).toMatchObject({ totalFeeds: 1, failing: 0, feeds: [] });
        await env.DB.prepare(
            `UPDATE feeds SET consecutive_failures = 3,
                last_error_message = 'HTTP 500' WHERE id = ?`,
        )
            .bind(FEED)
            .run();
        const failing = (await callTool(token, 'feed_health')).data as Health;
        expect(failing).toMatchObject({
            failing: 1,
            feeds: [{ feedId: FEED, status: 'failing', lastError: 'HTTP 500' }],
        });
        await env.DB.prepare(
            `UPDATE feeds SET consecutive_failures = 0,
                last_error_message = NULL WHERE id = ?`,
        )
            .bind(FEED)
            .run();
    });

    it('refuses a consent form submitted by a different account', async () => {
        await setEnabled(OWNER, true);
        await setEnabled(OTHER, true);
        const refusal = await connectClient(OWNER, {
            allowWrite: false,
            submitAs: OTHER,
        }).catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(ConsentRefused);
        expect((refusal as ConsentRefused).status).toBe(409);
        const grants = await env.OAUTH_KV.list({ prefix: `grant:${OTHER}:` });
        expect(grants.keys).toHaveLength(0);
    });

    it('keeps revoked tokens dead when KV records come back', async () => {
        await setEnabled(OWNER, true);
        const tokens = await connectClient(OWNER, { allowWrite: false });
        const before = await snapshotKv(OWNER);

        const settings = (await (
            await request('/api/mcp', {
                headers: { cookie: `session=valid-${OWNER}` },
            })
        ).json()) as { clients: { grantId: string; clientId: string }[] };
        const grant = settings.clients.find(
            (client) => client.clientId === tokens.clientId,
        );
        const disconnected = await request(
            `/api/mcp/clients/${grant?.grantId}`,
            {
                method: 'DELETE',
                headers: {
                    cookie: `session=valid-${OWNER}`,
                    'content-type': 'application/json',
                },
            },
        );
        expect(disconnected.status).toBe(200);

        // A refresh that raced the disconnect rewrites the grant and token.
        await restoreKv(before);
        expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
        // The rewritten grant stays hidden from settings.
        const after = (await (
            await request('/api/mcp', {
                headers: { cookie: `session=valid-${OWNER}` },
            })
        ).json()) as { clients: { clientId: string }[] };
        expect(
            after.clients.some((client) => client.clientId === tokens.clientId),
        ).toBe(false);

        // Turning MCP off revokes in D1 too, so grants the KV cleanup missed
        // stay dead after MCP is turned back on.
        const other = await connectClient(OWNER, { allowWrite: false });
        const beforeDisable = await snapshotKv(OWNER);
        await request('/api/mcp', {
            method: 'PUT',
            headers: {
                cookie: `session=valid-${OWNER}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ enabled: false }),
        });
        await restoreKv(beforeDisable);
        await setEnabled(OWNER, true);
        expect((await rpc(other.access_token, 'tools/list')).status).toBe(401);
    });

    it('caps update_entries at 50 IDs to stay within D1 query limits', async () => {
        await setEnabled(OWNER, true);
        const tokens = await connectClient(OWNER, { allowWrite: true });
        const response = await rpc(tokens.access_token, 'tools/call', {
            name: 'update_entries',
            arguments: {
                entryIds: Array.from({ length: 51 }, (_, index) => index + 1),
                read: true,
            },
        });
        const text = await response.text();
        expect(text).toMatch(/"isError":true|"error"/u);
        const interactions = await env.DB.prepare(
            'SELECT count(*) AS count FROM entry_interactions WHERE read_changed_at IS NOT NULL AND entry_id <= 51',
        ).first<{ count: number }>();
        expect(interactions?.count).toBe(0);
    });

    it('offers write access unticked on the consent page', async () => {
        await setEnabled(OWNER, true);
        const page = await request(
            `/authorize?${authorizeQuery(await registerClient(), 'x'.repeat(43))}`,
            { headers: { cookie: `session=valid-${OWNER}` } },
        );
        const html = await page.text();
        expect(html).toMatch(
            /<input type="checkbox" name="write" value="on">/u,
        );
    });

    it('disconnects one app without touching the others', async () => {
        await setEnabled(OWNER, true);
        const kept = await connectClient(OWNER, { allowWrite: false });
        const removed = await connectClient(OWNER, { allowWrite: false });

        const settings = (await (
            await request('/api/mcp', {
                headers: { cookie: `session=valid-${OWNER}` },
            })
        ).json()) as { clients: { grantId: string; clientId: string }[] };
        const grant = settings.clients.find(
            (client) => client.clientId === removed.clientId,
        );
        expect(grant).toBeDefined();

        const disconnected = await request(
            `/api/mcp/clients/${grant?.grantId}`,
            {
                method: 'DELETE',
                headers: {
                    cookie: `session=valid-${OWNER}`,
                    'content-type': 'application/json',
                },
            },
        );
        expect(disconnected.status).toBe(200);

        // The disconnected app's access and refresh tokens stop working at
        // once; the other app keeps working.
        expect((await rpc(removed.access_token, 'tools/list')).status).toBe(
            401,
        );
        const refreshed = await request('/oauth/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: removed.refresh_token ?? '',
                client_id: removed.clientId,
            }).toString(),
        });
        expect(refreshed.status).toBe(400);
        expect((await rpc(kept.access_token, 'tools/list')).status).toBe(200);

        // Another user cannot disconnect this user's apps.
        const keptGrant = settings.clients.find(
            (client) => client.clientId === kept.clientId,
        );
        const foreign = await request(
            `/api/mcp/clients/${keptGrant?.grantId}`,
            {
                method: 'DELETE',
                headers: {
                    cookie: `session=valid-${OTHER}`,
                    'content-type': 'application/json',
                },
            },
        );
        expect(foreign.status).toBe(404);
        expect((await rpc(kept.access_token, 'tools/list')).status).toBe(200);
    });

    it('cuts off tokens when MCP is turned off and does not revive them', async () => {
        await setEnabled(OWNER, true);
        const tokens = await connectClient(OWNER, { allowWrite: true });

        // The D1 check alone gates every request, before any KV cleanup.
        await setEnabled(OWNER, false);
        expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
        await setEnabled(OWNER, true);
        expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
        const fresh = await connectClient(OWNER, { allowWrite: true });
        expect((await rpc(fresh.access_token, 'tools/list')).status).toBe(200);

        const settings = await request('/api/mcp', {
            headers: { cookie: `session=valid-${OWNER}` },
        });
        const body = (await settings.json()) as {
            enabled: boolean;
            endpointUrl: string;
            clients: { clientName: string }[];
        };
        expect(body.enabled).toBe(true);
        expect(body.endpointUrl).toBe(`${ORIGIN}/mcp`);
        expect(body.clients[0]?.clientName).toBe('Test <MCP> client');

        const disabled = await request('/api/mcp', {
            method: 'PUT',
            headers: {
                cookie: `session=valid-${OWNER}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ enabled: false }),
        });
        expect(await disabled.json()).toMatchObject({
            enabled: false,
            clients: [],
        });
        expect((await rpc(fresh.access_token, 'tools/list')).status).toBe(401);

        // Turning MCP back on must not bring revoked grants back.
        await setEnabled(OWNER, true);
        expect((await rpc(fresh.access_token, 'tools/list')).status).toBe(401);
        const refreshed = await request('/oauth/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: fresh.refresh_token ?? '',
                client_id: fresh.clientId,
            }).toString(),
        });
        expect(refreshed.status).toBe(400);

        const events = await env.DB.prepare(
            `SELECT kind FROM security_events
             WHERE user_id = ? AND kind LIKE 'mcp.%' ORDER BY rowid`,
        )
            .bind(OWNER)
            .all<{ kind: string }>();
        expect(events.results.map((event) => event.kind)).toContain(
            'mcp.client.authorized',
        );
        expect(events.results.map((event) => event.kind)).toContain(
            'mcp.disabled',
        );
    });
});

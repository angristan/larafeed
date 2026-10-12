import {
    AuthorizationError,
    CimdFetchError,
    type ConsentDescription,
    type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';

import { Effect } from 'effect';

import type { AuthenticatedSession } from '../auth/service';
import { readBoundedTextBody } from '../http/request-body';
import type { McpGrantMetadata } from './grants';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from './oauth';

/*
 * The OAuth authorization endpoint. The library validates the request and
 * owns the consent handle; Larafeed signs the user in with its passkey
 * session, checks the MCP opt-in, and renders the consent page.
 *
 * The page is server-rendered HTML rather than part of the React app because
 * the consent handle is bound to the browser by a cookie set on this exact
 * response, and the form must post back here.
 */

const MAX_FORM_BYTES = 8 * 1_024;

export interface AuthorizeDependencies {
    readonly oauth: OAuthHelpers;
    /** The canonical origin. POSTs from any other origin are refused. */
    readonly origin: string;
    /** Resolves the passkey session from the request cookies, or null. */
    readonly authenticate: () => Promise<AuthenticatedSession | null>;
    readonly hasAccess: (userId: number) => Promise<boolean>;
    /**
     * Records the connection in D1 and returns its ID, or null when MCP access
     * was turned off meanwhile.
     */
    readonly createConnection: (
        userId: number,
        clientId: string,
    ) => Promise<number | null>;
}

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);

// No `form-action`: after the consent POST, the browser must follow a 302 to
// the MCP client's redirect URI, and browsers apply `form-action` to that
// redirect. Everything else is locked down; the page has no script.
const PAGE_CSP = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
].join('; ');

const REFERRER_POLICY = 'same-origin';

const securityHeaders = (headers = new Headers()): Headers => {
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Content-Security-Policy', PAGE_CSP);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Content-Type-Options', 'nosniff');
    // The URL carries OAuth parameters such as `state`, so no other site may
    // see it. Not `no-referrer`: under that policy browsers send `Origin: null`
    // on the consent form POST, and the origin check refuses it.
    headers.set('Referrer-Policy', REFERRER_POLICY);
    return headers;
};

const STYLES = `
:root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --text: #1b1f24;
  --muted: #5d6673; --line: #dfe3e8; --accent: #228be6; --accent-text: #fff;
  --warn-bg: #fff4e6; --warn-text: #8a4b00; }
@media (prefers-color-scheme: dark) { :root { --bg: #15171b; --card: #1e2126;
  --text: #e7e9ec; --muted: #9aa3ae; --line: #2f343b; --accent: #4dabf7;
  --accent-text: #0b1520; --warn-bg: #3a2a12; --warn-text: #ffd8a8; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center;
  padding: 24px; background: var(--bg); color: var(--text);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 440px; background: var(--card);
  border: 1px solid var(--line); border-radius: 12px; padding: 28px; }
.brand { font-weight: 700; letter-spacing: .02em; color: var(--muted);
  font-size: 13px; text-transform: uppercase; margin: 0 0 16px; }
h1 { font-size: 20px; line-height: 1.3; margin: 0 0 12px; }
p { margin: 0 0 12px; }
.muted { color: var(--muted); font-size: 14px; }
.warn { background: var(--warn-bg); color: var(--warn-text); border-radius: 8px;
  padding: 10px 12px; font-size: 14px; }
fieldset { border: 1px solid var(--line); border-radius: 8px; margin: 16px 0;
  padding: 4px 14px; }
legend { font-weight: 600; padding: 0 4px; font-size: 14px; }
label { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; }
label + label { border-top: 1px solid var(--line); }
input[type=checkbox] { margin-top: 4px; width: 16px; height: 16px; }
.actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
button, .button { font: inherit; font-weight: 600; border-radius: 8px;
  padding: 9px 16px; border: 1px solid var(--line); background: transparent;
  color: var(--text); cursor: pointer; text-decoration: none; display: inline-block; }
button.primary, .button.primary { background: var(--accent);
  border-color: var(--accent); color: var(--accent-text); }
code { overflow-wrap: anywhere; }
`;

const page = (
    title: string,
    body: string,
    status = 200,
    headers?: Headers,
): Response =>
    new Response(
        `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="${REFERRER_POLICY}">
<title>${escapeHtml(title)} · Larafeed</title>
<style>${STYLES}</style>
</head>
<body><main>
<p class="brand">Larafeed</p>
${body}
</main></body>
</html>`,
        { status, headers: securityHeaders(headers) },
    );

const messagePage = (
    title: string,
    message: string,
    status: number,
    action?: { readonly href: string; readonly label: string },
): Response =>
    page(
        title,
        `<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
${
    action === undefined
        ? ''
        : `<div class="actions"><a class="button primary" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a></div>`
}`,
        status,
    );

const redirect = (location: string, headers = new Headers()): Response => {
    headers.set('Location', location);
    headers.set('Cache-Control', 'no-store');
    return new Response(null, { status: 302, headers });
};

const consentPage = (
    details: ConsentDescription,
    handle: string,
    session: AuthenticatedSession,
    headers: Headers,
): Response => {
    const name = escapeHtml(details.clientName);
    const publisher =
        details.clientDomain === undefined
            ? '<p class="muted">This app registered itself, so its name is not verified.</p>'
            : `<p class="muted">Published by <strong>${escapeHtml(details.clientDomain)}</strong>.</p>`;
    const loopbackWarning = details.redirectIsLoopback
        ? '<p class="warn">Access goes to an app on this computer. Continue only if you just started connecting from that app.</p>'
        : '';

    return page(
        `Connect ${details.clientName}`,
        `<h1>Allow ${name} to use your Larafeed account?</h1>
${publisher}
<p class="muted">Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${loopbackWarning}
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<input type="hidden" name="user" value="${session.user.id}">
<fieldset>
<legend>Permissions</legend>
<!-- Write access is opt-in: an app gets read-only access unless the user ticks it. -->
<label><input type="checkbox" checked disabled>
<span>Read your subscriptions, categories, and articles</span></label>
<label><input type="checkbox" name="write" value="on">
<span>Mark articles read, starred, or archived, and add or remove subscriptions</span></label>
</fieldset>
<p class="muted">Signed in as <strong>${escapeHtml(session.user.username)}</strong>. You can disconnect this app at any time in Settings → MCP.</p>
<div class="actions">
<button type="submit" name="decision" value="deny">Cancel</button>
<button type="submit" name="decision" value="approve" class="primary">Allow</button>
</div>
</form>`,
        200,
        headers,
    );
};

const pathWithSearch = (request: Request): string => {
    const url = new URL(request.url);
    return `${url.pathname}${url.search}`;
};

const accessOffPage = (request: Request): Response => {
    const settings = `/settings/mcp?${new URLSearchParams({
        returnTo: pathWithSearch(request),
    }).toString()}`;
    return messagePage(
        'MCP access is off',
        'Turn on MCP access in Larafeed settings, then continue connecting this app.',
        403,
        { href: settings, label: 'Open MCP settings' },
    );
};

/**
 * Maps a failed authorization request to a response. Only a request whose
 * client and exact redirect URI the library validated may redirect back to
 * the client; everything else renders here.
 */
const authorizationFailure = (error: unknown): Response => {
    if (error instanceof AuthorizationError) {
        if (error.redirectTo !== undefined) return redirect(error.redirectTo);
        return messagePage(
            'This connection request is not valid',
            error.description,
            400,
        );
    }
    if (error instanceof CimdFetchError) {
        console.warn({
            event: 'mcp.oauth.cimd_failed',
            reason: error.reason,
        });
        return messagePage(
            'This app could not be verified',
            'Larafeed could not load the app’s published details. Try again later.',
            400,
        );
    }
    throw error;
};

const expiredFormPage = (): Response =>
    messagePage(
        'This page expired',
        'Start connecting again from your app.',
        400,
    );

export const handleAuthorizeGet = async (
    request: Request,
    dependencies: AuthorizeDependencies,
): Promise<Response> => {
    let authRequest: Awaited<ReturnType<OAuthHelpers['parseAuthRequest']>>;
    let details: ConsentDescription;
    try {
        authRequest = await dependencies.oauth.parseAuthRequest(request);
    } catch (error) {
        return authorizationFailure(error);
    }

    const session = await dependencies.authenticate();
    if (session === null) {
        const login = new URLSearchParams({
            returnTo: pathWithSearch(request),
        });
        return redirect(`/login?${login.toString()}`);
    }
    if (!(await dependencies.hasAccess(session.user.id))) {
        return accessOffPage(request);
    }

    try {
        // Describe first: a failed client lookup leaves nothing in KV.
        details = await dependencies.oauth.describeConsent(authRequest);
    } catch (error) {
        return authorizationFailure(error);
    }
    const consent = await dependencies.oauth.beginConsent(authRequest);
    return consentPage(details, consent.handle, session, consent.headers);
};

const mediaType = (request: Request): string | undefined =>
    request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();

export const handleAuthorizePost = async (
    request: Request,
    dependencies: AuthorizeDependencies,
): Promise<Response> => {
    // The consent handle and its browser-bound cookie already stop a forged
    // form. Checking the origin as well keeps cross-site posts out entirely.
    if (request.headers.get('Origin') !== dependencies.origin) {
        return messagePage(
            'Request refused',
            'This form must be sent from Larafeed.',
            403,
        );
    }
    if (mediaType(request) !== 'application/x-www-form-urlencoded') {
        return messagePage('Request refused', 'The form is not valid.', 400);
    }

    const session = await dependencies.authenticate();
    if (session === null) {
        return messagePage(
            'You are signed out',
            'Sign in to Larafeed, then start connecting again from your app.',
            401,
            { href: '/login', label: 'Sign in' },
        );
    }
    if (!(await dependencies.hasAccess(session.user.id))) {
        return accessOffPage(request);
    }

    // The library reads the original request again (for the binding cookie),
    // so read a clone, with a size bound.
    const body = await Effect.runPromise(
        readBoundedTextBody(request.clone() as Request, MAX_FORM_BYTES).pipe(
            Effect.option,
        ),
    );
    if (body._tag === 'None') {
        return messagePage('Request refused', 'The form is not valid.', 400);
    }
    const form = new URLSearchParams(body.value);
    const handle = form.get('handle');
    if (typeof handle !== 'string' || handle.length === 0) {
        return expiredFormPage();
    }
    // The page named the account it was shown for. If the browser switched
    // accounts since, refuse instead of granting the other account.
    if (form.get('user') !== String(session.user.id)) {
        return messagePage(
            'Your account changed',
            'You signed in to another account after this page opened. Start connecting again from your app.',
            409,
        );
    }

    try {
        if (form.get('decision') !== 'approve') {
            const denied = await dependencies.oauth.denyConsent(
                request,
                handle,
            );
            return new Response(null, { status: 302, headers: denied.headers });
        }

        const scope = [
            MCP_READ_SCOPE,
            ...(form.get('write') === 'on' ? [MCP_WRITE_SCOPE] : []),
        ];
        const approved = await dependencies.oauth.approveConsent(
            request,
            handle,
            { scope },
        );

        const connectionId = await dependencies.createConnection(
            session.user.id,
            approved.request.clientId,
        );
        if (connectionId === null) return accessOffPage(request);

        let metadata: McpGrantMetadata = {
            connectionId,
            clientName: approved.request.clientId,
            clientDomain: null,
        };
        try {
            const details = await dependencies.oauth.describeConsent(
                approved.request,
            );
            metadata = {
                connectionId,
                clientName: details.clientName,
                clientDomain: details.clientDomain ?? null,
            };
        } catch {
            // The name is only shown in settings; the client ID still works.
        }

        // If this fails, the connection row stays unused: no token refers to
        // it and the settings list only shows connections with a grant.
        const { redirectTo } = await dependencies.oauth.completeAuthorization({
            request: approved.request,
            userId: String(session.user.id),
            metadata,
            scope: approved.request.scope,
            props: { userId: session.user.id, connectionId },
        });
        return redirect(redirectTo, approved.headers);
    } catch (error) {
        if (error instanceof AuthorizationError) return expiredFormPage();
        return authorizationFailure(error);
    }
};

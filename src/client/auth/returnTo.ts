/**
 * Returns the OAuth authorization URL from a `returnTo` query parameter.
 *
 * MCP clients send users to `/authorize`, which the Worker serves, not the
 * React app. Login and MCP settings send users back there with a full page
 * load. Only a path on this origin is accepted, so the parameter cannot
 * redirect anywhere else.
 */
export function authorizationReturnTarget(search: string): string | null {
    const returnTo = new URLSearchParams(search).get('returnTo');
    return returnTo?.startsWith('/authorize?') ? returnTo : null;
}

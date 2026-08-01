import type { AccessLinkPurpose } from '@shared/schemas/auth';

interface FragmentLocation {
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
}

interface FragmentHistory {
    readonly state: unknown;
    replaceState(
        data: unknown,
        unused: string,
        url?: string | URL | null,
    ): void;
}

interface AccessTokenVault {
    readonly purpose: AccessLinkPurpose;
    readonly token: string;
}

let tokenVault: AccessTokenVault | undefined;

function tokenFromHash(hash: string): string | undefined {
    const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
    if (fragment.length === 0) {
        return undefined;
    }

    const parameters = new URLSearchParams(fragment);
    const namedToken = parameters.get('token');
    if (namedToken !== null) {
        return namedToken;
    }

    if (fragment.includes('=')) {
        return undefined;
    }

    try {
        return decodeURIComponent(fragment);
    } catch {
        return undefined;
    }
}

function urlWithoutToken(location: FragmentLocation): string {
    const parameters = new URLSearchParams(location.search);
    parameters.delete('token');
    const search = parameters.toString();

    return `${location.pathname}${search.length === 0 ? '' : `?${search}`}`;
}

export function captureAccessTokenFromFragment(
    location: FragmentLocation,
    history: FragmentHistory,
    purpose: AccessLinkPurpose,
): void {
    const token = tokenFromHash(location.hash);

    if (
        location.hash.length > 0 ||
        new URLSearchParams(location.search).has('token')
    ) {
        history.replaceState(history.state, '', urlWithoutToken(location));
    }

    if (token !== undefined && token.length >= 1 && token.length <= 2048) {
        tokenVault = { purpose, token };
    } else if (tokenVault?.purpose !== purpose) {
        tokenVault = undefined;
    }
}

export function getCapturedAccessToken(
    purpose: AccessLinkPurpose,
): string | undefined {
    return tokenVault?.purpose === purpose ? tokenVault.token : undefined;
}

export function clearCapturedAccessToken(): void {
    tokenVault = undefined;
}

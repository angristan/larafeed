import type { AuthSessionResponse } from '@shared/http';

import { AuthClientError } from './authError';

export type AuthSession = typeof AuthSessionResponse.Type;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyTrimmedString = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.trim() === value;

const isSafeId = (value: unknown): value is number =>
    Number.isSafeInteger(value) && Number(value) >= 1;

const isNonNegativeInteger = (value: unknown): value is number =>
    Number.isSafeInteger(value) && Number(value) >= 0;

export function decodeAuthSession(value: unknown): AuthSession {
    if (!isRecord(value)) {
        throw new TypeError('Authentication session must be an object.');
    }

    if (value.authenticated === false) {
        return { authenticated: false };
    }

    const user = value.user;
    if (
        value.authenticated !== true ||
        !isRecord(user) ||
        !isSafeId(user.id) ||
        !isNonEmptyTrimmedString(user.username) ||
        !isNonEmptyTrimmedString(user.displayName) ||
        typeof user.isAdmin !== 'boolean' ||
        !isNonNegativeInteger(value.expiresAt)
    ) {
        throw new TypeError('Authentication session has an invalid shape.');
    }

    return {
        authenticated: true,
        user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            isAdmin: user.isAdmin,
        },
        expiresAt: value.expiresAt,
    };
}

export async function fetchAuthSession(
    signal: AbortSignal,
): Promise<AuthSession> {
    let response: Response;
    try {
        response = await fetch('/api/auth/session', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            signal,
        });
    } catch (cause) {
        if (signal.aborted) throw cause;
        throw new AuthClientError(
            'transport',
            'The authentication service is unavailable.',
            undefined,
            undefined,
            cause,
        );
    }

    let body: unknown;
    try {
        body = await response.json();
    } catch (cause) {
        throw new AuthClientError(
            'decode',
            'The authentication service returned invalid JSON.',
            response.status,
            undefined,
            cause,
        );
    }

    if (!response.ok) {
        const message =
            isRecord(body) &&
            isRecord(body.error) &&
            typeof body.error.message === 'string'
                ? body.error.message
                : `The authentication service returned status ${response.status}.`;
        throw new AuthClientError('status', message, response.status);
    }

    try {
        return decodeAuthSession(body);
    } catch (cause) {
        throw new AuthClientError(
            'decode',
            'The authentication response has an invalid shape.',
            response.status,
            undefined,
            cause,
        );
    }
}

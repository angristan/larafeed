import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    captureAccessTokenFromFragment,
    clearCapturedAccessToken,
    getCapturedAccessToken,
} from './accessToken';

function makeHistory() {
    return {
        state: { navigation: 1 },
        replaceState: vi.fn(),
    };
}

beforeEach(() => {
    clearCapturedAccessToken();
});

describe('access link token capture', () => {
    it('captures a named fragment token and scrubs it immediately', () => {
        const history = makeHistory();

        captureAccessTokenFromFragment(
            {
                pathname: '/auth/enroll',
                search: '?source=admin',
                hash: '#token=private-token',
            },
            history,
            'enrollment',
        );

        expect(getCapturedAccessToken('enrollment')).toBe('private-token');
        expect(getCapturedAccessToken('recovery')).toBeUndefined();
        expect(history.replaceState).toHaveBeenCalledOnce();
        expect(history.replaceState).toHaveBeenCalledWith(
            history.state,
            '',
            '/auth/enroll?source=admin',
        );
    });

    it('supports a raw encoded fragment without copying it into a URL', () => {
        const history = makeHistory();

        captureAccessTokenFromFragment(
            {
                pathname: '/auth/recover',
                search: '',
                hash: '#raw%2Dtoken',
            },
            history,
            'recovery',
        );

        expect(getCapturedAccessToken('recovery')).toBe('raw-token');
        expect(history.replaceState).toHaveBeenCalledWith(
            history.state,
            '',
            '/auth/recover',
        );
    });

    it('clears a captured token when the ceremony purpose changes', () => {
        const history = makeHistory();
        captureAccessTokenFromFragment(
            {
                pathname: '/auth/enroll',
                search: '',
                hash: '#token=enrollment-secret',
            },
            history,
            'enrollment',
        );

        captureAccessTokenFromFragment(
            {
                pathname: '/auth/recover',
                search: '',
                hash: '',
            },
            history,
            'recovery',
        );

        expect(getCapturedAccessToken('enrollment')).toBeUndefined();
    });

    it('never reads a token from the query string', () => {
        const history = makeHistory();

        captureAccessTokenFromFragment(
            {
                pathname: '/auth/recover',
                search: '?token=query-secret&source=admin',
                hash: '',
            },
            history,
            'recovery',
        );

        expect(getCapturedAccessToken('recovery')).toBeUndefined();
        expect(history.replaceState).toHaveBeenCalledWith(
            history.state,
            '',
            '/auth/recover?source=admin',
        );
    });
});

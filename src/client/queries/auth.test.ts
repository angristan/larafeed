import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { AuthClientError } from '../api/auth';
import { ReaderClientError } from '../api/reader';
import { createAppQueryClient } from '../queryClient';
import {
    authKeys,
    clearAuthenticatedCache,
    isUnauthenticatedError,
    protectedQueryKeys,
} from './auth';

describe('authentication cache policy', () => {
    it('clears protected data but preserves public data', () => {
        const queryClient = new QueryClient();
        queryClient.setQueryData(authKeys.session(), {
            authenticated: true,
            user: {
                id: 1,
                username: 'owner',
                displayName: 'Owner',
                isAdmin: true,
            },
            expiresAt: 1_900_000_000_000,
        });
        queryClient.setQueryData(
            [...protectedQueryKeys.all, 'entries'],
            [{ id: 1 }],
        );
        queryClient.setQueryData(['public', 'config'], { enabled: true });

        clearAuthenticatedCache(queryClient);

        expect(
            queryClient.getQueryData([...protectedQueryKeys.all, 'entries']),
        ).toBeUndefined();
        expect(queryClient.getQueryData(['public', 'config'])).toEqual({
            enabled: true,
        });
        expect(queryClient.getQueryData(authKeys.session())).toEqual({
            authenticated: false,
        });
    });

    it('applies the same policy after a 401 query error', async () => {
        const queryClient = createAppQueryClient();
        queryClient.setQueryData([...protectedQueryKeys.all, 'profile'], {
            private: true,
        });

        await expect(
            queryClient.fetchQuery({
                queryKey: ['test', 'unauthorized'],
                retry: false,
                queryFn: () =>
                    Promise.reject(
                        new AuthClientError(
                            'status',
                            'Sign in again.',
                            401,
                            'unauthenticated',
                        ),
                    ),
            }),
        ).rejects.toBeInstanceOf(AuthClientError);

        expect(
            queryClient.getQueryData([...protectedQueryKeys.all, 'profile']),
        ).toBeUndefined();
        expect(queryClient.getQueryData(authKeys.session())).toEqual({
            authenticated: false,
        });
    });

    it('stops protected observers and handles session expiry once', async () => {
        const onSessionExpired = vi.fn();
        const queryClient = createAppQueryClient(onSessionExpired);
        queryClient.setQueryData(authKeys.session(), {
            authenticated: true,
            user: {
                id: 1,
                username: 'owner',
                displayName: 'Owner',
                isAdmin: true,
            },
            expiresAt: 1_900_000_000_000,
        });
        const queryFn = vi.fn(() =>
            Promise.reject(
                new AuthClientError(
                    'status',
                    'Sign in again.',
                    401,
                    'unauthenticated',
                ),
            ),
        );
        const options = {
            queryKey: [...protectedQueryKeys.all, 'storm-regression'] as const,
            queryFn,
            retry: false,
        };
        const observer = new QueryObserver(queryClient, options);
        const unsubscribe = observer.subscribe(() => undefined);

        await vi.waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
        observer.setOptions(options);
        await Promise.resolve();

        expect(queryFn).toHaveBeenCalledOnce();
        expect(queryClient.getQueryData(authKeys.session())).toEqual({
            authenticated: false,
        });

        await expect(
            queryClient.fetchQuery({
                queryKey: ['another', 'unauthorized'],
                retry: false,
                queryFn,
            }),
        ).rejects.toBeInstanceOf(AuthClientError);
        expect(onSessionExpired).toHaveBeenCalledOnce();
        unsubscribe();
    });

    it('classifies reader API 401 responses as session expiry', () => {
        expect(
            isUnauthenticatedError(
                new ReaderClientError(
                    'status',
                    'Sign in again.',
                    401,
                    'unauthenticated',
                ),
            ),
        ).toBe(true);
    });

    it('disables retries globally for mutations', () => {
        const queryClient = createAppQueryClient();

        expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
    });
});

import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    appTokenKeys,
    appTokenListQueryOptions,
    createAppTokenMutationOptions,
    revokeAppTokenMutationOptions,
} from './appTokens';

const token = {
    id: 17,
    name: 'Phone reader',
    prefix: 'lf_app_abc',
    scopes: ['google-reader'] as const,
    createdAt: 1_900_000_000_000,
    lastUsedAt: null,
    expiresAt: null,
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('app token query contracts', () => {
    it('uses the protected query hierarchy and disables retries', () => {
        expect(appTokenKeys.list()).toEqual([
            'protected',
            'app-tokens',
            'list',
            'current',
        ]);
        expect(appTokenListQueryOptions.queryKey).toEqual(appTokenKeys.list());
        expect(appTokenListQueryOptions.retry).toBe(false);
    });

    it('reveals plaintext locally but stores only metadata in mutation state', async () => {
        vi.stubGlobal('document', { cookie: 'larafeed-csrf=csrf-token' });
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json(
                        {
                            token,
                            plaintextToken: 'lf_app_one-time-secret',
                        },
                        { status: 201 },
                    ),
                ),
            ),
        );

        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        });
        queryClient.setQueryData(appTokenKeys.list(), { tokens: [] });
        const reveal = vi.fn();
        const mutation = queryClient
            .getMutationCache()
            .build(
                queryClient,
                createAppTokenMutationOptions(queryClient, reveal),
            );

        await expect(
            mutation.execute({
                name: 'Phone reader',
                scopes: ['google-reader'],
            }),
        ).resolves.toEqual(token);
        expect(reveal).toHaveBeenCalledWith({
            token,
            plaintextToken: 'lf_app_one-time-secret',
        });
        expect(mutation.state.data).toEqual(token);
        expect(mutation.state.data).not.toHaveProperty('plaintextToken');
        expect(
            queryClient.getQueryState(appTokenKeys.list())?.isInvalidated,
        ).toBe(true);
    });

    it('revokes without optimistic changes and invalidates the token list', async () => {
        vi.stubGlobal('document', { cookie: 'larafeed-csrf=csrf-token' });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
        );

        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        });
        const list = { tokens: [token] };
        queryClient.setQueryData(appTokenKeys.list(), list);
        const mutation = queryClient
            .getMutationCache()
            .build(
                queryClient,
                revokeAppTokenMutationOptions(queryClient, token.id),
            );

        const promise = mutation.execute(undefined);
        expect(queryClient.getQueryData(appTokenKeys.list())).toBe(list);
        await expect(promise).resolves.toBeUndefined();
        expect(queryClient.getQueryData(appTokenKeys.list())).toBe(list);
        expect(
            queryClient.getQueryState(appTokenKeys.list())?.isInvalidated,
        ).toBe(true);
    });
});

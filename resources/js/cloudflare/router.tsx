import {
    createBrowserRouter,
    type LoaderFunctionArgs,
    redirect,
} from 'react-router';

import {
    captureAccessTokenFromFragment,
    clearCapturedAccessToken,
} from './auth/accessToken';
import {
    authSessionQueryOptions,
    clearAuthenticatedCache,
} from './queries/auth';
import {
    categoryListQueryOptions,
    entryDetailQueryOptions,
    entryListQueryOptions,
    readerCountsQueryOptions,
    subscriptionListQueryOptions,
} from './queries/reader';
import { subscriptionManagementQueryOptions } from './queries/subscriptions';
import { queryClient } from './queryClient';
import {
    canonicalReaderSearch,
    parseReaderState,
    READER_PAGE_SIZE,
} from './readerState';

async function protectedLoader({ url }: LoaderFunctionArgs) {
    const session = await queryClient.ensureQueryData(authSessionQueryOptions);

    if (!session.authenticated) {
        clearAuthenticatedCache(queryClient);
        clearCapturedAccessToken();
        const returnTo = `${url.pathname}${url.search}`;
        const parameters = new URLSearchParams({ returnTo });
        throw redirect(`/login?${parameters.toString()}`);
    }

    return null;
}

async function loginLoader() {
    clearCapturedAccessToken();

    try {
        const session = await queryClient.ensureQueryData(
            authSessionQueryOptions,
        );
        if (session.authenticated) {
            throw redirect('/');
        }
        clearAuthenticatedCache(queryClient);
    } catch (error) {
        if (error instanceof Response) {
            throw error;
        }
        // A login page must remain reachable when the session check is down.
    }

    return null;
}

function accessTokenLoader(purpose: 'enrollment' | 'recovery') {
    return () => {
        captureAccessTokenFromFragment(
            window.location,
            window.history,
            purpose,
        );
        return null;
    };
}

async function rootLoader(args: LoaderFunctionArgs) {
    await protectedLoader(args);
    throw redirect('/feeds');
}

async function subscriptionsLoader(args: LoaderFunctionArgs) {
    await protectedLoader(args);
    await queryClient.prefetchQuery(subscriptionManagementQueryOptions);
    return null;
}

async function readerLoader(args: LoaderFunctionArgs) {
    await protectedLoader(args);

    const canonicalSearch = canonicalReaderSearch(args.url.searchParams);
    if (args.url.search.slice(1) !== canonicalSearch) {
        throw redirect(`/feeds?${canonicalSearch}`);
    }

    const state = parseReaderState(args.url.searchParams);
    const prefetches = [
        queryClient.prefetchQuery(categoryListQueryOptions),
        queryClient.prefetchQuery(subscriptionListQueryOptions),
        queryClient.prefetchQuery(readerCountsQueryOptions),
        queryClient.prefetchQuery(
            entryListQueryOptions({
                feedId: state.feedId,
                categoryId: state.categoryId,
                filter: state.filter,
                orderBy: state.orderBy,
                page: state.page,
                pageSize: READER_PAGE_SIZE,
            }),
        ),
    ];

    if (state.entryId !== null) {
        prefetches.push(
            queryClient.prefetchQuery(entryDetailQueryOptions(state.entryId)),
        );
    }

    await Promise.all(prefetches);
    return null;
}

const accessRegistrationRoute =
    (purpose: 'enrollment' | 'recovery') => async () => {
        const { AccessRegistrationPage } = await import(
            './pages/AccessRegistrationPage'
        );

        return {
            Component: () => <AccessRegistrationPage purpose={purpose} />,
        };
    };

export const router = createBrowserRouter([
    {
        path: '/login',
        loader: loginLoader,
        lazy: async () => {
            const { LoginPage } = await import('./pages/LoginPage');
            return { Component: LoginPage };
        },
    },
    {
        path: '/auth/enroll',
        loader: accessTokenLoader('enrollment'),
        lazy: accessRegistrationRoute('enrollment'),
    },
    {
        path: '/auth/recover',
        loader: accessTokenLoader('recovery'),
        lazy: accessRegistrationRoute('recovery'),
    },
    {
        path: '/',
        loader: rootLoader,
    },
    {
        path: '/feeds',
        loader: readerLoader,
        lazy: async () => {
            const { ReaderPage } = await import('./pages/ReaderPage');
            return { Component: ReaderPage };
        },
    },
    {
        path: '/settings/subscriptions',
        loader: subscriptionsLoader,
        lazy: async () => {
            const { SubscriptionsPage } = await import(
                './pages/SubscriptionsPage'
            );
            return { Component: SubscriptionsPage };
        },
    },
    {
        path: '/settings/opml',
        loader: protectedLoader,
        lazy: async () => {
            const { OpmlPage } = await import('./pages/OpmlPage');
            return { Component: OpmlPage };
        },
    },
    {
        path: '/settings/app-tokens',
        loader: protectedLoader,
        lazy: async () => {
            const { AppTokensPage } = await import('./pages/AppTokensPage');
            return { Component: AppTokensPage };
        },
    },
]);

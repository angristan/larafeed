import {
    createBrowserRouter,
    type LoaderFunctionArgs,
    redirect,
} from 'react-router';

import {
    captureAccessTokenFromFragment,
    clearCapturedAccessToken,
} from './auth/accessToken';
import { NotFoundPage, RouteErrorPage } from './pages/RouteStatePage';
import {
    authConfigQueryOptions,
    authSessionQueryOptions,
    clearAuthenticatedCache,
} from './queries/auth';
import {
    categoryListQueryOptions,
    entryDetailQueryOptions,
    entryListInfiniteQueryOptions,
    readerCountsQueryOptions,
    subscriptionListQueryOptions,
} from './queries/reader';
import { queryClient, setAppSessionExpiredHandler } from './queryClient';
import {
    canonicalReaderRouteSearch,
    parseReaderState,
    READER_PAGE_SIZE,
} from './readerState';

async function protectedLoader({ url }: LoaderFunctionArgs) {
    const session = await queryClient.ensureQueryData(authSessionQueryOptions);

    if (!session.authenticated) {
        clearAuthenticatedCache(queryClient);
        clearCapturedAccessToken();
        const target = sessionExpiryLoginTarget(url);
        if (target !== null) throw redirect(target);
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

async function securityLoader(args: LoaderFunctionArgs) {
    const accountQueries = import('./queries/account');
    await protectedLoader(args);
    const { accountQueryOptions, passkeysQueryOptions } = await accountQueries;

    // Warm non-critical page data without making React Router wait for every
    // request. The mounted queries own loading and error presentation.
    void Promise.all([
        queryClient.prefetchQuery(accountQueryOptions),
        queryClient.prefetchQuery(passkeysQueryOptions),
        queryClient.prefetchQuery(authConfigQueryOptions),
    ]);
    return null;
}

async function adminLoader(args: LoaderFunctionArgs) {
    const accountQueries = import('./queries/account');
    await protectedLoader(args);
    const session = queryClient.getQueryData(authSessionQueryOptions.queryKey);
    if (session?.authenticated !== true || !session.user.isAdmin) {
        throw redirect('/feeds');
    }

    const { adminOverviewQueryOptions } = await accountQueries;
    void queryClient.prefetchQuery(adminOverviewQueryOptions);
    return null;
}

async function subscriptionsLoader(args: LoaderFunctionArgs) {
    const subscriptionQueries = import('./queries/subscriptions');
    await protectedLoader(args);
    const { subscriptionManagementQueryOptions } = await subscriptionQueries;
    void queryClient.prefetchQuery(subscriptionManagementQueryOptions);
    return null;
}

const legacySettingsPaths = {
    '/subscriptions': '/settings/subscriptions',
    '/import': '/settings/opml',
} as const;

export function sessionExpiryLoginTarget(location: {
    readonly pathname: string;
    readonly search: string;
    readonly hash?: string;
}): string | null {
    if (location.pathname === '/login') return null;

    const returnTo = `${location.pathname}${location.search}${location.hash ?? ''}`;
    const parameters = new URLSearchParams({ returnTo });
    return `/login?${parameters.toString()}`;
}

export function legacySettingsRedirectTarget(url: URL): string | null {
    const pathname =
        url.pathname.length > 1 && url.pathname.endsWith('/')
            ? url.pathname.slice(0, -1)
            : url.pathname;

    if (pathname === '/profile') {
        const search = new URLSearchParams(url.search);
        const section = search.get('section');
        search.delete('section');

        const target =
            section === 'opml' ? '/settings/opml' : '/settings/security';
        const hash =
            section === 'security'
                ? '#security'
                : section === 'profile'
                  ? '#profile'
                  : section === 'opml'
                    ? url.hash
                    : url.hash || '#profile';
        const query = search.toString();
        return `${target}${query === '' ? '' : `?${query}`}${hash}`;
    }

    const target =
        legacySettingsPaths[pathname as keyof typeof legacySettingsPaths];
    if (target === undefined) return null;
    return `${target}${url.search}${url.hash}`;
}

async function legacySettingsLoader(args: LoaderFunctionArgs) {
    await protectedLoader(args);
    const target = legacySettingsRedirectTarget(args.url);
    if (target !== null) throw redirect(target);
    return null;
}

async function chartsLoader(args: LoaderFunctionArgs) {
    const routeModules = Promise.all([
        import('./chartState'),
        import('./queries/charts'),
        import('./queries/subscriptions'),
    ]);
    await protectedLoader(args);
    const [chartState, charts, subscriptions] = await routeModules;
    const state = chartState.parseChartState(args.url.searchParams);
    const canonicalSearch = chartState.canonicalChartSearch(state);
    if (args.url.search.slice(1) !== canonicalSearch) {
        throw redirect(
            `${args.url.pathname}${
                canonicalSearch.length > 0 ? `?${canonicalSearch}` : ''
            }`,
        );
    }
    void Promise.all([
        queryClient.prefetchQuery(
            subscriptions.subscriptionManagementQueryOptions,
        ),
        queryClient.prefetchQuery(charts.chartQueryOptions(state)),
    ]);
    return null;
}

// Search-only navigation (opening an entry, switching filters or chart
// ranges) is handled by queries the page already has mounted. Re-running
// the loader would block the transition on every stale prefetch.
const revalidateOnPathChange = ({
    currentUrl,
    nextUrl,
}: {
    readonly currentUrl: URL;
    readonly nextUrl: URL;
}) => currentUrl.pathname !== nextUrl.pathname;

async function readerLoader(args: LoaderFunctionArgs) {
    await protectedLoader(args);

    const canonicalSearch = canonicalReaderRouteSearch(args.url.searchParams);
    if (args.url.search.slice(1) !== canonicalSearch) {
        throw redirect(`/feeds?${canonicalSearch}`);
    }

    const state = parseReaderState(args.url.searchParams);
    const prefetches = [
        queryClient.prefetchQuery(categoryListQueryOptions),
        queryClient.prefetchQuery(subscriptionListQueryOptions),
        queryClient.prefetchQuery(readerCountsQueryOptions),
        queryClient.prefetchInfiniteQuery(
            entryListInfiniteQueryOptions({
                feedId: state.feedId,
                categoryId: state.categoryId,
                filter: state.filter,
                orderBy: state.orderBy,
                pageSize: READER_PAGE_SIZE,
            }),
        ),
    ];

    if (state.entryId !== null) {
        prefetches.push(
            queryClient.prefetchQuery(entryDetailQueryOptions(state.entryId)),
        );
    }

    void Promise.all(prefetches);
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
        errorElement: <RouteErrorPage />,
        children: [
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
                shouldRevalidate: revalidateOnPathChange,
                lazy: async () => {
                    const { ReaderPage } = await import('./pages/ReaderPage');
                    return { Component: ReaderPage };
                },
            },
            {
                path: '/charts',
                loader: chartsLoader,
                shouldRevalidate: revalidateOnPathChange,
                lazy: async () => {
                    const { ChartsPage } = await import('./pages/ChartsPage');
                    return { Component: ChartsPage };
                },
            },
            {
                path: '/charts/reading',
                loader: chartsLoader,
                shouldRevalidate: revalidateOnPathChange,
                lazy: async () => {
                    const { ReadingChartsPage } = await import(
                        './pages/ChartsPage'
                    );
                    return { Component: ReadingChartsPage };
                },
            },
            {
                path: '/charts/refresh',
                loader: chartsLoader,
                shouldRevalidate: revalidateOnPathChange,
                lazy: async () => {
                    const { RefreshChartsPage } = await import(
                        './pages/ChartsPage'
                    );
                    return { Component: RefreshChartsPage };
                },
            },
            {
                path: '/charts/backlog',
                loader: chartsLoader,
                shouldRevalidate: revalidateOnPathChange,
                lazy: async () => {
                    const { BacklogChartsPage } = await import(
                        './pages/ChartsPage'
                    );
                    return { Component: BacklogChartsPage };
                },
            },
            {
                path: '/settings/security',
                loader: securityLoader,
                lazy: async () => {
                    const { SecurityPage } = await import(
                        './pages/SecurityPage'
                    );
                    return { Component: SecurityPage };
                },
            },
            {
                path: '/admin/users',
                loader: adminLoader,
                lazy: async () => {
                    const { AdminUsersPage } = await import(
                        './pages/AdminUsersPage'
                    );
                    return { Component: AdminUsersPage };
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
                path: '/settings/subscriptions/overview',
                loader: subscriptionsLoader,
                lazy: async () => {
                    const { SubscriptionOverviewPage } = await import(
                        './pages/SubscriptionsPage'
                    );
                    return { Component: SubscriptionOverviewPage };
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
                path: '/settings/appearance',
                loader: protectedLoader,
                lazy: async () => {
                    const { AppearancePage } = await import(
                        './pages/AppearancePage'
                    );
                    return { Component: AppearancePage };
                },
            },
            {
                path: '/settings/app-tokens',
                loader: protectedLoader,
                lazy: async () => {
                    const { AppTokensPage } = await import(
                        './pages/AppTokensPage'
                    );
                    return { Component: AppTokensPage };
                },
            },
            {
                path: '/subscriptions',
                loader: legacySettingsLoader,
            },
            {
                path: '/profile',
                loader: legacySettingsLoader,
            },
            {
                path: '/import',
                loader: legacySettingsLoader,
            },
            {
                path: '*',
                loader: protectedLoader,
                Component: NotFoundPage,
            },
        ],
    },
]);

setAppSessionExpiredHandler(() => {
    const target = sessionExpiryLoginTarget(router.state.location);
    if (target === null) return;

    clearCapturedAccessToken();
    void router.navigate(target, { replace: true });
});

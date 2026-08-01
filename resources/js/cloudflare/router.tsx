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
import { queryClient } from './queryClient';

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
        loader: protectedLoader,
        lazy: async () => {
            const { HomePage } = await import('./pages/HomePage');
            return { Component: HomePage };
        },
    },
]);

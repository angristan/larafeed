import { PageProps as AppPageProps } from './';
import { PageProps as InertiaPageProps } from '@inertiajs/core';
import { route as ziggyRoute } from 'ziggy-js';

declare global {
    interface Window {
        route: typeof ziggyRoute;
    }

    const route: typeof ziggyRoute;
}

declare module '@inertiajs/core' {
    interface PageProps extends InertiaPageProps, AppPageProps {}
}

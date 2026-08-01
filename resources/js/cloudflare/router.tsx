import { createBrowserRouter } from 'react-router';

import { HomePage } from './pages/HomePage';

export const router = createBrowserRouter([
    {
        path: '/',
        Component: HomePage,
    },
]);

import '@mantine/charts/styles.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';

import '@gfazioli/mantine-split-pane/styles.css';

import '../css/app.css';
import './bootstrap';
import { createInertiaApp } from '@inertiajs/react';
import { createTheme, MantineProvider, rem } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { createRoot } from 'react-dom/client';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

const theme = createTheme({
    headings: {
        sizes: {
            h1: { fontSize: rem(32) },
        },
    },
});

createInertiaApp({
    title: (title) => `${title} - ${appName}`,
    resolve: (name) =>
        resolvePageComponent(
            `./Pages/${name}.tsx`,
            import.meta.glob('./Pages/**/*.tsx'),
        ),
    setup({ el, App, props }) {
        const root = createRoot(el);

        root.render(
            <MantineProvider theme={theme}>
                <ModalsProvider>
                    <Notifications />
                    <App {...props} />
                </ModalsProvider>
            </MantineProvider>,
        );
    },
    progress: {
        color: '#4B5563',
    },
});

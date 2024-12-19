import '@mantine/core/styles.css';

import '@gfazioli/mantine-split-pane/styles.css';

import '../css/app.css';
import './bootstrap';
import { createInertiaApp } from '@inertiajs/react';
import { MantineProvider } from '@mantine/core';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { createRoot } from 'react-dom/client';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

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
            <MantineProvider>
                <App {...props} />
            </MantineProvider>,
        );
    },
    progress: {
        color: '#4B5563',
    },
});

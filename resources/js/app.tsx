import '@mantine/charts/styles.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';

import '@gfazioli/mantine-split-pane/styles.css';

import '../css/app.css';
import './bootstrap';

import { datadogRum } from '@datadog/browser-rum';

// Initialize Datadog RUM
if (
    import.meta.env.VITE_DATADOG_APPLICATION_ID &&
    import.meta.env.VITE_DATADOG_CLIENT_TOKEN
) {
    datadogRum.init({
        applicationId: import.meta.env.VITE_DATADOG_APPLICATION_ID,
        clientToken: import.meta.env.VITE_DATADOG_CLIENT_TOKEN,
        site: import.meta.env.VITE_DATADOG_SITE || 'datadoghq.com',
        service: import.meta.env.VITE_DATADOG_SERVICE || 'larafeed',
        env: import.meta.env.VITE_DATADOG_ENV || 'production',
        version: import.meta.env.VITE_APP_VERSION || '1.0.0',
        sessionSampleRate:
            Number(import.meta.env.VITE_DATADOG_SESSION_SAMPLE_RATE) || 100,
        sessionReplaySampleRate:
            Number(import.meta.env.VITE_DATADOG_SESSION_REPLAY_SAMPLE_RATE) ||
            100,
        trackUserInteractions: true,
        trackResources: true,
        trackLongTasks: true,
        defaultPrivacyLevel:
            (import.meta.env.VITE_DATADOG_PRIVACY_LEVEL as
                | 'mask'
                | 'mask-user-input'
                | 'allow') || 'mask-user-input',
    });
}

import { createInertiaApp } from '@inertiajs/react';
import { createTheme, MantineProvider, rem } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { createRoot } from 'react-dom/client';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

const theme = createTheme({
    colors: {
        // Warm dark mode colors with neutral/slightly warm undertones
        dark: [
            '#C9C5C1', // 0 - primary text (warm gray)
            '#ADA9A5', // 1 - secondary text
            '#918D89', // 2 - dimmed text/icons
            '#666360', // 3 - borders
            '#403D3A', // 4 - hover states
            '#33302D', // 5 - active backgrounds
            '#2A2725', // 6 - card backgrounds
            '#1F1D1B', // 7 - main background
            '#171514', // 8 - deeper background
            '#110F0E', // 9 - darkest
        ],
    },
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

import '@mantine/charts/styles.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';

import '@gfazioli/mantine-split-pane/styles.css';

import '../css/app.css';
import './bootstrap';

import { datadogRum } from '@datadog/browser-rum';
import { createInertiaApp } from '@inertiajs/react';
import { createTheme, MantineProvider, rem } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { createRoot } from 'react-dom/client';
import type { PageProps } from '@/types';

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
        const { datadogRum: ddConfig } = props.initialPage
            .props as unknown as PageProps;

        // Initialize Datadog RUM if configured
        if (ddConfig.applicationId && ddConfig.clientToken) {
            datadogRum.init({
                applicationId: ddConfig.applicationId,
                clientToken: ddConfig.clientToken,
                site: ddConfig.site,
                service: ddConfig.service,
                env: ddConfig.env,
                sessionSampleRate: ddConfig.sessionSampleRate,
                sessionReplaySampleRate: ddConfig.sessionReplaySampleRate,
                trackUserInteractions: true,
                trackResources: true,
                trackLongTasks: true,
                defaultPrivacyLevel: ddConfig.privacyLevel,
            });
        }

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

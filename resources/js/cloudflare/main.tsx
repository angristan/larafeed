import '@mantine/charts/styles.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';

import '@gfazioli/mantine-split-pane/styles.css';

import '../../css/app.css';

import { localStorageColorSchemeManager, MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { queryClient } from './queryClient';
import { router } from './router';
import { theme } from './theme';

const rootElement = document.getElementById('root');

if (rootElement === null) {
    throw new Error('Root element not found.');
}

const colorSchemeManager = localStorageColorSchemeManager({
    key: 'larafeed-color-scheme',
});

createRoot(rootElement).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <MantineProvider
                colorSchemeManager={colorSchemeManager}
                defaultColorScheme="light"
                theme={theme}
            >
                <ModalsProvider>
                    <Notifications pauseResetOnHover="notification" />
                    <RouterProvider router={router} />
                </ModalsProvider>
            </MantineProvider>
        </QueryClientProvider>
    </StrictMode>,
);

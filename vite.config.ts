import { fileURLToPath, URL } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { mcpAppView } from './scripts/mcp-app-view-plugin';

export default defineConfig({
    plugins: [react(), cloudflare(), mcpAppView()],
    envDir: false,
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src/client', import.meta.url)),
            '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
            '@tabler/icons-react':
                '@tabler/icons-react/dist/esm/icons/index.mjs',
        },
    },
});

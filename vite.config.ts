import { fileURLToPath, URL } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react(), cloudflare()],
    envDir: 'cloudflare-env',
    publicDir: 'cloudflare-public',
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./resources/js', import.meta.url)),
            '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
            '@tabler/icons-react':
                '@tabler/icons-react/dist/esm/icons/index.mjs',
        },
    },
});

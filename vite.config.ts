import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        react(),
    ],
    build: {
        outDir: 'public/build',
        emptyOutDir: true,
        manifest: true,
        rollupOptions: {
            input: 'resources/js/app.tsx',
        },
    },
    resolve: {
        alias: {
            '@tabler/icons-react':
                '@tabler/icons-react/dist/esm/icons/index.mjs',
            '@': '/resources/js',
        },
    },
    server: {
        origin: 'http://localhost:5173',
        cors: true,
    },
});

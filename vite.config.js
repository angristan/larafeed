import react from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import { defineConfig } from 'vite';

const ReactCompilerConfig = {
    target: '18', // '17' | '18' | '19'
};

export default defineConfig({
    plugins: [
        laravel({
            input: 'resources/js/app.tsx',
            refresh: true,
        }),
        react({
            babel: {
                plugins: [['babel-plugin-react-compiler', ReactCompilerConfig]],
            },
        }),
    ],
    resolve: {
        alias: {
            // /esm/icons/index.mjs only exports the icons statically, so no scoeparate chunks are created
            '@tabler/icons-react':
                '@tabler/icons-react/dist/esm/icons/index.mjs',
        },
    },
});

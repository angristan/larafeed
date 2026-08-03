import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const previewSecrets = resolve(repositoryRoot, 'dist/larafeed/.dev.vars');
const vite = resolve(repositoryRoot, 'node_modules/.bin/vite');

let exitCode = 1;
try {
    const child = Bun.spawn([vite, 'build'], {
        cwd: repositoryRoot,
        env: process.env,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
    });
    exitCode = await child.exited;
} finally {
    // The Cloudflare Vite plugin emits local bindings for `vite preview`.
    // Deployment artifacts must never retain values from `.dev.vars`.
    await rm(previewSecrets, { force: true });
}

process.exit(exitCode);

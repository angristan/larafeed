import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const distRoot = resolve(repositoryRoot, 'dist');
const vite = resolve(repositoryRoot, 'node_modules/.bin/vite');

const removePreviewSecrets = async (): Promise<void> => {
    const entries = await readdir(distRoot, { withFileTypes: true }).catch(
        () => [],
    );
    await Promise.all(
        entries
            .filter((entry) => entry.isDirectory())
            .map((entry) =>
                rm(resolve(distRoot, entry.name, '.dev.vars'), { force: true }),
            ),
    );
};

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
    // Output directories vary by Worker name, so scrub every build artifact.
    await removePreviewSecrets();
}

process.exit(exitCode);

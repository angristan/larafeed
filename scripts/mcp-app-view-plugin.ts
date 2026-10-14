import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build, type Plugin } from 'vite';

/*
 * Bundles the MCP App view (src/mcp-app) into one self-contained HTML string
 * and exposes it to the Worker as `virtual:larafeed-mcp-view`.
 *
 * MCP hosts load the view from a `ui://` resource into a sandboxed iframe
 * with no network access, so the script and styles must be inline. Building
 * here keeps the bundle out of the repository and in step with the source.
 */

const VIRTUAL_ID = 'virtual:larafeed-mcp-view';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const entry = fileURLToPath(new URL('../src/mcp-app/view.ts', import.meta.url));
const template = fileURLToPath(
    new URL('../src/mcp-app/view.html', import.meta.url),
);

type BuildResult = Awaited<ReturnType<typeof build>>;

const chunkCode = (result: BuildResult): string => {
    const outputs = Array.isArray(result) ? result : [result];
    for (const output of outputs) {
        if (!('output' in output)) continue;
        for (const item of output.output) {
            if (item.type === 'chunk' && item.isEntry) return item.code;
        }
    }
    throw new Error('MCP App view build produced no entry chunk');
};

export const mcpAppView = (): Plugin => ({
    name: 'larafeed-mcp-app-view',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    async load(id) {
        if (id !== RESOLVED_ID) return undefined;
        this.addWatchFile(entry);
        this.addWatchFile(template);
        const result = await build({
            configFile: false,
            logLevel: 'warn',
            build: {
                write: false,
                minify: true,
                target: 'es2022',
                lib: { entry, formats: ['es'], fileName: 'view' },
            },
        });
        // `</script` inside the bundle would end the inline script early.
        const script = chunkCode(result).replaceAll('</script', '<\\/script');
        const html = (await readFile(template, 'utf8')).replace(
            '<!-- SCRIPT -->',
            () => `<script type="module">${script}</script>`,
        );
        return `export default ${JSON.stringify(html)};`;
    },
});

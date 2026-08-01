import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    renderMarkdownReport,
    type ValidationReport,
} from '../../worker/benchmarks/validation';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const outputFlag = Bun.argv.indexOf('--output-dir');
const profileFlag = Bun.argv.indexOf('--profile');
const profile = profileFlag === -1 ? 'ci' : Bun.argv[profileFlag + 1];
if (profile !== 'ci' && profile !== 'large') {
    throw new Error('--profile must be ci or large');
}
const outputDirectory = resolve(
    outputFlag === -1
        ? resolve(scriptDirectory, 'output')
        : (Bun.argv[outputFlag + 1] ??
              (() => {
                  throw new Error('--output-dir requires a value');
              })()),
);
const vitest = resolve(repositoryRoot, 'node_modules/.bin/vitest');
const child = Bun.spawn(
    [
        vitest,
        'run',
        '--config',
        'vitest.worker.config.ts',
        'worker/benchmarks/representative.worker.test.ts',
    ],
    {
        cwd: repositoryRoot,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...process.env,
            LARAFEED_D1_FIXTURE_PROFILE: profile,
        },
    },
);
const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
]);
process.stdout.write(stdout);
process.stderr.write(stderr);
if (exitCode !== 0) process.exit(exitCode);

const marker = 'LARAFEED_D1_VALIDATION_REPORT=';
const markerStart = stdout.indexOf(marker);
if (markerStart === -1) throw new Error('Workerd validation report was not emitted');
const reportStart = markerStart + marker.length;
const reportEnd = stdout.indexOf('\n', reportStart);
const report = JSON.parse(
    stdout.slice(reportStart, reportEnd === -1 ? undefined : reportEnd),
) as ValidationReport;
if (report.schemaVersion !== 1) {
    throw new Error(`unsupported report schema: ${String(report.schemaVersion)}`);
}
if (report.fixture.profile !== profile) {
    throw new Error(
        `validation used ${report.fixture.profile}, requested ${profile}`,
    );
}

await mkdir(outputDirectory, { recursive: true });
const jsonPath = resolve(outputDirectory, 'report.json');
const markdownPath = resolve(outputDirectory, 'report.md');
await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(markdownPath, renderMarkdownReport(report)),
]);
console.log(JSON.stringify({ jsonPath, markdownPath, passed: report.passed }));
if (!report.passed) process.exit(1);

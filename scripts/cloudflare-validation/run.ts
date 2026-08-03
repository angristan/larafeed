import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database } from 'bun:sqlite';

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
const validateRefreshAdmissionMigration = async (): Promise<void> => {
    const database = new Database(':memory:', { strict: true });
    try {
        database.exec('PRAGMA foreign_keys = ON');
        const migrationsDirectory = resolve(repositoryRoot, 'migrations');
        const migrations = (await readdir(migrationsDirectory))
            .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
            .toSorted();
        for (const migration of migrations.filter(
            (name) => name < '0013_terminal_job_retention.sql',
        )) {
            database.exec(
                await readFile(resolve(migrationsDirectory, migration), 'utf8'),
            );
        }

        database.exec(`
            INSERT INTO jobs (
                id, operation_id, kind, state, payload_json, max_attempts,
                available_at, created_at, updated_at
            ) VALUES
                (101, 'refresh:pending', 'feed_refresh', 'pending',
                 '{"feedId":1,"trigger":"scheduled"}', 8, 100, 100, 100),
                (102, 'refresh:queued', 'feed_refresh', 'queued',
                 '{"feedId":1,"trigger":"scheduled"}', 8, 90, 90, 90);
            INSERT INTO outbox_messages (
                id, job_id, topic, payload_json, state, available_at,
                created_at, updated_at
            ) VALUES (
                201, 101, 'feed_refresh',
                '{"operationId":"refresh:pending"}', 'pending', 100, 100, 100
            );
        `);
        for (const migration of migrations.filter(
            (name) => name >= '0013_terminal_job_retention.sql',
        )) {
            database.exec(
                await readFile(resolve(migrationsDirectory, migration), 'utf8'),
            );
        }

        const active = database
            .query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM jobs
                WHERE kind = 'feed_refresh'
                  AND state IN ('pending', 'queued', 'running', 'failed')
                  AND CAST(json_extract(payload_json, '$.feedId') AS INTEGER) = 1`)
            .get();
        const canceled = database
            .query<{ state: string }, []>('SELECT state FROM jobs WHERE id = 101')
            .get();
        const outbox = database
            .query<{ state: string }, []>(
                'SELECT state FROM outbox_messages WHERE job_id = 101',
            )
            .get();
        if (
            active?.count !== 1 ||
            canceled?.state !== 'canceled' ||
            outbox?.state !== 'dead_lettered'
        ) {
            throw new Error('active refresh migration did not reconcile duplicates');
        }
        let duplicateRejected = false;
        try {
            database.exec(`INSERT INTO jobs (
                    id, operation_id, kind, state, payload_json, max_attempts,
                    available_at, created_at, updated_at
                ) VALUES (
                    103, 'refresh:third', 'feed_refresh', 'pending',
                    '{"feedId":1,"trigger":"manual"}', 8, 110, 110, 110
                )`);
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes('UNIQUE constraint failed')
            ) {
                duplicateRejected = true;
            } else {
                throw error;
            }
        }
        if (!duplicateRejected)
            throw new Error('active refresh uniqueness fence accepted a duplicate');
        const foreignKeys = database.query('PRAGMA foreign_key_check').all();
        if (foreignKeys.length !== 0)
            throw new Error('migration upgrade introduced foreign-key violations');
        console.log('Active refresh migration upgrade: passed');
    } finally {
        database.close();
    }
};

await validateRefreshAdmissionMigration();

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

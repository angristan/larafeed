import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { readonly scripts: Readonly<Record<string, string>> };

const scripts = packageJson.scripts;

describe('deployment scripts', () => {
    it.each([
        ['deploy', 'build', 'd1:migrate'],
        ['deploy:production', 'build:production', 'd1:migrate:production'],
    ])('%s checks one build before migration and deploys it without rebuilding', (scriptName, buildScript, migrationScript) => {
        expect(scripts[scriptName]?.split(' && ')).toEqual([
            `npm run ${buildScript}`,
            'npm run deploy:artifact:check',
            `npm run ${migrationScript}`,
            'npm run deploy:artifact',
        ]);
    });

    it('runs the canonical release gate before production deployment', () => {
        expect(scripts['release:production']).toBe(
            'npm run validate:release && npm run deploy:production',
        );
        expect(scripts['validate:release']).toBe(
            'npm run validate && npm run d1:validate:large',
        );
    });
});

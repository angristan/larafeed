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
    ])(
        '%s checks one build before migration and deploys it without rebuilding',
        (scriptName, buildScript, migrationScript) => {
            expect(scripts[scriptName]?.split(' && ')).toEqual([
                `bun run ${buildScript}`,
                'bun run deploy:artifact:check',
                `bun run ${migrationScript}`,
                'bun run deploy:artifact',
            ]);
        },
    );

    it('runs the canonical release gate before production deployment', () => {
        expect(scripts['release:production']).toBe(
            'bun run validate:release && bun run deploy:production',
        );
        expect(scripts['validate:release']).toBe(
            'bun run validate && bun run d1:validate:large',
        );
    });
});

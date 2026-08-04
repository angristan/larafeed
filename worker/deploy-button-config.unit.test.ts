import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface DeploymentEnvironment {
    readonly name?: string;
    readonly workers_dev?: boolean;
    readonly preview_urls?: boolean;
    readonly routes?: readonly { readonly pattern: string }[];
}

interface WranglerConfig extends DeploymentEnvironment {
    readonly env?: {
        readonly production?: DeploymentEnvironment;
        readonly test?: DeploymentEnvironment;
    };
}

interface PackageConfig {
    readonly scripts?: Readonly<Record<string, string>>;
    readonly cloudflare?: {
        readonly bindings?: Readonly<
            Record<string, { readonly description?: string }>
        >;
    };
}

const wrangler = JSON.parse(
    readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
) as WranglerConfig;
const packageConfig = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageConfig;
const secretTemplate = readFileSync(
    new URL('../.dev.vars.example', import.meta.url),
    'utf8',
);

describe('Deploy-to-Cloudflare configuration', () => {
    it('keeps the portable endpoint separate from owner environments', () => {
        expect(wrangler).toMatchObject({
            name: 'larafeed-template',
            workers_dev: true,
            preview_urls: true,
        });
        expect(wrangler.routes).toBeUndefined();
        expect(wrangler.env?.production).toMatchObject({
            name: 'larafeed',
            workers_dev: false,
            preview_urls: false,
            routes: [{ pattern: 'larafeed.stanislas.cloud' }],
        });
        expect(wrangler.env?.test).toMatchObject({
            name: 'larafeed-test',
            workers_dev: false,
            preview_urls: false,
            routes: [{ pattern: 'larafeedcf.stanislas.cloud' }],
        });
    });

    it('applies D1 migrations before the button deployment', () => {
        expect(packageConfig.scripts?.deploy).toBe(
            'npm run build && npm run d1:migrate && CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false wrangler deploy',
        );
        expect(packageConfig.scripts?.['d1:migrate']).toContain(
            'd1 migrations apply DB --remote',
        );
    });

    it('requests only the required operator secret', () => {
        const configuredKeys = secretTemplate
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith('#'))
            .map((line) => line.split('=', 1)[0]);

        expect(configuredKeys).toEqual(['AUTH_OPERATOR_SECRET']);
    });

    it('describes every installer value that must stay synchronized', () => {
        const descriptions = packageConfig.cloudflare?.bindings ?? {};
        expect(descriptions.AUTH_RP_ID).toBeUndefined();
        expect(JSON.stringify(wrangler)).not.toContain('AUTH_RP_ID');

        for (const binding of [
            'AUTH_OPERATOR_SECRET',
            'AUTH_ORIGIN',
            'FEED_REFRESH_QUEUE_NAME',
            'OPML_IMPORT_QUEUE_NAME',
            'FAVICON_REFRESH_QUEUE_NAME',
        ]) {
            expect(descriptions[binding]?.description, binding).toBeTruthy();
        }
    });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ObservabilityConfig {
    readonly enabled?: boolean;
    readonly logs?: {
        readonly enabled?: boolean;
        readonly head_sampling_rate?: number;
        readonly invocation_logs?: boolean;
        readonly persist?: boolean;
    };
}

interface DeploymentEnvironment {
    readonly name?: string;
    readonly workers_dev?: boolean;
    readonly preview_urls?: boolean;
    readonly placement?: { readonly mode?: string };
    readonly secrets?: { readonly required?: readonly string[] };
    readonly vars?: Readonly<Record<string, string>>;
    readonly routes?: readonly { readonly pattern: string }[];
    readonly observability?: ObservabilityConfig;
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
    readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'),
) as WranglerConfig;
const packageConfig = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as PackageConfig;
const secretTemplate = readFileSync(
    new URL('../../.dev.vars.example', import.meta.url),
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
        expect(wrangler.placement).toEqual({ mode: 'smart' });
        expect(wrangler.env?.production).toMatchObject({
            name: 'larafeed',
            workers_dev: false,
            preview_urls: false,
            routes: [{ pattern: 'larafeed.stanislas.cloud' }],
        });
        expect(wrangler.env?.test).toBeUndefined();
        expect(wrangler.env?.production?.placement).toEqual({ mode: 'smart' });
        expect(wrangler.env?.production?.vars).toMatchObject({
            REFRESH_SCHEDULER_ENABLED: 'true',
            REFRESH_DISPATCH_ENABLED: 'true',
            OPML_IMPORT_ENABLED: 'true',
            FAVICON_REFRESH_ENABLED: 'true',
            IMAGES_ENABLED: 'true',
            AI_SUMMARY_ENABLED: 'true',
        });
    });

    it('persists complete production logs and traces', () => {
        expect(wrangler.env?.production?.observability).toMatchObject({
            enabled: true,
            logs: {
                enabled: true,
                head_sampling_rate: 1,
                invocation_logs: true,
                persist: true,
            },
            traces: {
                enabled: true,
                head_sampling_rate: 1,
                persist: true,
            },
        });
    });

    it('applies D1 migrations before the button deployment', () => {
        expect(packageConfig.scripts?.deploy).toBe(
            'bun run build && bun run deploy:artifact:check && bun run d1:migrate && bun run deploy:artifact',
        );
        expect(packageConfig.scripts?.['d1:migrate']).toContain(
            'd1 migrations apply DB --remote',
        );
    });

    it('requires only the operator secret in every environment', () => {
        const configuredKeys = secretTemplate
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith('#'))
            .map((line) => line.split('=', 1)[0]);

        expect(configuredKeys).toEqual(['AUTH_OPERATOR_SECRET']);
        expect(wrangler.secrets?.required).toEqual(['AUTH_OPERATOR_SECRET']);
        expect(wrangler.env?.production?.secrets?.required).toEqual([
            'AUTH_OPERATOR_SECRET',
        ]);
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

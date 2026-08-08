import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { parseSummaryConfig, SUMMARY_PROMPT_VERSION } from './config';
import { SummaryConfigError } from './errors';

const valid = {
    AI_SUMMARY_ENABLED: 'true',
    AI_GATEWAY_NAME: 'larafeed-ai',
    AI_MODEL: '@cf/mistralai/mistral-small-3.1-24b-instruct',
} as unknown as Env;

describe('summary config', () => {
    it('accepts disabled summaries without provider configuration', async () => {
        await expect(
            Effect.runPromise(
                parseSummaryConfig({
                    AI_SUMMARY_ENABLED: 'false',
                } as unknown as Env),
            ),
        ).resolves.toEqual({
            enabled: false,
            promptVersion: SUMMARY_PROMPT_VERSION,
        });
    });

    it('accepts only exact trusted Workers AI configuration when enabled', async () => {
        await expect(
            Effect.runPromise(parseSummaryConfig(valid)),
        ).resolves.toEqual({
            enabled: true,
            gatewayName: 'larafeed-ai',
            model: '@cf/mistralai/mistral-small-3.1-24b-instruct',
            promptVersion: SUMMARY_PROMPT_VERSION,
        });

        for (const candidate of [
            { ...valid, AI_SUMMARY_ENABLED: 'TRUE' },
            { ...valid, AI_GATEWAY_NAME: 'gateway/name' },
            { ...valid, AI_MODEL: 'gemini-2.5-flash' },
            { ...valid, AI_MODEL: '@cf/meta' },
            { ...valid, AI_MODEL: '@cf/meta/llama with spaces' },
            { ...valid, AI_MODEL: '@cf/meta/llama/extra' },
            { ...valid, AI_GATEWAY_NAME: undefined },
            { ...valid, AI_MODEL: undefined },
        ]) {
            const error = await Effect.runPromise(
                parseSummaryConfig(candidate as unknown as Env),
            ).catch((cause: unknown) => cause);
            expect(error).toBeInstanceOf(SummaryConfigError);
        }
    });
});

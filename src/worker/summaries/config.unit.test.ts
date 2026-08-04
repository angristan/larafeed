import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { parseSummaryConfig, SUMMARY_PROMPT_VERSION } from './config';
import { SummaryConfigError } from './errors';

const valid = {
    AI_SUMMARY_ENABLED: 'true',
    AI_GATEWAY_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    AI_GATEWAY_NAME: 'larafeed-ai',
    AI_MODEL: 'gemini-2.5-flash',
    GEMINI_API_KEY: 'secret-key',
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

    it('accepts only exact trusted Gateway configuration when enabled', async () => {
        await expect(
            Effect.runPromise(parseSummaryConfig(valid)),
        ).resolves.toEqual({
            enabled: true,
            accountId: '0123456789abcdef0123456789abcdef',
            gatewayName: 'larafeed-ai',
            model: 'gemini-2.5-flash',
            promptVersion: SUMMARY_PROMPT_VERSION,
            apiKey: 'secret-key',
        });

        for (const candidate of [
            { ...valid, AI_SUMMARY_ENABLED: 'TRUE' },
            { ...valid, AI_GATEWAY_ACCOUNT_ID: '../account' },
            { ...valid, AI_GATEWAY_NAME: 'gateway/name' },
            { ...valid, AI_MODEL: 'models/gemini' },
            { ...valid, GEMINI_API_KEY: ' secret-key' },
            { ...valid, AI_GATEWAY_ACCOUNT_ID: undefined },
            { ...valid, AI_GATEWAY_NAME: undefined },
            { ...valid, AI_MODEL: undefined },
            { ...valid, GEMINI_API_KEY: undefined },
        ]) {
            const error = await Effect.runPromise(
                parseSummaryConfig(candidate as unknown as Env),
            ).catch((cause: unknown) => cause);
            expect(error).toBeInstanceOf(SummaryConfigError);
        }
    });
});

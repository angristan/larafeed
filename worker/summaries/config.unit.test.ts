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
    it('accepts only exact trusted Gateway configuration', async () => {
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

        for (const override of [
            { AI_SUMMARY_ENABLED: 'TRUE' },
            { AI_GATEWAY_ACCOUNT_ID: '../account' },
            { AI_GATEWAY_NAME: 'gateway/name' },
            { AI_MODEL: 'models/gemini' },
            { GEMINI_API_KEY: ' secret-key' },
        ]) {
            const error = await Effect.runPromise(
                parseSummaryConfig({ ...valid, ...override }),
            ).catch((cause: unknown) => cause);
            expect(error).toBeInstanceOf(SummaryConfigError);
        }
    });
});

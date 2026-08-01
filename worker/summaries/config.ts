import { Effect } from 'effect';

import { SummaryConfigError } from './errors';

export const SUMMARY_PROMPT_VERSION = 'entry-summary-v1';

export interface SummaryConfig {
    readonly enabled: boolean;
    readonly accountId: string;
    readonly gatewayName: string;
    readonly model: string;
    readonly promptVersion: typeof SUMMARY_PROMPT_VERSION;
    readonly apiKey: string;
}

const envValue = (env: Env, name: string): unknown => Reflect.get(env, name);
const exactString = (
    env: Env,
    name: string,
    pattern: RegExp,
): Effect.Effect<string, SummaryConfigError> => {
    const value = envValue(env, name);
    return typeof value === 'string' && pattern.test(value)
        ? Effect.succeed(value)
        : Effect.fail(new SummaryConfigError());
};

export const parseSummaryConfig = (
    env: Env,
): Effect.Effect<SummaryConfig, SummaryConfigError> =>
    Effect.gen(function* () {
        const enabledValue = envValue(env, 'AI_SUMMARY_ENABLED');
        if (enabledValue !== 'true' && enabledValue !== 'false') {
            return yield* Effect.fail(new SummaryConfigError());
        }

        const accountId = yield* exactString(
            env,
            'AI_GATEWAY_ACCOUNT_ID',
            /^[a-fA-F0-9]{32}$/u,
        );
        const gatewayName = yield* exactString(
            env,
            'AI_GATEWAY_NAME',
            /^[A-Za-z0-9_-]{1,64}$/u,
        );
        const model = yield* exactString(
            env,
            'AI_MODEL',
            /^[A-Za-z0-9._-]{1,100}$/u,
        );
        const apiKeyValue = envValue(env, 'GEMINI_API_KEY');
        const apiKey =
            typeof apiKeyValue === 'string' &&
            apiKeyValue.length >= 1 &&
            apiKeyValue.length <= 512 &&
            apiKeyValue.trim() === apiKeyValue
                ? apiKeyValue
                : yield* Effect.fail(new SummaryConfigError());

        return {
            enabled: enabledValue === 'true',
            accountId,
            gatewayName,
            model,
            promptVersion: SUMMARY_PROMPT_VERSION,
            apiKey,
        };
    });

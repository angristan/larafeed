import { Effect } from 'effect';

import { SummaryConfigError } from './errors';

export const SUMMARY_PROMPT_VERSION = 'entry-summary-v1';

export interface DisabledSummaryConfig {
    readonly enabled: false;
    readonly promptVersion: typeof SUMMARY_PROMPT_VERSION;
}

export interface EnabledSummaryConfig {
    readonly enabled: true;
    readonly gatewayName: string;
    readonly model: string;
    readonly promptVersion: typeof SUMMARY_PROMPT_VERSION;
}

export type SummaryConfig = DisabledSummaryConfig | EnabledSummaryConfig;

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
        if (enabledValue === 'false') {
            return {
                enabled: false,
                promptVersion: SUMMARY_PROMPT_VERSION,
            };
        }

        const gatewayName = yield* exactString(
            env,
            'AI_GATEWAY_NAME',
            /^[A-Za-z0-9_-]{1,64}$/u,
        );
        const model = yield* exactString(
            env,
            'AI_MODEL',
            /^@[a-z0-9-]{1,20}\/[A-Za-z0-9._-]{1,40}\/[A-Za-z0-9._-]{1,60}$/u,
        );

        return {
            enabled: true,
            gatewayName,
            model,
            promptVersion: SUMMARY_PROMPT_VERSION,
        };
    });

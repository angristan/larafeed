import { Effect } from 'effect';

import { FullContentConfigError } from './errors';

export interface FullContentConfig {
    readonly enabled: boolean;
}

export const parseFullContentConfig = (
    env: Env,
): Effect.Effect<FullContentConfig, FullContentConfigError> => {
    const value = Reflect.get(env, 'FULL_CONTENT_ENABLED');
    if (value !== 'true' && value !== 'false') {
        return Effect.fail(new FullContentConfigError());
    }
    return Effect.succeed({ enabled: value === 'true' });
};

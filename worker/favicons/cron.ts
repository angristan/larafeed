import { Effect } from 'effect';

import { makeD1 } from '../infrastructure/d1';
import {
    faviconDarknessEnabled,
    makeFaviconDarknessAnalyzer,
} from './darkness';
import { makeFaviconRepository } from './repository';
import { makeFaviconService } from './service';

export const faviconRefreshEnabled = (
    env: Pick<Env, 'FAVICON_REFRESH_ENABLED'>,
): boolean => env.FAVICON_REFRESH_ENABLED === 'true';

export const handleFaviconCron = async (env: Env): Promise<void> => {
    if (!faviconRefreshEnabled(env)) return;

    const service = makeFaviconService({
        repository: makeFaviconRepository(makeD1(env.DB)),
        analyzeDarkness: faviconDarknessEnabled(env)
            ? makeFaviconDarknessAnalyzer(env.IMAGES)
            : undefined,
    });
    await Effect.runPromise(
        service.refreshStale(1).pipe(
            // Favicon maintenance is best-effort and must not block feed/OPML Cron.
            Effect.catchCause(() => Effect.succeed([])),
        ),
    );
};

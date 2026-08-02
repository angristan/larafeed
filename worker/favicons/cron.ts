import { Effect } from 'effect';

import { makeD1 } from '../infrastructure/d1';
import { makeFaviconRepository } from './repository';
import { makeFaviconService } from './service';

export const handleFaviconCron = async (env: Env): Promise<void> => {
    const service = makeFaviconService({
        repository: makeFaviconRepository(makeD1(env.DB)),
    });
    await Effect.runPromise(
        service.refreshStale(1).pipe(
            // Favicon maintenance is best-effort and must not block feed/OPML Cron.
            Effect.catchCause(() => Effect.succeed([])),
        ),
    );
};

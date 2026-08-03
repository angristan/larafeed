import { Effect } from 'effect';

import { makeD1 } from '../infrastructure/d1';
import { makeD1FaviconAssetRepository, makeFaviconAssetStore } from './assets';
import { faviconDarknessEnabled } from './darkness';
import { makeFaviconRepository } from './repository';
import { makeFaviconService } from './service';

export const FAVICON_CRON_LIMIT = 5;
export const FAVICON_ORPHAN_CLEANUP_LIMIT = 100;
export const FAVICON_ORPHAN_RETENTION_MS = 30 * 24 * 60 * 60_000;

export const faviconRefreshEnabled = (
    env: Pick<Env, 'FAVICON_REFRESH_ENABLED'>,
): boolean => env.FAVICON_REFRESH_ENABLED === 'true';

export const handleFaviconCron = async (env: Env): Promise<void> => {
    if (!faviconRefreshEnabled(env)) return;

    const d1 = makeD1(env.DB);
    const assets = makeD1FaviconAssetRepository(d1);
    const service = makeFaviconService({
        repository: makeFaviconRepository(d1),
        assetStore: faviconDarknessEnabled(env)
            ? makeFaviconAssetStore({
                  repository: assets,
                  images: env.IMAGES,
              })
            : undefined,
    });
    await Effect.runPromise(
        service.refreshStale(FAVICON_CRON_LIMIT).pipe(
            // Favicon maintenance is best-effort and must not block feed/OPML Cron.
            Effect.catchCause(() => Effect.succeed([])),
        ),
    );
    await assets
        .deleteOrphans(
            Date.now() - FAVICON_ORPHAN_RETENTION_MS,
            FAVICON_ORPHAN_CLEANUP_LIMIT,
        )
        .catch(() => undefined);
};

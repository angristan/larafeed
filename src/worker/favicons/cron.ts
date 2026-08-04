import { makeFaviconRuntime } from './runtime';

export const FAVICON_CRON_LIMIT = 20;
export const FAVICON_ORPHAN_CLEANUP_LIMIT = 100;
export const FAVICON_ORPHAN_RETENTION_MS = 30 * 24 * 60 * 60_000;

export const faviconRefreshEnabled = (
    env: Pick<Env, 'FAVICON_REFRESH_ENABLED'>,
): boolean => env.FAVICON_REFRESH_ENABLED === 'true';

export const handleFaviconCron = async (env: Env): Promise<void> => {
    if (!faviconRefreshEnabled(env)) return;

    const { assets, orchestrator } = makeFaviconRuntime(env);
    await orchestrator.runCron({
        reserveLimit: FAVICON_CRON_LIMIT,
        dispatchLimit: FAVICON_CRON_LIMIT * 2,
        recoveryLimit: FAVICON_CRON_LIMIT,
    });
    await assets
        .deleteOrphans(
            Date.now() - FAVICON_ORPHAN_RETENTION_MS,
            FAVICON_ORPHAN_CLEANUP_LIMIT,
        )
        .catch(() => undefined);
};

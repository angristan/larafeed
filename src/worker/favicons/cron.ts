import {
    recordCronResult,
    recordHandledFailure,
    safeErrorClass,
    spanNames,
} from '../observability';
import { makeFaviconRuntime } from './runtime';

export const FAVICON_CRON_LIMIT = 20;
export const FAVICON_ORPHAN_CLEANUP_LIMIT = 100;
export const FAVICON_ORPHAN_RETENTION_MS = 30 * 24 * 60 * 60_000;

export const faviconRefreshEnabled = (
    env: Pick<Env, 'FAVICON_REFRESH_ENABLED'>,
): boolean => env.FAVICON_REFRESH_ENABLED === 'true';

export const handleFaviconCron = async (env: Env): Promise<void> => {
    if (!faviconRefreshEnabled(env)) {
        recordCronResult('favicon', { 'app.cron.enabled': false });
        return;
    }

    const { assets, orchestrator } = makeFaviconRuntime(env);
    const result = await orchestrator.runCron({
        reserveLimit: FAVICON_CRON_LIMIT,
        dispatchLimit: FAVICON_CRON_LIMIT * 2,
        recoveryLimit: FAVICON_CRON_LIMIT,
    });
    let cleanupFailed = false;
    let deletedOrphans = 0;
    try {
        deletedOrphans = await assets.deleteOrphans(
            Date.now() - FAVICON_ORPHAN_RETENTION_MS,
            FAVICON_ORPHAN_CLEANUP_LIMIT,
        );
    } catch (cause) {
        cleanupFailed = true;
        recordHandledFailure(
            spanNames.jobFailure,
            {
                'app.subsystem': 'favicon',
                'app.failure.stage': 'asset_cleanup',
            },
            {
                errorClass: safeErrorClass(cause),
                stage: 'asset_cleanup',
                retryable: true,
            },
        );
    }
    recordCronResult(
        'favicon',
        {
            'app.cron.enabled': true,
            'app.cron.recovered_jobs': result.recoveredJobs,
            'app.cron.redriven_jobs': result.redrivenJobs,
            'app.cron.dead_lettered_jobs': result.deadLetteredJobs,
            'app.cron.reserved_jobs': result.reservedJobs,
            'app.cron.dispatched_messages': result.dispatched.sent,
            'app.cron.released_messages': result.dispatched.released,
            'app.cron.ambiguous_messages': result.dispatched.ambiguous,
            'app.cron.deleted_orphans': deletedOrphans,
        },
        cleanupFailed ||
            result.deadLetteredJobs > 0 ||
            result.dispatched.released > 0 ||
            result.dispatched.ambiguous > 0,
    );
};

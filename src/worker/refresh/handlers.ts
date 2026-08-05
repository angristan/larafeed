import { recordCronResult, recordQueueDecision } from '../observability';
import { singleQueueMessage } from '../queue';
import { makeRefreshRuntime } from './runtime';

const MAX_QUEUE_DELAY_SECONDS = 12 * 60 * 60;

const applyDecision = (
    message: Message<unknown>,
    decision:
        | { readonly action: 'ack' | 'dead'; readonly reason: string }
        | {
              readonly action: 'retry';
              readonly reason: string;
              readonly retryDelaySeconds: number;
          },
): void => {
    if (decision.action === 'retry') {
        message.retry({
            delaySeconds: Math.max(
                1,
                Math.min(
                    MAX_QUEUE_DELAY_SECONDS,
                    Math.trunc(decision.retryDelaySeconds),
                ),
            ),
        });
        return;
    }

    message.ack();
};

export const handleRefreshQueue = async (
    batch: MessageBatch<unknown>,
    env: Env,
): Promise<void> => {
    const message = singleQueueMessage(batch);
    if (message === null) {
        recordQueueDecision('refresh', {
            action: 'dead',
            reason: 'invalid_batch',
        });
        return;
    }

    const { orchestrator } = makeRefreshRuntime(env);
    const decision = await orchestrator.processQueueMessage(
        message.body,
        `queue:${message.id}`,
    );
    recordQueueDecision('refresh', decision);
    applyDecision(message, decision);
};

export const handleRefreshCron = async (
    _controller: ScheduledController,
    env: Env,
): Promise<void> => {
    const runtime = makeRefreshRuntime(env);
    const result = await runtime.orchestrator.runCron({
        reserve: runtime.config.schedulerEnabled,
        dispatch: runtime.config.dispatchEnabled,
        dueLimit: runtime.config.dueLimit,
        dispatchLimit: Math.min(100, runtime.config.dueLimit * 2),
        staleLeaseLimit: runtime.config.dueLimit,
        redriveLimit: runtime.config.dueLimit,
        cleanupLimit: 100,
        jobCleanupLimit: 100,
    });
    recordCronResult(
        'refresh',
        {
            'app.cron.recovered_jobs': result.recoveredJobs,
            'app.cron.redriven_jobs': result.redrivenJobs,
            'app.cron.dead_lettered_jobs': result.deadLetteredJobs,
            'app.cron.reserved_jobs': result.reservedJobs,
            'app.cron.dispatched_messages': result.dispatched.sent,
            'app.cron.released_messages': result.dispatched.released,
            'app.cron.ambiguous_messages': result.dispatched.ambiguous,
            'app.cron.history_deleted': result.refreshHistoryDeleted,
            'app.cron.jobs_deleted': result.terminalJobsDeleted,
        },
        result.deadLetteredJobs > 0 ||
            result.dispatched.released > 0 ||
            result.dispatched.ambiguous > 0,
    );
};

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
    if (message === null) return;

    const { orchestrator } = makeRefreshRuntime(env);
    const decision = await orchestrator.processQueueMessage(
        message.body,
        `queue:${message.id}`,
    );
    applyDecision(message, decision);
};

export const handleRefreshCron = async (
    _controller: ScheduledController,
    env: Env,
): Promise<void> => {
    const runtime = makeRefreshRuntime(env);
    await runtime.orchestrator.runCron({
        reserve: runtime.config.schedulerEnabled,
        dispatch: runtime.config.dispatchEnabled,
        dueLimit: runtime.config.dueLimit,
        dispatchLimit: Math.min(100, runtime.config.dueLimit * 2),
        staleLeaseLimit: runtime.config.dueLimit,
        redriveLimit: runtime.config.dueLimit,
        cleanupLimit: 100,
        jobCleanupLimit: 100,
    });
};

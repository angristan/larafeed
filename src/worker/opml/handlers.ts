import { recordCronResult, recordQueueDecision } from '../observability';
import { singleQueueMessage } from '../queue';
import type { OpmlOrchestrator } from './orchestration';

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

/** Parent integration supplies an invocation-scoped orchestrator and Queue binding. */
export const handleOpmlQueue = async (
    batch: MessageBatch<unknown>,
    orchestrator: OpmlOrchestrator,
): Promise<void> => {
    const message = singleQueueMessage(batch);
    if (message === null) {
        recordQueueDecision('opml', {
            action: 'dead',
            reason: 'invalid_batch',
        });
        return;
    }

    const decision = await orchestrator.processQueueMessage(
        message.body,
        `opml-queue:${message.id}`,
    );
    recordQueueDecision('opml', decision);
    applyDecision(message, decision);
};

export const handleOpmlCron = async (
    orchestrator: OpmlOrchestrator,
    input: {
        readonly dispatchEnabled?: boolean;
        readonly dispatchLimit?: number;
        readonly recoveryLimit?: number;
    } = {},
): Promise<void> => {
    const result = await orchestrator.runCron({
        dispatch: input.dispatchEnabled,
        dispatchLimit: input.dispatchLimit,
        recoveryLimit: input.recoveryLimit,
    });
    recordCronResult(
        'opml',
        {
            'app.cron.recovered_jobs': result.recoveredJobs,
            'app.cron.recovered_imports': result.recoveredImports,
            'app.cron.redispatched_jobs': result.redispatchedJobs,
            'app.cron.dispatched_messages': result.dispatched.sent,
            'app.cron.released_messages': result.dispatched.released,
            'app.cron.ambiguous_messages': result.dispatched.ambiguous,
        },
        result.dispatched.released > 0 || result.dispatched.ambiguous > 0,
    );
};

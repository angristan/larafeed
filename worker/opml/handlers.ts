import type { OpmlOrchestrator } from './orchestration';
import type { OpmlQueueMessage } from './types';

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
    batch: MessageBatch<OpmlQueueMessage>,
    orchestrator: OpmlOrchestrator,
): Promise<void> => {
    for (const message of batch.messages) {
        const decision = await orchestrator.processQueueMessage(
            message.body,
            `opml-queue:${message.id}`,
        );
        applyDecision(message, decision);
    }
};

export const handleOpmlDeadLetterQueue = async (
    batch: MessageBatch<OpmlQueueMessage>,
    orchestrator: OpmlOrchestrator,
): Promise<void> => {
    for (const message of batch.messages) {
        applyDecision(
            message,
            await orchestrator.recordDeadLetter(message.body),
        );
    }
};

export const handleOpmlCron = async (
    orchestrator: OpmlOrchestrator,
    input: {
        readonly dispatchEnabled?: boolean;
        readonly dispatchLimit?: number;
        readonly recoveryLimit?: number;
    } = {},
): Promise<void> => {
    await orchestrator.runCron({
        dispatch: input.dispatchEnabled,
        dispatchLimit: input.dispatchLimit,
        recoveryLimit: input.recoveryLimit,
    });
};

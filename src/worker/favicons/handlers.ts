import { recordQueueDecision } from '../observability';
import { singleQueueMessage } from '../queue';
import { makeFaviconRuntime } from './runtime';

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

export const handleFaviconQueue = async (
    batch: MessageBatch<unknown>,
    env: Env,
): Promise<void> => {
    const message = singleQueueMessage(batch);
    if (message === null) {
        recordQueueDecision('favicon', {
            action: 'dead',
            reason: 'invalid_batch',
        });
        return;
    }

    const orchestrator = makeFaviconRuntime(env).orchestrator;
    const decision = await orchestrator.processQueueMessage(
        message.body,
        `favicon-queue:${message.id}`,
    );
    recordQueueDecision('favicon', decision);
    applyDecision(message, decision);
};

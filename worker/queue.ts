export const singleQueueMessage = <Body>(
    batch: MessageBatch<Body>,
): Message<Body> | null => {
    if (batch.messages.length === 1) return batch.messages[0] ?? null;

    // Configuration fixes consumer batches at one. During a rollout, an older
    // buffered batch can still reach newer code; retry it so Cloudflare can
    // redeliver each message under the new batch-size limit.
    batch.retryAll({ delaySeconds: 1 });
    return null;
};

import { tracing } from 'cloudflare:workers';

export const operationNames = {
    opmlQueue: 'app.opml.queue.consume',
    refreshQueue: 'app.refresh.queue.consume',
    faviconQueue: 'app.favicon.queue.consume',
    refreshCron: 'app.refresh.cron',
    opmlCron: 'app.opml.cron',
    faviconCron: 'app.favicon.cron',
} as const;

export type OperationName =
    (typeof operationNames)[keyof typeof operationNames];
export type OperationTrigger = 'queue' | 'scheduled';

export interface OperationAttributes {
    readonly batchSize?: number;
}

export const traceOperation = <A>(
    name: OperationName,
    trigger: OperationTrigger,
    attributes: OperationAttributes,
    operation: () => Promise<A>,
): Promise<A> =>
    tracing.enterSpan(name, async (span) => {
        span.setAttribute('app.trigger', trigger);
        if (attributes.batchSize !== undefined) {
            span.setAttribute('app.batch.size', attributes.batchSize);
        }
        try {
            return await operation();
        } catch (error) {
            span.setAttribute('app.failed', true);
            console.error({
                event: 'app.operation.failed',
                operation: name,
                trigger,
            });
            throw error;
        }
    });

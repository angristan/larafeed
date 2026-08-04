import { app } from './app';
import { handleFaviconCron } from './favicons/cron';
import { handleFaviconQueue } from './favicons/handlers';
import type { FaviconQueueMessage } from './favicons/job-types';
import type { RefreshQueueMessage } from './jobs';
import { operationNames, traceOperation } from './observability';
import {
    handleOpmlCron,
    handleOpmlQueue,
    makeDefaultOpmlOrchestrator,
    type OpmlQueueMessage,
    opmlImportEnabled,
} from './opml';
import { handleRefreshCron, handleRefreshQueue } from './refresh/handlers';
import { runScheduledSubsystems } from './scheduled';

export { app, createApp } from './app';

export default {
    fetch: app.fetch,
    queue: async (batch, env) => {
        const queueNames = [
            env.FEED_REFRESH_QUEUE_NAME,
            env.OPML_IMPORT_QUEUE_NAME,
            env.FAVICON_REFRESH_QUEUE_NAME,
        ] as const;
        if (
            queueNames.some(
                (name) => name.length === 0 || name.trim() !== name,
            ) ||
            new Set(queueNames).size !== queueNames.length
        ) {
            throw new Error('Invalid Queue configuration');
        }

        if (batch.queue === env.FAVICON_REFRESH_QUEUE_NAME) {
            await traceOperation(
                operationNames.faviconQueue,
                'queue',
                { batchSize: batch.messages.length },
                () => handleFaviconQueue(batch, env),
            );
            return;
        }
        if (batch.queue === env.OPML_IMPORT_QUEUE_NAME) {
            await traceOperation(
                operationNames.opmlQueue,
                'queue',
                { batchSize: batch.messages.length },
                () => handleOpmlQueue(batch, makeDefaultOpmlOrchestrator(env)),
            );
            return;
        }
        if (batch.queue === env.FEED_REFRESH_QUEUE_NAME) {
            await traceOperation(
                operationNames.refreshQueue,
                'queue',
                { batchSize: batch.messages.length },
                () => handleRefreshQueue(batch, env),
            );
            return;
        }
        throw new Error('Unknown Queue binding');
    },
    scheduled: async (controller, env) => {
        await runScheduledSubsystems([
            () =>
                traceOperation(
                    operationNames.refreshCron,
                    'scheduled',
                    {},
                    () => handleRefreshCron(controller, env),
                ),
            () =>
                traceOperation(operationNames.opmlCron, 'scheduled', {}, () =>
                    handleOpmlCron(makeDefaultOpmlOrchestrator(env), {
                        dispatchEnabled: opmlImportEnabled(env),
                    }),
                ),
            () =>
                traceOperation(
                    operationNames.faviconCron,
                    'scheduled',
                    {},
                    () => handleFaviconCron(env),
                ),
        ]);
    },
} satisfies ExportedHandler<
    Env,
    RefreshQueueMessage | OpmlQueueMessage | FaviconQueueMessage
>;

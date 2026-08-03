import { app } from './app';
import { handleFaviconCron } from './favicons/cron';
import type { RefreshQueueMessage } from './jobs';
import { operationNames, traceOperation } from './observability';
import {
    handleOpmlCron,
    handleOpmlDeadLetterQueue,
    handleOpmlQueue,
    makeDefaultOpmlOrchestrator,
    opmlImportEnabled,
} from './opml';
import { handleRefreshCron, handleRefreshQueue } from './refresh/handlers';
import { runScheduledSubsystems } from './scheduled';

export { app, createApp } from './app';

export default {
    fetch: app.fetch,
    queue: async (batch, env) => {
        if (batch.queue.includes('opml-import-dlq')) {
            await traceOperation(
                operationNames.opmlDeadLetterQueue,
                'queue',
                { batchSize: batch.messages.length, deadLetter: true },
                () =>
                    handleOpmlDeadLetterQueue(
                        batch,
                        makeDefaultOpmlOrchestrator(env),
                    ),
            );
            return;
        }
        if (batch.queue.includes('opml-import')) {
            await traceOperation(
                operationNames.opmlQueue,
                'queue',
                { batchSize: batch.messages.length, deadLetter: false },
                () => handleOpmlQueue(batch, makeDefaultOpmlOrchestrator(env)),
            );
            return;
        }
        await traceOperation(
            operationNames.refreshQueue,
            'queue',
            {
                batchSize: batch.messages.length,
                deadLetter: batch.queue.endsWith('-dlq'),
            },
            () => handleRefreshQueue(batch, env),
        );
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
} satisfies ExportedHandler<Env, RefreshQueueMessage>;

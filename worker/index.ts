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
        const queuePrefix =
            env.AUTH_ENVIRONMENT === 'test'
                ? 'larafeed-test'
                : env.AUTH_ENVIRONMENT === 'production'
                  ? 'larafeed'
                  : null;
        if (queuePrefix === null) throw new Error('Unknown Queue environment');

        if (batch.queue === `${queuePrefix}-favicon-refresh`) {
            await traceOperation(
                operationNames.faviconQueue,
                'queue',
                { batchSize: batch.messages.length },
                () => handleFaviconQueue(batch, env),
            );
            return;
        }
        if (batch.queue === `${queuePrefix}-opml-import`) {
            await traceOperation(
                operationNames.opmlQueue,
                'queue',
                { batchSize: batch.messages.length },
                () => handleOpmlQueue(batch, makeDefaultOpmlOrchestrator(env)),
            );
            return;
        }
        if (batch.queue === `${queuePrefix}-feed-refresh`) {
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

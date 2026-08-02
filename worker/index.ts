import { app } from './app';
import { handleFaviconCron } from './favicons/cron';
import type { RefreshQueueMessage } from './jobs';
import {
    handleOpmlCron,
    handleOpmlDeadLetterQueue,
    handleOpmlQueue,
    makeDefaultOpmlOrchestrator,
} from './opml';
import { handleRefreshCron, handleRefreshQueue } from './refresh/handlers';

export { app, createApp } from './app';

export default {
    fetch: app.fetch,
    queue: async (batch, env) => {
        if (batch.queue.includes('opml-import-dlq')) {
            await handleOpmlDeadLetterQueue(
                batch,
                makeDefaultOpmlOrchestrator(env),
            );
            return;
        }
        if (batch.queue.includes('opml-import')) {
            await handleOpmlQueue(batch, makeDefaultOpmlOrchestrator(env));
            return;
        }
        await handleRefreshQueue(batch, env);
    },
    scheduled: async (controller, env) => {
        await handleRefreshCron(controller, env);
        await handleOpmlCron(makeDefaultOpmlOrchestrator(env));
        await handleFaviconCron(env);
    },
} satisfies ExportedHandler<Env, RefreshQueueMessage>;

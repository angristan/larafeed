import { app } from './app';
import type { RefreshQueueMessage } from './jobs';
import { handleRefreshCron, handleRefreshQueue } from './refresh/handlers';

export { app, createApp } from './app';

export default {
    fetch: app.fetch,
    queue: handleRefreshQueue,
    scheduled: handleRefreshCron,
} satisfies ExportedHandler<Env, RefreshQueueMessage>;

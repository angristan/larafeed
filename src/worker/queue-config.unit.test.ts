import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Consumer {
    readonly queue: string;
    readonly max_batch_size?: number;
    readonly dead_letter_queue?: string;
}

interface EnvironmentConfig {
    readonly vars?: Readonly<Record<string, string>>;
    readonly queues?: { readonly consumers?: readonly Consumer[] };
}

interface QueueConfig extends EnvironmentConfig {
    readonly env?: {
        readonly production?: EnvironmentConfig;
        readonly vitest?: EnvironmentConfig;
    };
}

const config = JSON.parse(
    readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'),
) as QueueConfig;

const environments = [
    ['portable', config],
    ['production', config.env?.production],
    ['vitest', config.env?.vitest],
] as const;

const queueVariableNames = [
    'FEED_REFRESH_QUEUE_NAME',
    'OPML_IMPORT_QUEUE_NAME',
    'FAVICON_REFRESH_QUEUE_NAME',
] as const;

describe('Queue consumer configuration', () => {
    it('uses one message per invocation in every environment', () => {
        for (const [environment, settings] of environments) {
            const consumers = settings?.queues?.consumers ?? [];
            expect(consumers, environment).toHaveLength(3);
            for (const consumer of consumers) {
                expect(consumer.max_batch_size, consumer.queue).toBe(1);
                expect(
                    consumer.dead_letter_queue,
                    consumer.queue,
                ).toBeUndefined();
                expect(consumer.queue.endsWith('-dlq'), consumer.queue).toBe(
                    false,
                );
            }
        }
    });

    it('keeps exact runtime Queue names synchronized and distinct', () => {
        for (const [environment, settings] of environments) {
            const consumers = settings?.queues?.consumers ?? [];
            const configuredNames = queueVariableNames.map(
                (name) => settings?.vars?.[name],
            );
            const consumerNames = consumers.map(({ queue }) => queue);

            expect(configuredNames, environment).toEqual(consumerNames);
            expect(new Set(configuredNames).size, environment).toBe(3);
        }
    });
});

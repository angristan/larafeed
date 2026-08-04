import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Consumer {
    readonly queue: string;
    readonly max_batch_size?: number;
    readonly dead_letter_queue?: string;
}

interface QueueConfig {
    readonly queues?: { readonly consumers?: readonly Consumer[] };
    readonly env?: {
        readonly test?: {
            readonly queues?: { readonly consumers?: readonly Consumer[] };
        };
    };
}

const config = JSON.parse(
    readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
) as QueueConfig;

describe('Queue consumer configuration', () => {
    it('uses one message per invocation in every environment', () => {
        const production = config.queues?.consumers ?? [];
        const test = config.env?.test?.queues?.consumers ?? [];
        expect(production).toHaveLength(3);
        expect(test).toHaveLength(3);
        for (const consumer of [...production, ...test]) {
            expect(consumer.max_batch_size, consumer.queue).toBe(1);
            expect(consumer.dead_letter_queue, consumer.queue).toBeUndefined();
            expect(consumer.queue.endsWith('-dlq'), consumer.queue).toBe(false);
        }
    });

    it('has one main consumer for each feed-scoped task', () => {
        expect(config.queues?.consumers?.map(({ queue }) => queue)).toEqual([
            'larafeed-feed-refresh',
            'larafeed-opml-import',
            'larafeed-favicon-refresh',
        ]);
        expect(
            config.env?.test?.queues?.consumers?.map(({ queue }) => queue),
        ).toEqual([
            'larafeed-test-feed-refresh',
            'larafeed-test-opml-import',
            'larafeed-test-favicon-refresh',
        ]);
    });
});

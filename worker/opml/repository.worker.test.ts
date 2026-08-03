import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { makeOpmlRepository } from './repository';
import { OPML_IMPORT_JOB_KIND, OPML_IMPORT_TOPIC } from './types';

const d1 = makeD1(env.DB);
const repository = makeOpmlRepository(d1);
const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
const handle = (value: number) => new Uint8Array(32).fill(value % 255 || 1);

const insertUser = (id: number, now: number) =>
    run(
        d1.run({
            sql: `INSERT INTO users (
                    id, webauthn_user_handle, username, email, display_name,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            bindings: [
                id,
                handle(id),
                `opml-user-${id}`,
                `opml-user-${id}@example.test`,
                `OPML User ${id}`,
                now,
                now,
            ],
        }),
    );

const scalar = (sql: string, bindings: readonly unknown[] = []) =>
    run(d1.first<number>({ sql, bindings }, 'value'));

const first = <T>(sql: string, bindings: readonly unknown[] = []) =>
    run(d1.first<T>({ sql, bindings }));

describe('OPML D1 repository', () => {
    it('creates one command per feed and completes exact progress atomically', async () => {
        const now = 2_200_000_000_000;
        const userId = 710_001;
        const importId = 711_001;
        await insertUser(userId, now);

        const created = await repository.createImport({
            id: importId,
            userId,
            filename: 'subscriptions.opml',
            maxAttempts: 3,
            now,
            items: [
                {
                    id: 712_001,
                    jobId: 713_001,
                    outboxId: 714_001,
                    operationId: 'opml-workerd-operation',
                    position: 0,
                    title: 'Example feed',
                    feedUrl: 'https://opml-workerd.example.test/rss',
                    normalizedFeedUrl: 'https://opml-workerd.example.test/rss',
                    siteUrl: 'https://opml-workerd.example.test/',
                    categoryPath: ['Tech', 'Web'],
                },
            ],
        });

        expect(created).toMatchObject({
            id: importId,
            state: 'processing',
            totalItems: 1,
            succeededItems: 0,
        });
        await expect(
            first<{
                kind: string;
                topic: string;
                payload_json: string;
            }>(
                `SELECT j.kind, o.topic, o.payload_json FROM jobs j
                 JOIN outbox_messages o ON o.job_id = j.id
                 WHERE j.operation_id = ?`,
                ['opml-workerd-operation'],
            ),
        ).resolves.toEqual({
            kind: OPML_IMPORT_JOB_KIND,
            topic: OPML_IMPORT_TOPIC,
            payload_json: '{"operationId":"opml-workerd-operation"}',
        });

        const leased = await repository.leaseOutbox({
            owner: 'dispatcher',
            now,
            leaseMs: 10_000,
            limit: 10,
        });
        expect(leased).toHaveLength(1);
        const leasedMessage = leased[0];
        if (leasedMessage === undefined) throw new Error('Expected lease');
        await repository.markDispatched(leasedMessage, now);
        const claimed = await repository.claimJob({
            operationId: 'opml-workerd-operation',
            owner: 'consumer',
            now,
            leaseMs: 10_000,
        });
        if (claimed.type !== 'claimed') {
            throw new Error(`Expected claim, received ${claimed.type}`);
        }

        await expect(
            repository.completeItem({
                claim: claimed.claim,
                feedId: 715_001,
                categoryId: 716_001,
                feedUrl: 'https://opml-workerd.example.test/feed.xml',
                feedName: 'Example feed',
                categoryName: 'Tech / Web',
                siteUrl: 'https://opml-workerd.example.test/',
                faviconUrl: 'https://opml-workerd.example.test/favicon.ico',
                completedAt: now + 1,
            }),
        ).resolves.toBe('succeeded');

        await expect(
            repository.getImport(userId, importId),
        ).resolves.toMatchObject({
            state: 'completed',
            totalItems: 1,
            succeededItems: 1,
            failedItems: 0,
            skippedItems: 0,
            completedAt: now + 1,
        });
        await expect(
            scalar(
                `SELECT COUNT(*) AS value FROM feed_subscriptions
                 WHERE user_id = ? AND feed_id = ?`,
                [userId, 715_001],
            ),
        ).resolves.toBe(1);
        await expect(
            first<{ custom_feed_name: string | null }>(
                `SELECT custom_feed_name FROM feed_subscriptions
                 WHERE user_id = ? AND feed_id = ?`,
                [userId, 715_001],
            ),
        ).resolves.toEqual({ custom_feed_name: null });
        await expect(
            repository.claimJob({
                operationId: 'opml-workerd-operation',
                owner: 'duplicate',
                now: now + 2,
                leaseMs: 10_000,
            }),
        ).resolves.toEqual({ type: 'completed', state: 'succeeded' });
    });

    it('never leases another topic and hides imports from other users', async () => {
        const now = 2_200_001_000_000;
        const userId = 720_001;
        const otherUserId = 720_002;
        await insertUser(userId, now);
        await insertUser(otherUserId, now);
        await repository.createImport({
            id: 721_001,
            userId,
            filename: null,
            maxAttempts: 2,
            now,
            items: [
                {
                    id: 722_001,
                    jobId: 723_001,
                    outboxId: 724_001,
                    operationId: 'opml-filtered-operation',
                    position: 0,
                    title: null,
                    feedUrl: 'https://filtered.example.test/rss',
                    normalizedFeedUrl: 'https://filtered.example.test/rss',
                    siteUrl: null,
                    categoryPath: [],
                },
            ],
        });
        await run(
            d1.batch([
                {
                    sql: `INSERT INTO jobs (id, operation_id, kind, state, payload_json,
                            max_attempts, available_at, created_at, updated_at)
                        VALUES (?, ?, 'other_kind', 'pending', '{}', 2, ?, ?, ?)`,
                    bindings: [725_001, 'other-operation', now, now, now],
                },
                {
                    sql: `INSERT INTO outbox_messages (id, job_id, topic, payload_json,
                            state, available_at, created_at, updated_at)
                        VALUES (?, ?, 'other_topic', ?, 'pending', ?, ?, ?)`,
                    bindings: [
                        726_001,
                        725_001,
                        '{"operationId":"other-operation"}',
                        now,
                        now,
                        now,
                    ],
                },
            ]),
        );

        await run(
            d1.run({
                sql: `UPDATE opml_imports SET state = 'pending' WHERE id = ?`,
                bindings: [721_001],
            }),
        );
        await expect(
            repository.leaseOutbox({
                owner: 'incomplete-dispatcher',
                now,
                leaseMs: 1_000,
                limit: 10,
            }),
        ).resolves.toEqual([]);
        await run(
            d1.run({
                sql: `UPDATE opml_imports SET state = 'processing' WHERE id = ?`,
                bindings: [721_001],
            }),
        );

        const leased = await repository.leaseOutbox({
            owner: 'filtered-dispatcher',
            now,
            leaseMs: 1_000,
            limit: 10,
        });
        expect(leased.map((message) => message.operationId)).toEqual([
            'opml-filtered-operation',
        ]);
        await expect(
            repository.getImport(otherUserId, 721_001),
        ).resolves.toBeNull();
        await expect(
            first<{ state: string }>(
                'SELECT state FROM outbox_messages WHERE id = ?',
                [726_001],
            ),
        ).resolves.toEqual({ state: 'pending' });
    });

    it('records terminal URL failures once and exposes bounded error progress', async () => {
        const now = 2_200_002_000_000;
        const userId = 730_001;
        await insertUser(userId, now);
        await repository.createImport({
            id: 731_001,
            userId,
            filename: null,
            maxAttempts: 3,
            now,
            items: [
                {
                    id: 732_001,
                    jobId: 733_001,
                    outboxId: 734_001,
                    operationId: 'opml-terminal-failure',
                    position: 0,
                    title: 'Private feed',
                    feedUrl: 'http://127.0.0.1/rss',
                    normalizedFeedUrl: 'http://127.0.0.1/rss',
                    siteUrl: null,
                    categoryPath: [],
                },
            ],
        });
        const claim = await repository.claimJob({
            operationId: 'opml-terminal-failure',
            owner: 'failure-consumer',
            now,
            leaseMs: 10_000,
        });
        if (claim.type !== 'claimed') throw new Error('Expected claim');

        await repository.recordFailure({
            claim: claim.claim,
            failedAt: now + 1,
            retryable: false,
            retryAt: now + 30_000,
            errorClass: 'FeedPolicyError',
            errorMessage: 'forbidden_ip_address',
        });

        await expect(
            repository.getImport(userId, 731_001),
        ).resolves.toMatchObject({
            state: 'completed',
            failedItems: 1,
            errors: [
                {
                    position: 0,
                    feedUrl: 'http://127.0.0.1/rss',
                    errorClass: 'FeedPolicyError',
                },
            ],
        });
        await expect(
            repository.recordDeadLetter({
                operationId: 'opml-terminal-failure',
                now: now + 2,
                errorClass: 'queue_dead_letter',
                errorMessage: 'duplicate delivery',
            }),
        ).resolves.toBe(false);
        await expect(
            repository.getImport(userId, 731_001),
        ).resolves.toMatchObject({
            failedItems: 1,
        });
    });
});

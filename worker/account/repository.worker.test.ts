import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { AccountConflict, AccountForbidden } from './errors';
import { makeAccountRepository } from './repository';

const d1 = makeD1(env.DB);
const repository = makeAccountRepository(d1);
const now = 1_900_000_000_000;
const bytes = (value: number) => new Uint8Array(32).fill(value % 251 || 1);

const insertUser = (id: number, username: string, isAdmin = false) =>
    d1.run({
        sql: `INSERT INTO users (
                id, webauthn_user_handle, username, email, display_name,
                is_admin, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        bindings: [
            id,
            bytes(id),
            username,
            `${username}@example.test`,
            username,
            isAdmin ? 1 : 0,
            now,
            now,
        ],
    });
const insertSession = (id: number, userId: number) =>
    d1.run({
        sql: `INSERT INTO sessions (
                id, user_id, token_hash, csrf_token_hash,
                expires_at, last_seen_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        bindings: [
            id,
            userId,
            bytes(id + 17),
            bytes(id + 29),
            now + 10_000,
            now,
            now,
        ],
    });
const insertFeed = (id: number) =>
    d1.run({
        sql: `INSERT INTO feeds (
                id, name, feed_url, next_refresh_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
        bindings: [
            id,
            `Feed ${id}`,
            `https://feed-${id}.example.test/rss`,
            now,
            now,
            now,
        ],
    });
const subscribe = (userId: number, feedId: number, categoryId: number) =>
    d1.batch([
        {
            sql: `INSERT INTO subscription_categories (
                    id, user_id, name, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)`,
            bindings: [categoryId, userId, `Category ${categoryId}`, now, now],
        },
        {
            sql: `INSERT INTO feed_subscriptions (
                    user_id, feed_id, category_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)`,
            bindings: [userId, feedId, categoryId, now, now],
        },
    ]);

const count = async (sql: string, bindings: readonly unknown[] = []) => {
    const row = await Effect.runPromise(
        d1.first<{ count: number }>({ sql, bindings }),
    );
    return row?.count ?? -1;
};

describe('account D1 repository', () => {
    it('updates profiles uniquely and wipes only reader data', async () => {
        const userId = 930_001;
        const otherId = 930_002;
        const ownFeed = 931_001;
        const sharedFeed = 931_002;
        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(userId, 'wipe-reader');
                yield* insertUser(otherId, 'shared-reader');
                yield* insertSession(930_010, userId);
                yield* insertFeed(ownFeed);
                yield* insertFeed(sharedFeed);
                yield* subscribe(userId, ownFeed, 932_001);
                yield* subscribe(userId, sharedFeed, 932_002);
                yield* subscribe(otherId, sharedFeed, 932_003);
                yield* d1.batch([
                    {
                        sql: `INSERT INTO jobs (
                                id, operation_id, kind, state, payload_json,
                                max_attempts, available_at, created_at, updated_at
                            ) VALUES (?, ?, 'opml_import_feed', 'pending', '{}', 3, ?, ?, ?)`,
                        bindings: [
                            934_001,
                            'wipe-opml-operation',
                            now,
                            now,
                            now,
                        ],
                    },
                    {
                        sql: `INSERT INTO outbox_messages (
                                id, job_id, topic, payload_json, state,
                                available_at, created_at, updated_at
                            ) VALUES (?, ?, 'opml_import_feed', '{}', 'pending', ?, ?, ?)`,
                        bindings: [934_002, 934_001, now, now, now],
                    },
                    {
                        sql: `INSERT INTO opml_imports (
                                id, user_id, state, total_items, created_at, updated_at
                            ) VALUES (?, ?, 'pending', 1, ?, ?)`,
                        bindings: [934_003, userId, now, now],
                    },
                    {
                        sql: `INSERT INTO opml_import_items (
                                id, import_id, user_id, position, operation_id,
                                job_id, feed_url, normalized_feed_url,
                                state, max_attempts, created_at, updated_at
                            ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'pending', 3, ?, ?)`,
                        bindings: [
                            934_004,
                            934_003,
                            userId,
                            'wipe-opml-operation',
                            934_001,
                            'https://wipe-opml.example.test/feed',
                            'https://wipe-opml.example.test/feed',
                            now,
                            now,
                        ],
                    },
                ]);
            }),
        );

        await expect(
            Effect.runPromise(
                repository.updateProfile({
                    userId,
                    email: 'updated@example.test',
                    displayName: 'Updated reader',
                    eventId: 933_001,
                    now: now + 1,
                }),
            ),
        ).resolves.toMatchObject({
            email: 'updated@example.test',
            displayName: 'Updated reader',
        });
        await expect(
            Effect.runPromise(
                repository.updateProfile({
                    userId,
                    email: 'shared-reader@example.test',
                    displayName: 'Duplicate',
                    eventId: 933_002,
                    now: now + 2,
                }),
            ),
        ).rejects.toBeInstanceOf(AccountConflict);

        await expect(
            Effect.runPromise(
                repository.wipeReaderData({
                    userId,
                    sessionId: 999_999,
                    eventId: 933_003,
                    now: now + 3,
                }),
            ),
        ).rejects.toBeInstanceOf(AccountConflict);
        expect(
            await count(
                'SELECT COUNT(*) AS count FROM feed_subscriptions WHERE user_id = ?',
                [userId],
            ),
        ).toBe(2);

        await Effect.runPromise(
            repository.wipeReaderData({
                userId,
                sessionId: 930_010,
                eventId: 933_004,
                now: now + 4,
            }),
        );
        expect(
            await count('SELECT COUNT(*) AS count FROM users WHERE id = ?', [
                userId,
            ]),
        ).toBe(1);
        expect(
            await count(
                'SELECT COUNT(*) AS count FROM feed_subscriptions WHERE user_id = ?',
                [userId],
            ),
        ).toBe(0);
        expect(
            await count('SELECT COUNT(*) AS count FROM feeds WHERE id = ?', [
                ownFeed,
            ]),
        ).toBe(0);
        expect(
            await count('SELECT COUNT(*) AS count FROM feeds WHERE id = ?', [
                sharedFeed,
            ]),
        ).toBe(1);
        expect(
            await count(
                "SELECT COUNT(*) AS count FROM security_events WHERE kind = 'account.reader.wiped'",
            ),
        ).toBe(1);
        expect(
            await count(
                "SELECT COUNT(*) AS count FROM jobs WHERE operation_id = 'wipe-opml-operation'",
            ),
        ).toBe(0);
        expect(
            await count(
                'SELECT COUNT(*) AS count FROM opml_imports WHERE user_id = ?',
                [userId],
            ),
        ).toBe(0);
    });

    it('protects the last administrator while deleting ordinary accounts', async () => {
        const adminId = 940_001;
        const memberId = 940_002;
        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(adminId, 'only-admin', true);
                yield* insertUser(memberId, 'departing-member');
                yield* insertSession(940_010, adminId);
                yield* insertSession(940_011, memberId);
            }),
        );

        await expect(
            Effect.runPromise(
                repository.deleteAccount({
                    userId: adminId,
                    sessionId: 940_010,
                    eventId: 941_001,
                    now: now + 1,
                }),
            ),
        ).rejects.toBeInstanceOf(AccountConflict);
        await expect(
            Effect.runPromise(
                repository.deleteAccount({
                    userId: memberId,
                    sessionId: 940_011,
                    eventId: 941_002,
                    now: now + 2,
                }),
            ),
        ).resolves.toBeUndefined();
        expect(
            await count('SELECT COUNT(*) AS count FROM users WHERE id = ?', [
                memberId,
            ]),
        ).toBe(0);
    });

    it('lists operational state and disables users atomically', async () => {
        const actorId = 950_001;
        const adminId = 950_002;
        const memberId = 950_003;
        await Effect.runPromise(
            Effect.gen(function* () {
                yield* insertUser(actorId, 'actor-admin', true);
                yield* insertUser(adminId, 'second-admin', true);
                yield* insertUser(memberId, 'managed-member');
                yield* d1.batch([
                    {
                        sql: `INSERT INTO sessions (
                                id, user_id, token_hash, csrf_token_hash,
                                expires_at, last_seen_at, created_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        bindings: [
                            951_001,
                            memberId,
                            bytes(11),
                            bytes(12),
                            now + 10_000,
                            now,
                            now,
                        ],
                    },
                    {
                        sql: `INSERT INTO user_access_links (
                                id, user_id, created_by_user_id, purpose,
                                token_hash, expires_at, created_at
                            ) VALUES (?, ?, ?, 'recovery', ?, ?, ?)`,
                        bindings: [
                            951_002,
                            memberId,
                            actorId,
                            bytes(13),
                            now + 10_000,
                            now,
                        ],
                    },
                ]);
            }),
        );

        await expect(
            Effect.runPromise(repository.adminOverview()),
        ).resolves.toMatchObject({
            users: expect.arrayContaining([
                expect.objectContaining({ id: memberId, disabledAt: null }),
            ]),
            accessLinks: [
                expect.objectContaining({
                    id: 951_002,
                    username: 'managed-member',
                }),
            ],
        });
        await expect(
            Effect.runPromise(
                repository.setUserDisabled({
                    actorUserId: actorId,
                    targetUserId: actorId,
                    disabled: true,
                    eventId: 952_001,
                    now: now + 1,
                }),
            ),
        ).rejects.toBeInstanceOf(AccountForbidden);
        await expect(
            Effect.runPromise(
                repository.setUserDisabled({
                    actorUserId: actorId,
                    targetUserId: memberId,
                    disabled: true,
                    eventId: 952_002,
                    now: now + 2,
                }),
            ),
        ).resolves.toMatchObject({ id: memberId, disabledAt: now + 2 });
        expect(
            await count(
                'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at = ?',
                [memberId, now + 2],
            ),
        ).toBe(1);
        expect(
            await count(
                'SELECT COUNT(*) AS count FROM user_access_links WHERE user_id = ? AND revoked_at = ?',
                [memberId, now + 2],
            ),
        ).toBe(1);
    });
});

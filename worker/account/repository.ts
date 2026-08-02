import type {
    AccountProfile,
    AdminAccessLink,
    AdminOverviewResponse,
    AdminSecurityEvent,
    AdminUser,
} from '@shared/schemas/account';
import { Effect, Schema } from 'effect';

import type { D1, D1OperationError } from '../infrastructure/d1';
import {
    AccountConflict,
    AccountForbidden,
    AccountInvariantError,
    AccountNotFound,
    AccountStorageError,
} from './errors';

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const ProfileRow = Schema.Struct({
    id: Schema.Int,
    username: Schema.String,
    email: Schema.String,
    display_name: Schema.String,
    is_admin: Schema.Int,
    created_at: Schema.Int,
});
const AdminUserRow = Schema.Struct({
    ...ProfileRow.fields,
    disabled_at: Schema.NullOr(Schema.Int),
    passkey_count: Count,
    subscription_count: Count,
});
const LinkRow = Schema.Struct({
    id: Schema.Int,
    user_id: Schema.Int,
    username: Schema.String,
    purpose: Schema.Literals(['enrollment', 'recovery']),
    expires_at: Schema.Int,
    consumed_at: Schema.NullOr(Schema.Int),
    revoked_at: Schema.NullOr(Schema.Int),
    created_at: Schema.Int,
});
const EventRow = Schema.Struct({
    id: Schema.Int,
    user_id: Schema.NullOr(Schema.Int),
    actor_user_id: Schema.NullOr(Schema.Int),
    kind: Schema.String,
    created_at: Schema.Int,
});

export interface AccountRepository {
    readonly getProfile: (
        userId: number,
    ) => Effect.Effect<
        AccountProfile,
        AccountNotFound | AccountStorageError | AccountInvariantError
    >;
    readonly updateProfile: (input: {
        readonly userId: number;
        readonly email: string;
        readonly displayName: string;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<
        AccountProfile,
        | AccountNotFound
        | AccountConflict
        | AccountStorageError
        | AccountInvariantError
    >;
    readonly wipeReaderData: (input: {
        readonly userId: number;
        readonly sessionId: number;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<
        void,
        | AccountNotFound
        | AccountConflict
        | AccountStorageError
        | AccountInvariantError
    >;
    readonly deleteAccount: (input: {
        readonly userId: number;
        readonly sessionId: number;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<
        void,
        | AccountNotFound
        | AccountConflict
        | AccountStorageError
        | AccountInvariantError
    >;
    readonly adminOverview: () => Effect.Effect<
        AdminOverviewResponse,
        AccountStorageError | AccountInvariantError
    >;
    readonly setUserDisabled: (input: {
        readonly actorUserId: number;
        readonly targetUserId: number;
        readonly disabled: boolean;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<
        AdminUser,
        | AccountNotFound
        | AccountConflict
        | AccountForbidden
        | AccountStorageError
        | AccountInvariantError
    >;
}

const invariant = (operation: string) =>
    new AccountInvariantError({ operation });
const withStorage = <A, R>(
    operation: string,
    effect: Effect.Effect<A, D1OperationError, R>,
): Effect.Effect<A, AccountStorageError, R> =>
    effect.pipe(
        Effect.mapError(
            (cause) => new AccountStorageError({ operation, cause }),
        ),
    );
const decode = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    value: unknown,
): Effect.Effect<S['Type'], AccountInvariantError> =>
    Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(value),
        catch: () => invariant(operation),
    });
const decodeRows = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    rows: readonly unknown[],
) => Effect.forEach(rows, (row) => decode(operation, schema, row));
const changes = (
    operation: string,
    result: D1Result<unknown> | undefined,
): Effect.Effect<number, AccountInvariantError> => {
    const value = result?.meta.changes;
    return typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0
        ? Effect.succeed(value)
        : Effect.fail(invariant(operation));
};
const profile = (row: typeof ProfileRow.Type): AccountProfile => ({
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
});
const adminUser = (row: typeof AdminUserRow.Type): AdminUser => ({
    ...profile(row),
    disabledAt: row.disabled_at,
    passkeyCount: row.passkey_count,
    subscriptionCount: row.subscription_count,
});
const profileSql = `SELECT id, username, email, display_name, is_admin, created_at
    FROM users WHERE id = ?`;
const adminUserSql = `SELECT u.id, u.username, u.email, u.display_name,
        u.is_admin, u.disabled_at, u.created_at,
        (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkey_count,
        (SELECT COUNT(*) FROM feed_subscriptions fs WHERE fs.user_id = u.id) AS subscription_count
    FROM users u`;

export const makeAccountRepository = (d1: D1): AccountRepository => ({
    getProfile: (userId) =>
        Effect.gen(function* () {
            const operation = 'account.profile.get';
            const row = yield* withStorage(
                operation,
                d1.first({ sql: profileSql, bindings: [userId] }),
            );
            if (row === null) return yield* Effect.fail(new AccountNotFound());
            return profile(yield* decode(operation, ProfileRow, row));
        }),

    updateProfile: (input) =>
        Effect.gen(function* () {
            const operation = 'account.profile.update';
            const results = yield* withStorage(
                operation,
                d1.batch([
                    {
                        sql: `UPDATE users
                            SET email = ?, display_name = ?, updated_at = ?
                            WHERE id = ? AND disabled_at IS NULL
                              AND NOT EXISTS (
                                SELECT 1 FROM users duplicate
                                WHERE duplicate.email = ? COLLATE NOCASE
                                  AND duplicate.id <> ?
                              )
                              AND (email <> ? OR display_name <> ?)`,
                        bindings: [
                            input.email,
                            input.displayName,
                            input.now,
                            input.userId,
                            input.email,
                            input.userId,
                            input.email,
                            input.displayName,
                        ],
                    },
                    {
                        sql: `INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, ?, ?, 'account.profile.updated', '{}', ?
                            WHERE changes() = 1`,
                        bindings: [
                            input.eventId,
                            input.userId,
                            input.userId,
                            input.now,
                        ],
                    },
                    { sql: profileSql, bindings: [input.userId] },
                ]),
            );
            const updateCount = yield* changes(operation, results[0]);
            const eventCount = yield* changes(operation, results[1]);
            if (updateCount > 1 || eventCount !== updateCount) {
                return yield* Effect.fail(invariant(operation));
            }
            const rows = results[2]?.results ?? [];
            if (rows.length === 0)
                return yield* Effect.fail(new AccountNotFound());
            if (rows.length !== 1)
                return yield* Effect.fail(invariant(operation));
            const updated = profile(
                yield* decode(operation, ProfileRow, rows[0]),
            );
            if (
                updated.email.toLocaleLowerCase() !==
                    input.email.toLocaleLowerCase() ||
                updated.displayName !== input.displayName
            ) {
                return yield* Effect.fail(new AccountConflict());
            }
            return updated;
        }),

    wipeReaderData: (input) =>
        Effect.gen(function* () {
            const operation = 'account.reader.wipe';
            const results = yield* withStorage(
                operation,
                d1.batch([
                    {
                        sql: `INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, id, id, 'account.reader.wiped', '{}', ?
                            FROM users WHERE id = ? AND disabled_at IS NULL
                              AND EXISTS (
                                SELECT 1 FROM sessions s
                                WHERE s.id = ? AND s.user_id = users.id
                                  AND s.revoked_at IS NULL
                                  AND s.created_at >= ?
                              )`,
                        bindings: [
                            input.eventId,
                            input.now,
                            input.userId,
                            input.sessionId,
                            input.now - 5 * 60_000,
                        ],
                    },
                    {
                        sql: `DELETE FROM jobs
                            WHERE id IN (
                                SELECT item.job_id FROM opml_import_items item
                                WHERE item.user_id = ? AND item.job_id IS NOT NULL
                            ) AND EXISTS (
                                SELECT 1 FROM security_events
                                WHERE id = ? AND kind = 'account.reader.wiped'
                            )`,
                        bindings: [input.userId, input.eventId],
                    },
                    {
                        sql: `DELETE FROM opml_imports
                            WHERE user_id = ? AND EXISTS (
                                SELECT 1 FROM security_events
                                WHERE id = ? AND kind = 'account.reader.wiped'
                            )`,
                        bindings: [input.userId, input.eventId],
                    },
                    {
                        sql: `DELETE FROM feed_subscriptions
                            WHERE user_id = ? AND EXISTS (
                                SELECT 1 FROM security_events
                                WHERE id = ? AND kind = 'account.reader.wiped'
                            )`,
                        bindings: [input.userId, input.eventId],
                    },
                    {
                        sql: `DELETE FROM subscription_categories
                            WHERE user_id = ? AND EXISTS (
                                SELECT 1 FROM security_events
                                WHERE id = ? AND kind = 'account.reader.wiped'
                            )`,
                        bindings: [input.userId, input.eventId],
                    },
                    {
                        sql: `DELETE FROM feeds
                            WHERE EXISTS (
                                SELECT 1 FROM security_events
                                WHERE id = ? AND kind = 'account.reader.wiped'
                            ) AND NOT EXISTS (
                                SELECT 1 FROM feed_subscriptions fs
                                WHERE fs.feed_id = feeds.id
                            )`,
                        bindings: [input.eventId],
                    },
                ]),
            );
            if ((yield* changes(operation, results[0])) !== 1) {
                return yield* Effect.fail(new AccountConflict());
            }
            yield* Effect.forEach(results.slice(1), (result) =>
                changes(operation, result),
            );
        }),

    deleteAccount: (input) =>
        Effect.gen(function* () {
            const operation = 'account.delete';
            const results = yield* withStorage(
                operation,
                d1.batch([
                    {
                        sql: `INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, u.id, u.id, 'account.deleted', '{}', ?
                            FROM users u
                            WHERE u.id = ? AND u.disabled_at IS NULL
                              AND (u.is_admin = 0 OR EXISTS (
                                SELECT 1 FROM users other
                                WHERE other.is_admin = 1
                                  AND other.disabled_at IS NULL
                                  AND other.id <> u.id
                              ))
                              AND EXISTS (
                                SELECT 1 FROM sessions s
                                WHERE s.id = ? AND s.user_id = u.id
                                  AND s.revoked_at IS NULL
                                  AND s.created_at >= ?
                              )`,
                        bindings: [
                            input.eventId,
                            input.now,
                            input.userId,
                            input.sessionId,
                            input.now - 5 * 60_000,
                        ],
                    },
                    {
                        sql: `DELETE FROM jobs
                            WHERE id IN (
                                SELECT item.job_id FROM opml_import_items item
                                WHERE item.user_id = ? AND item.job_id IS NOT NULL
                            ) AND EXISTS (
                                SELECT 1 FROM security_events
                                WHERE id = ? AND kind = 'account.deleted'
                            )`,
                        bindings: [input.userId, input.eventId],
                    },
                    {
                        sql: `DELETE FROM users
                            WHERE id = ? AND EXISTS (
                                SELECT 1 FROM security_events
                                WHERE id = ? AND kind = 'account.deleted'
                                  AND user_id = users.id
                            )
                            RETURNING id`,
                        bindings: [input.userId, input.eventId],
                    },
                    {
                        sql: `DELETE FROM feeds
                            WHERE EXISTS (
                                SELECT 1 FROM security_events
                                WHERE id = ? AND kind = 'account.deleted'
                            ) AND NOT EXISTS (
                                SELECT 1 FROM feed_subscriptions fs
                                WHERE fs.feed_id = feeds.id
                            )`,
                        bindings: [input.eventId],
                    },
                ]),
            );
            const eventCount = yield* changes(operation, results[0]);
            yield* changes(operation, results[1]);
            yield* changes(operation, results[2]);
            yield* changes(operation, results[3]);
            const deletedRows = results[2]?.results ?? [];
            if (eventCount === 1 && deletedRows.length === 1) return;
            if (eventCount !== deletedRows.length || deletedRows.length > 1) {
                return yield* Effect.fail(invariant(operation));
            }
            const existing = yield* withStorage(
                operation,
                d1.first({
                    sql: 'SELECT is_admin FROM users WHERE id = ?',
                    bindings: [input.userId],
                }),
            );
            if (existing === null)
                return yield* Effect.fail(new AccountNotFound());
            return yield* Effect.fail(new AccountConflict());
        }),

    adminOverview: () =>
        Effect.gen(function* () {
            const operation = 'account.admin.overview';
            const results = yield* withStorage(
                operation,
                d1.batch([
                    {
                        sql: `${adminUserSql} ORDER BY u.created_at, u.id LIMIT 100`,
                        bindings: [],
                    },
                    {
                        sql: `SELECT l.id, l.user_id, u.username, l.purpose,
                                l.expires_at, l.consumed_at, l.revoked_at, l.created_at
                            FROM user_access_links l
                            JOIN users u ON u.id = l.user_id
                            ORDER BY l.created_at DESC, l.id DESC LIMIT 100`,
                        bindings: [],
                    },
                    {
                        sql: `SELECT id, user_id, actor_user_id, kind, created_at
                            FROM security_events
                            ORDER BY created_at DESC, id DESC LIMIT 100`,
                        bindings: [],
                    },
                ]),
            );
            const users = (yield* decodeRows(
                operation,
                AdminUserRow,
                results[0]?.results ?? [],
            )).map(adminUser);
            const accessLinks: AdminAccessLink[] = (yield* decodeRows(
                operation,
                LinkRow,
                results[1]?.results ?? [],
            )).map((row) => ({
                id: row.id,
                userId: row.user_id,
                username: row.username,
                purpose: row.purpose,
                expiresAt: row.expires_at,
                consumedAt: row.consumed_at,
                revokedAt: row.revoked_at,
                createdAt: row.created_at,
            }));
            const securityEvents: AdminSecurityEvent[] = (yield* decodeRows(
                operation,
                EventRow,
                results[2]?.results ?? [],
            )).map((row) => ({
                id: row.id,
                userId: row.user_id,
                actorUserId: row.actor_user_id,
                kind: row.kind,
                createdAt: row.created_at,
            }));
            return { users, accessLinks, securityEvents };
        }),

    setUserDisabled: (input) =>
        Effect.gen(function* () {
            const operation = 'account.admin.user.setDisabled';
            const targetValue = yield* withStorage(
                operation,
                d1.first({
                    sql: `${adminUserSql} WHERE u.id = ?`,
                    bindings: [input.targetUserId],
                }),
            );
            if (targetValue === null)
                return yield* Effect.fail(new AccountNotFound());
            const target = adminUser(
                yield* decode(operation, AdminUserRow, targetValue),
            );
            if (input.targetUserId === input.actorUserId) {
                return yield* Effect.fail(new AccountForbidden());
            }
            if ((target.disabledAt !== null) === input.disabled) {
                return target;
            }
            const updateSql = input.disabled
                ? `UPDATE users SET disabled_at = ?, updated_at = ?
                    WHERE id = ? AND disabled_at IS NULL
                      AND (is_admin = 0 OR EXISTS (
                        SELECT 1 FROM users other
                        WHERE other.is_admin = 1 AND other.disabled_at IS NULL
                          AND other.id <> users.id
                      ))`
                : `UPDATE users SET disabled_at = NULL, updated_at = ?
                    WHERE id = ? AND disabled_at IS NOT NULL`;
            const updateBindings = input.disabled
                ? [input.now, input.now, input.targetUserId]
                : [input.now, input.targetUserId];
            const statements = [
                { sql: updateSql, bindings: updateBindings },
                {
                    sql: `INSERT INTO security_events (
                            id, user_id, actor_user_id, kind,
                            metadata_json, created_at
                        ) SELECT ?, ?, ?, ?, '{}', ? WHERE changes() = 1`,
                    bindings: [
                        input.eventId,
                        input.targetUserId,
                        input.actorUserId,
                        input.disabled
                            ? 'account.disabled'
                            : 'account.reactivated',
                        input.now,
                    ],
                },
                ...(input.disabled
                    ? [
                          {
                              sql: `UPDATE sessions SET revoked_at = ?
                                  WHERE user_id = ? AND revoked_at IS NULL`,
                              bindings: [input.now, input.targetUserId],
                          },
                          {
                              sql: `UPDATE user_access_links SET revoked_at = ?
                                  WHERE user_id = ? AND consumed_at IS NULL
                                    AND revoked_at IS NULL`,
                              bindings: [input.now, input.targetUserId],
                          },
                      ]
                    : []),
                {
                    sql: `${adminUserSql} WHERE u.id = ?`,
                    bindings: [input.targetUserId],
                },
            ];
            const results = yield* withStorage(operation, d1.batch(statements));
            const updateCount = yield* changes(operation, results[0]);
            const eventCount = yield* changes(operation, results[1]);
            if (updateCount !== 1 || eventCount !== 1) {
                if (updateCount === 0 && eventCount === 0) {
                    return yield* Effect.fail(new AccountConflict());
                }
                return yield* Effect.fail(invariant(operation));
            }
            const rows = results.at(-1)?.results ?? [];
            if (rows.length !== 1)
                return yield* Effect.fail(invariant(operation));
            return adminUser(yield* decode(operation, AdminUserRow, rows[0]));
        }),
});

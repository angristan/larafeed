import type { AccessLinkPurpose, AppTokenScope } from '@shared/schemas/auth';
import { Effect, Schema } from 'effect';
import type { D1, D1OperationError, D1Statement } from '../infrastructure/d1';
import {
    AccessLinkInvalid,
    AuthConflict,
    AuthenticationFailed,
    AuthInvariantError,
    AuthNotFound,
    AuthStorageError,
    Forbidden,
    Unauthenticated,
} from './errors';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const BooleanInt = Schema.Literals([0, 1]);
const NullableTimestamp = Schema.NullOr(Timestamp);

const UserRowSchema = Schema.Struct({
    id: SafeId,
    webauthn_user_handle: Schema.Unknown,
    username: Schema.String,
    email: Schema.String,
    display_name: Schema.String,
    is_admin: BooleanInt,
    disabled_at: NullableTimestamp,
});

const PasskeyRowSchema = Schema.Struct({
    id: SafeId,
    user_id: SafeId,
    credential_id: Schema.Unknown,
    public_key: Schema.Unknown,
    sign_count: Schema.Int,
    transports_json: Schema.String,
    aaguid: Schema.NullOr(Schema.String),
    name: Schema.String,
    is_backed_up: BooleanInt,
    last_used_at: NullableTimestamp,
    created_at: Timestamp,
});

const ChallengeRowSchema = Schema.Struct({
    challenge_id: SafeId,
    user_id: SafeId,
    access_link_id: Schema.NullOr(SafeId),
    purpose: Schema.Literals(['authentication', 'enrollment', 'recovery']),
    challenge_hash: Schema.Unknown,
    expected_rp_id: Schema.String,
    expected_origin: Schema.String,
    webauthn_user_handle: Schema.Unknown,
    username: Schema.String,
    email: Schema.String,
    display_name: Schema.String,
    is_admin: BooleanInt,
    passkey_id: Schema.optionalKey(SafeId),
    credential_id: Schema.optionalKey(Schema.Unknown),
    public_key: Schema.optionalKey(Schema.Unknown),
    sign_count: Schema.optionalKey(Schema.Int),
    transports_json: Schema.optionalKey(Schema.String),
    aaguid: Schema.optionalKey(Schema.NullOr(Schema.String)),
    passkey_name: Schema.optionalKey(Schema.String),
    is_backed_up: Schema.optionalKey(BooleanInt),
    last_used_at: Schema.optionalKey(NullableTimestamp),
    passkey_created_at: Schema.optionalKey(Timestamp),
});

const SessionRowSchema = Schema.Struct({
    session_id: SafeId,
    user_id: SafeId,
    csrf_token_hash: Schema.Unknown,
    expires_at: Timestamp,
    last_seen_at: Timestamp,
    username: Schema.String,
    display_name: Schema.String,
    is_admin: BooleanInt,
});

const AccessContextRowSchema = Schema.Struct({
    link_id: SafeId,
    user_id: SafeId,
    purpose: Schema.Literals(['enrollment', 'recovery']),
    webauthn_user_handle: Schema.Unknown,
    username: Schema.String,
    email: Schema.String,
    display_name: Schema.String,
    is_admin: BooleanInt,
});

const AppTokenRowSchema = Schema.Struct({
    id: SafeId,
    name: Schema.String,
    token_prefix: Schema.String,
    scopes_json: Schema.String,
    created_at: Timestamp,
    last_used_at: NullableTimestamp,
    expires_at: NullableTimestamp,
});

const AppTokenAuthenticationRowSchema = Schema.Struct({
    token_id: SafeId,
    user_id: SafeId,
    username: Schema.String,
    display_name: Schema.String,
    is_admin: BooleanInt,
    scopes_json: Schema.String,
    last_used_at: NullableTimestamp,
});

export interface AuthUserRecord {
    readonly id: number;
    readonly handle: Uint8Array;
    readonly username: string;
    readonly email: string;
    readonly displayName: string;
    readonly isAdmin: boolean;
}

export interface PasskeyRecord {
    readonly id: number;
    readonly userId: number;
    readonly credentialId: Uint8Array;
    readonly publicKey: Uint8Array;
    readonly signCount: number;
    readonly transports: readonly string[];
    readonly aaguid: string | null;
    readonly name: string;
    readonly backedUp: boolean;
    readonly lastUsedAt: number | null;
    readonly createdAt: number;
}

export interface RegistrationContext {
    readonly challengeId: number;
    readonly accessLinkId: number;
    readonly purpose: AccessLinkPurpose;
    readonly challengeHash: Uint8Array;
    readonly expectedRpId: string;
    readonly expectedOrigin: string;
    readonly user: AuthUserRecord;
}

export interface AuthenticationContext {
    readonly challengeId: number;
    readonly challengeHash: Uint8Array;
    readonly expectedRpId: string;
    readonly expectedOrigin: string;
    readonly user: AuthUserRecord;
    readonly passkey: PasskeyRecord;
}

export interface SessionRecord {
    readonly id: number;
    readonly user: AuthUserRecord;
    readonly csrfTokenHash: Uint8Array;
    readonly expiresAt: number;
    readonly lastSeenAt: number;
}

export interface AccessContext {
    readonly linkId: number;
    readonly purpose: AccessLinkPurpose;
    readonly user: AuthUserRecord;
    readonly passkeys: readonly PasskeyRecord[];
}

export interface AppTokenRecord {
    readonly id: number;
    readonly name: string;
    readonly prefix: string;
    readonly scopes: readonly AppTokenScope[];
    readonly createdAt: number;
    readonly lastUsedAt: number | null;
    readonly expiresAt: number | null;
}

export interface AppTokenAuthentication {
    readonly tokenId: number;
    readonly user: AuthUserRecord;
    readonly scopes: readonly AppTokenScope[];
}

export interface NewSession {
    readonly id: number;
    readonly tokenHash: Uint8Array;
    readonly csrfTokenHash: Uint8Array;
    readonly expiresAt: number;
}

export interface NewPasskey {
    readonly id: number;
    readonly credentialId: Uint8Array;
    readonly publicKey: Uint8Array;
    readonly signCount: number;
    readonly transports: readonly string[];
    readonly aaguid: string | null;
    readonly name: string;
    readonly backedUp: boolean;
}

export interface AuthRepository {
    readonly issueAuthenticationChallenge: (input: {
        readonly id: number;
        readonly challengeHash: Uint8Array;
        readonly rpId: string;
        readonly origin: string;
        readonly now: number;
        readonly expiresAt: number;
    }) => Effect.Effect<void, AuthStorageError>;
    readonly consumeAuthenticationChallenge: (input: {
        readonly challengeId: number;
        readonly credentialId: Uint8Array;
        readonly now: number;
    }) => Effect.Effect<
        AuthenticationContext,
        AuthenticationFailed | AuthStorageError | AuthInvariantError
    >;
    readonly completeAuthentication: (input: {
        readonly context: AuthenticationContext;
        readonly newSignCount: number;
        readonly backedUp: boolean;
        readonly session: NewSession;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<
        void,
        AuthenticationFailed | AuthStorageError | AuthInvariantError
    >;
    readonly findAccessContext: (input: {
        readonly tokenHash: Uint8Array;
        readonly now: number;
    }) => Effect.Effect<
        AccessContext,
        AccessLinkInvalid | AuthStorageError | AuthInvariantError
    >;
    readonly issueAccessChallenge: (input: {
        readonly id: number;
        readonly context: AccessContext;
        readonly challengeHash: Uint8Array;
        readonly rpId: string;
        readonly origin: string;
        readonly now: number;
        readonly expiresAt: number;
    }) => Effect.Effect<
        void,
        AccessLinkInvalid | AuthStorageError | AuthInvariantError
    >;
    readonly findUserRegistrationContext: (
        userId: number,
    ) => Effect.Effect<
        AccessContext,
        Forbidden | AuthStorageError | AuthInvariantError
    >;
    readonly issueAuthenticatedRegistrationChallenge: (input: {
        readonly linkId: number;
        readonly linkTokenHash: Uint8Array;
        readonly challengeId: number;
        readonly userId: number;
        readonly challengeHash: Uint8Array;
        readonly rpId: string;
        readonly origin: string;
        readonly now: number;
        readonly expiresAt: number;
    }) => Effect.Effect<
        AccessContext,
        Forbidden | AuthStorageError | AuthInvariantError
    >;
    readonly consumeRegistrationChallenge: (input: {
        readonly challengeId: number;
        readonly now: number;
        readonly accessTokenHash?: Uint8Array;
        readonly authenticatedUserId?: number;
    }) => Effect.Effect<
        RegistrationContext,
        AccessLinkInvalid | Forbidden | AuthStorageError | AuthInvariantError
    >;
    readonly completeRegistration: (input: {
        readonly context: RegistrationContext;
        readonly accessTokenHash?: Uint8Array;
        readonly authenticatedUserId?: number;
        readonly passkey: NewPasskey;
        readonly session?: NewSession;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<
        void,
        | AccessLinkInvalid
        | Forbidden
        | AuthConflict
        | AuthStorageError
        | AuthInvariantError
    >;
    readonly findSession: (input: {
        readonly tokenHash: Uint8Array;
        readonly now: number;
        readonly idleCutoff: number;
        readonly lastSeenThrottleCutoff: number;
    }) => Effect.Effect<
        SessionRecord,
        Unauthenticated | AuthStorageError | AuthInvariantError
    >;
    readonly revokeSession: (input: {
        readonly tokenHash: Uint8Array;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<void, AuthStorageError | AuthInvariantError>;
    readonly listPasskeys: (
        userId: number,
    ) => Effect.Effect<
        readonly PasskeyRecord[],
        Forbidden | AuthStorageError | AuthInvariantError
    >;
    readonly deletePasskey: (input: {
        readonly userId: number;
        readonly passkeyId: number;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<
        void,
        | AuthNotFound
        | AuthConflict
        | Forbidden
        | AuthStorageError
        | AuthInvariantError
    >;
    readonly createEnrollmentLink: (input: {
        readonly actorUserId: number;
        readonly user: AuthUserRecord;
        readonly linkId: number;
        readonly tokenHash: Uint8Array;
        readonly eventId: number;
        readonly now: number;
        readonly expiresAt: number;
    }) => Effect.Effect<
        void,
        AuthConflict | Forbidden | AuthStorageError | AuthInvariantError
    >;
    readonly createRecoveryLink: (input: {
        readonly actorUserId: number;
        readonly targetUserId: number;
        readonly linkId: number;
        readonly tokenHash: Uint8Array;
        readonly eventId: number;
        readonly now: number;
        readonly expiresAt: number;
    }) => Effect.Effect<
        void,
        AuthNotFound | Forbidden | AuthStorageError | AuthInvariantError
    >;
    readonly revokeAccessLink: (input: {
        readonly actorUserId: number;
        readonly linkId: number;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<
        void,
        AuthNotFound | Forbidden | AuthStorageError | AuthInvariantError
    >;
    readonly listAppTokens: (
        userId: number,
    ) => Effect.Effect<
        readonly AppTokenRecord[],
        Forbidden | AuthStorageError | AuthInvariantError
    >;
    readonly createAppToken: (input: {
        readonly userId: number;
        readonly token: AppTokenRecord;
        readonly tokenHash: Uint8Array;
        readonly feverVerifierHash: Uint8Array | null;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<
        void,
        Forbidden | AuthStorageError | AuthInvariantError
    >;
    readonly revokeAppToken: (input: {
        readonly userId: number;
        readonly tokenId: number;
        readonly eventId: number;
        readonly now: number;
    }) => Effect.Effect<
        void,
        AuthNotFound | Forbidden | AuthStorageError | AuthInvariantError
    >;
    readonly authenticateAppToken: (input: {
        readonly username?: string;
        readonly tokenHash: Uint8Array;
        readonly requiredScope: AppTokenScope;
        readonly now: number;
        readonly lastUsedThrottleCutoff: number;
    }) => Effect.Effect<
        AppTokenAuthentication,
        AuthenticationFailed | AuthStorageError | AuthInvariantError
    >;
    readonly authenticateFeverVerifier: (input: {
        readonly verifierHash: Uint8Array;
        readonly now: number;
        readonly lastUsedThrottleCutoff: number;
    }) => Effect.Effect<
        AppTokenAuthentication,
        AuthenticationFailed | AuthStorageError | AuthInvariantError
    >;
}

const storageError = (operation: string, cause: unknown) =>
    new AuthStorageError({ operation, cause });
const invariantError = (operation: string) =>
    new AuthInvariantError({ operation });

const withStorageError = <A, R>(
    operation: string,
    effect: Effect.Effect<A, D1OperationError, R>,
): Effect.Effect<A, AuthStorageError, R> =>
    effect.pipe(Effect.mapError((error) => storageError(operation, error)));

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
    operation: string,
    schema: S,
    value: unknown,
): Effect.Effect<S['Type'], AuthInvariantError> =>
    Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(value),
        catch: () => invariantError(operation),
    });

const blob = (
    operation: string,
    value: unknown,
    expectedLength?: number,
): Effect.Effect<Uint8Array, AuthInvariantError> =>
    Effect.try({
        try: () => {
            let source: Uint8Array;
            if (value instanceof ArrayBuffer) {
                source = new Uint8Array(value);
            } else if (ArrayBuffer.isView(value)) {
                source = new Uint8Array(
                    value.buffer,
                    value.byteOffset,
                    value.byteLength,
                );
            } else if (
                Array.isArray(value) &&
                value.length > 0 &&
                value.every(
                    (byte) =>
                        Number.isInteger(byte) && byte >= 0 && byte <= 255,
                )
            ) {
                source = Uint8Array.from(value as number[]);
            } else {
                throw new Error('Expected BLOB');
            }
            const bytes = new Uint8Array(source.byteLength);
            bytes.set(source);

            if (
                bytes.byteLength === 0 ||
                (expectedLength !== undefined &&
                    bytes.byteLength !== expectedLength)
            ) {
                throw new Error('Unexpected BLOB length');
            }
            return bytes;
        },
        catch: () => invariantError(operation),
    });

const stringArray = (
    operation: string,
    json: string,
): Effect.Effect<readonly string[], AuthInvariantError> =>
    Effect.try({
        try: () => {
            const value: unknown = JSON.parse(json);
            if (
                !Array.isArray(value) ||
                !value.every((item) => typeof item === 'string')
            ) {
                throw new Error('Expected string array');
            }
            return value;
        },
        catch: () => invariantError(operation),
    });

const scopes = (
    operation: string,
    json: string,
): Effect.Effect<readonly AppTokenScope[], AuthInvariantError> =>
    stringArray(operation, json).pipe(
        Effect.flatMap((values) =>
            values.every(
                (value) => value === 'google-reader' || value === 'fever',
            )
                ? Effect.succeed(values as readonly AppTokenScope[])
                : Effect.fail(invariantError(operation)),
        ),
    );

const changes = (
    operation: string,
    result: D1Result<unknown>,
): Effect.Effect<number, AuthInvariantError> =>
    typeof result.meta.changes === 'number' && result.meta.changes >= 0
        ? Effect.succeed(result.meta.changes)
        : Effect.fail(invariantError(operation));

const userFromRow = (
    operation: string,
    row: {
        readonly id?: number;
        readonly user_id?: number;
        readonly webauthn_user_handle: unknown;
        readonly username: string;
        readonly email: string;
        readonly display_name: string;
        readonly is_admin: 0 | 1;
    },
): Effect.Effect<AuthUserRecord, AuthInvariantError> =>
    Effect.gen(function* () {
        const id = row.id ?? row.user_id;
        if (id === undefined) {
            return yield* Effect.fail(invariantError(operation));
        }
        const handle = yield* blob(operation, row.webauthn_user_handle, 32);
        return {
            id,
            handle,
            username: row.username,
            email: row.email,
            displayName: row.display_name,
            isAdmin: row.is_admin === 1,
        };
    });

const passkeyFromRow = (
    operation: string,
    row: typeof PasskeyRowSchema.Type,
): Effect.Effect<PasskeyRecord, AuthInvariantError> =>
    Effect.gen(function* () {
        const credentialId = yield* blob(operation, row.credential_id);
        const publicKey = yield* blob(operation, row.public_key);
        const transports = yield* stringArray(operation, row.transports_json);
        return {
            id: row.id,
            userId: row.user_id,
            credentialId,
            publicKey,
            signCount: row.sign_count,
            transports,
            aaguid: row.aaguid,
            name: row.name,
            backedUp: row.is_backed_up === 1,
            lastUsedAt: row.last_used_at,
            createdAt: row.created_at,
        };
    });

const listPasskeysForUser = (
    d1: D1,
    operation: string,
    userId: number,
): Effect.Effect<
    readonly PasskeyRecord[],
    AuthStorageError | AuthInvariantError
> =>
    withStorageError(
        operation,
        d1.all({
            sql: `
                SELECT p.*
                FROM passkeys p
                JOIN users u ON u.id = p.user_id
                WHERE p.user_id = ? AND u.disabled_at IS NULL
                ORDER BY p.created_at, p.id
            `,
            bindings: [userId],
        }),
    ).pipe(
        Effect.flatMap((result) =>
            Effect.forEach(result.results, (value) =>
                decode(operation, PasskeyRowSchema, value).pipe(
                    Effect.flatMap((row) => passkeyFromRow(operation, row)),
                ),
            ),
        ),
    );

const activeAdmin = `
    EXISTS (
        SELECT 1 FROM users actor
        WHERE actor.id = ? AND actor.is_admin = 1 AND actor.disabled_at IS NULL
    )
`;

const eventMetadata = (metadata: Record<string, unknown>): string =>
    JSON.stringify(metadata);

export const makeAuthRepository = (d1: D1): AuthRepository => ({
    issueAuthenticationChallenge: (input) =>
        withStorageError(
            'challenge.issueAuthentication',
            d1.run({
                sql: `
                    INSERT INTO webauthn_challenges (
                        id, purpose, challenge_hash, expected_rp_id,
                        expected_origin, expires_at, created_at
                    ) VALUES (?, 'authentication', ?, ?, ?, ?, ?)
                `,
                bindings: [
                    input.id,
                    input.challengeHash,
                    input.rpId,
                    input.origin,
                    input.expiresAt,
                    input.now,
                ],
            }),
        ).pipe(Effect.asVoid),

    consumeAuthenticationChallenge: (input) =>
        Effect.gen(function* () {
            const operation = 'challenge.consumeAuthentication';
            const value = yield* withStorageError(
                operation,
                d1.first({
                    sql: `
                        SELECT
                            c.id AS challenge_id, u.id AS user_id,
                            c.access_link_id, c.purpose, c.challenge_hash,
                            c.expected_rp_id, c.expected_origin,
                            u.webauthn_user_handle, u.username, u.email,
                            u.display_name, u.is_admin,
                            p.id AS passkey_id, p.credential_id, p.public_key,
                            p.sign_count, p.transports_json, p.aaguid,
                            p.name AS passkey_name, p.is_backed_up,
                            p.last_used_at, p.created_at AS passkey_created_at
                        FROM webauthn_challenges c
                        JOIN passkeys p ON p.credential_id = ?
                        JOIN users u ON u.id = p.user_id
                        WHERE c.id = ? AND c.purpose = 'authentication'
                          AND c.consumed_at IS NULL AND c.expires_at > ?
                          AND u.disabled_at IS NULL
                    `,
                    bindings: [
                        input.credentialId,
                        input.challengeId,
                        input.now,
                    ],
                }),
            );
            if (value === null) {
                return yield* Effect.fail(new AuthenticationFailed());
            }
            const row = yield* decode(operation, ChallengeRowSchema, value);

            const consumed = yield* withStorageError(
                operation,
                d1.run({
                    sql: `
                        UPDATE webauthn_challenges
                        SET consumed_at = ?
                        WHERE id = ? AND purpose = 'authentication'
                          AND consumed_at IS NULL AND expires_at > ?
                          AND EXISTS (
                              SELECT 1
                              FROM passkeys p JOIN users u ON u.id = p.user_id
                              WHERE p.credential_id = ? AND u.disabled_at IS NULL
                          )
                    `,
                    bindings: [
                        input.now,
                        input.challengeId,
                        input.now,
                        input.credentialId,
                    ],
                }),
            );
            if ((yield* changes(operation, consumed)) !== 1) {
                return yield* Effect.fail(new AuthenticationFailed());
            }

            const challengeHash = yield* blob(
                operation,
                row.challenge_hash,
                32,
            );
            const user = yield* userFromRow(operation, row);
            const credentialId = yield* blob(operation, row.credential_id);
            const publicKey = yield* blob(operation, row.public_key);
            const transports = yield* stringArray(
                operation,
                row.transports_json ?? '[]',
            );
            if (
                row.passkey_id === undefined ||
                row.sign_count === undefined ||
                row.passkey_name === undefined ||
                row.is_backed_up === undefined ||
                row.last_used_at === undefined ||
                row.passkey_created_at === undefined
            ) {
                return yield* Effect.fail(invariantError(operation));
            }

            return {
                challengeId: row.challenge_id,
                challengeHash,
                expectedRpId: row.expected_rp_id,
                expectedOrigin: row.expected_origin,
                user,
                passkey: {
                    id: row.passkey_id,
                    userId: user.id,
                    credentialId,
                    publicKey,
                    signCount: row.sign_count,
                    transports,
                    aaguid: row.aaguid ?? null,
                    name: row.passkey_name,
                    backedUp: row.is_backed_up === 1,
                    lastUsedAt: row.last_used_at,
                    createdAt: row.passkey_created_at,
                },
            };
        }),

    completeAuthentication: (input) =>
        Effect.gen(function* () {
            const operation = 'authentication.complete';
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `
                            UPDATE passkeys
                            SET sign_count = ?, is_backed_up = ?,
                                last_used_at = ?, updated_at = ?
                            WHERE credential_id = ? AND user_id = ?
                              AND sign_count = ?
                              AND EXISTS (
                                  SELECT 1 FROM users
                                  WHERE id = ? AND disabled_at IS NULL
                              )
                        `,
                        bindings: [
                            input.newSignCount,
                            input.backedUp ? 1 : 0,
                            input.now,
                            input.now,
                            input.context.passkey.credentialId,
                            input.context.user.id,
                            input.context.passkey.signCount,
                            input.context.user.id,
                        ],
                    },
                    {
                        sql: `
                            INSERT INTO sessions (
                                id, user_id, token_hash, csrf_token_hash,
                                expires_at, last_seen_at, created_at
                            )
                            SELECT ?, ?, ?, ?, ?, ?, ?
                            WHERE changes() = 1 AND EXISTS (
                                SELECT 1 FROM users
                                WHERE id = ? AND disabled_at IS NULL
                            ) AND EXISTS (
                                SELECT 1 FROM passkeys
                                WHERE credential_id = ? AND user_id = ?
                                  AND sign_count = ? AND last_used_at = ?
                            )
                        `,
                        bindings: [
                            input.session.id,
                            input.context.user.id,
                            input.session.tokenHash,
                            input.session.csrfTokenHash,
                            input.session.expiresAt,
                            input.now,
                            input.now,
                            input.context.user.id,
                            input.context.passkey.credentialId,
                            input.context.user.id,
                            input.newSignCount,
                            input.now,
                        ],
                    },
                    {
                        sql: `
                            INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, ?, ?, 'authentication.succeeded', ?, ?
                            WHERE changes() = 1 AND EXISTS (
                                SELECT 1 FROM sessions
                                WHERE id = ? AND user_id = ?
                            )
                        `,
                        bindings: [
                            input.eventId,
                            input.context.user.id,
                            input.context.user.id,
                            eventMetadata({
                                passkeyId: input.context.passkey.id,
                            }),
                            input.now,
                            input.session.id,
                            input.context.user.id,
                        ],
                    },
                ]),
            );
            const counts = yield* Effect.forEach(results, (result) =>
                changes(operation, result),
            );
            if (counts.every((count) => count === 0)) {
                return yield* Effect.fail(new AuthenticationFailed());
            }
            if (!counts.every((count) => count === 1)) {
                return yield* Effect.fail(invariantError(operation));
            }
        }),

    findAccessContext: (input) =>
        Effect.gen(function* () {
            const operation = 'access.find';
            const value = yield* withStorageError(
                operation,
                d1.first({
                    sql: `
                        SELECT l.id AS link_id, l.user_id, l.purpose,
                            u.webauthn_user_handle, u.username, u.email,
                            u.display_name, u.is_admin
                        FROM user_access_links l
                        JOIN users u ON u.id = l.user_id
                        WHERE l.token_hash = ? AND l.consumed_at IS NULL
                          AND l.revoked_at IS NULL AND l.expires_at > ?
                          AND u.disabled_at IS NULL
                    `,
                    bindings: [input.tokenHash, input.now],
                }),
            );
            if (value === null) {
                return yield* Effect.fail(new AccessLinkInvalid());
            }
            const row = yield* decode(operation, AccessContextRowSchema, value);
            const user = yield* userFromRow(operation, row);
            const passkeys = yield* listPasskeysForUser(
                d1,
                operation,
                row.user_id,
            );
            return {
                linkId: row.link_id,
                purpose: row.purpose,
                user,
                passkeys,
            };
        }),

    issueAccessChallenge: (input) =>
        Effect.gen(function* () {
            const operation = 'challenge.issueAccess';
            const result = yield* withStorageError(
                operation,
                d1.run({
                    sql: `
                        INSERT INTO webauthn_challenges (
                            id, user_id, access_link_id, purpose,
                            challenge_hash, expected_rp_id, expected_origin,
                            expires_at, created_at
                        )
                        SELECT ?, l.user_id, l.id, l.purpose, ?, ?, ?, ?, ?
                        FROM user_access_links l
                        JOIN users u ON u.id = l.user_id
                        WHERE l.id = ? AND l.consumed_at IS NULL
                          AND l.revoked_at IS NULL AND l.expires_at > ?
                          AND u.disabled_at IS NULL
                    `,
                    bindings: [
                        input.id,
                        input.challengeHash,
                        input.rpId,
                        input.origin,
                        input.expiresAt,
                        input.now,
                        input.context.linkId,
                        input.now,
                    ],
                }),
            );
            if ((yield* changes(operation, result)) !== 1) {
                return yield* Effect.fail(new AccessLinkInvalid());
            }
        }),

    findUserRegistrationContext: (userId) =>
        Effect.gen(function* () {
            const operation = 'registration.findUserContext';
            const value = yield* withStorageError(
                operation,
                d1.first({
                    sql: `
                        SELECT id, webauthn_user_handle, username, email,
                            display_name, is_admin, disabled_at
                        FROM users WHERE id = ? AND disabled_at IS NULL
                    `,
                    bindings: [userId],
                }),
            );
            if (value === null) {
                return yield* Effect.fail(new Forbidden());
            }
            const row = yield* decode(operation, UserRowSchema, value);
            return {
                linkId: 0,
                purpose: 'enrollment' as const,
                user: yield* userFromRow(operation, row),
                passkeys: yield* listPasskeysForUser(d1, operation, userId),
            };
        }),

    issueAuthenticatedRegistrationChallenge: (input) =>
        Effect.gen(function* () {
            const operation = 'challenge.issueAuthenticatedRegistration';
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `
                            INSERT INTO user_access_links (
                                id, user_id, created_by_user_id, purpose,
                                token_hash, expires_at, created_at
                            )
                            SELECT ?, id, id, 'enrollment', ?, ?, ?
                            FROM users
                            WHERE id = ? AND disabled_at IS NULL
                        `,
                        bindings: [
                            input.linkId,
                            input.linkTokenHash,
                            input.expiresAt,
                            input.now,
                            input.userId,
                        ],
                    },
                    {
                        sql: `
                            INSERT INTO webauthn_challenges (
                                id, user_id, access_link_id, purpose,
                                challenge_hash, expected_rp_id,
                                expected_origin, expires_at, created_at
                            )
                            SELECT ?, user_id, id, purpose, ?, ?, ?, ?, ?
                            FROM user_access_links
                            WHERE id = ? AND user_id = ?
                              AND created_by_user_id = ?
                              AND consumed_at IS NULL AND revoked_at IS NULL
                              AND expires_at > ?
                        `,
                        bindings: [
                            input.challengeId,
                            input.challengeHash,
                            input.rpId,
                            input.origin,
                            input.expiresAt,
                            input.now,
                            input.linkId,
                            input.userId,
                            input.userId,
                            input.now,
                        ],
                    },
                ]),
            );
            const counts = yield* Effect.forEach(results, (result) =>
                changes(operation, result),
            );
            if (counts.every((count) => count === 0)) {
                return yield* Effect.fail(new Forbidden());
            }
            if (!counts.every((count) => count === 1)) {
                return yield* Effect.fail(invariantError(operation));
            }

            const userValue = yield* withStorageError(
                operation,
                d1.first({
                    sql: `
                        SELECT id, webauthn_user_handle, username, email,
                            display_name, is_admin, disabled_at
                        FROM users WHERE id = ? AND disabled_at IS NULL
                    `,
                    bindings: [input.userId],
                }),
            );
            if (userValue === null) {
                return yield* Effect.fail(new Forbidden());
            }
            const userRow = yield* decode(operation, UserRowSchema, userValue);
            const user = yield* userFromRow(operation, userRow);
            const passkeys = yield* listPasskeysForUser(
                d1,
                operation,
                input.userId,
            );
            return {
                linkId: input.linkId,
                purpose: 'enrollment' as const,
                user,
                passkeys,
            };
        }),

    consumeRegistrationChallenge: (input) =>
        Effect.gen(function* () {
            const operation = 'challenge.consumeRegistration';
            const linkPredicate =
                input.accessTokenHash !== undefined
                    ? 'AND l.token_hash = ?'
                    : 'AND l.created_by_user_id = ? AND l.user_id = ?';
            const linkBindings =
                input.accessTokenHash !== undefined
                    ? [input.accessTokenHash]
                    : [input.authenticatedUserId, input.authenticatedUserId];
            if (
                input.accessTokenHash === undefined &&
                input.authenticatedUserId === undefined
            ) {
                return yield* Effect.fail(new Forbidden());
            }

            const value = yield* withStorageError(
                operation,
                d1.first({
                    sql: `
                        SELECT c.id AS challenge_id, c.user_id,
                            c.access_link_id, c.purpose, c.challenge_hash,
                            c.expected_rp_id, c.expected_origin,
                            u.webauthn_user_handle, u.username, u.email,
                            u.display_name, u.is_admin
                        FROM webauthn_challenges c
                        JOIN user_access_links l ON l.id = c.access_link_id
                        JOIN users u ON u.id = c.user_id AND u.id = l.user_id
                        WHERE c.id = ? AND c.purpose IN ('enrollment', 'recovery')
                          AND c.consumed_at IS NULL AND c.expires_at > ?
                          AND l.consumed_at IS NULL AND l.revoked_at IS NULL
                          AND l.expires_at > ? AND u.disabled_at IS NULL
                          ${linkPredicate}
                    `,
                    bindings: [
                        input.challengeId,
                        input.now,
                        input.now,
                        ...linkBindings,
                    ],
                }),
            );
            if (value === null) {
                return yield* Effect.fail(
                    input.accessTokenHash === undefined
                        ? new Forbidden()
                        : new AccessLinkInvalid(),
                );
            }
            const row = yield* decode(operation, ChallengeRowSchema, value);
            if (row.access_link_id === null) {
                return yield* Effect.fail(invariantError(operation));
            }

            const result = yield* withStorageError(
                operation,
                d1.run({
                    sql: `
                        UPDATE webauthn_challenges
                        SET consumed_at = ?
                        WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
                          AND EXISTS (
                              SELECT 1
                              FROM user_access_links l
                              JOIN users u ON u.id = l.user_id
                              WHERE l.id = webauthn_challenges.access_link_id
                                AND l.user_id = webauthn_challenges.user_id
                                AND l.consumed_at IS NULL
                                AND l.revoked_at IS NULL AND l.expires_at > ?
                                AND u.disabled_at IS NULL
                                ${linkPredicate}
                          )
                    `,
                    bindings: [
                        input.now,
                        input.challengeId,
                        input.now,
                        input.now,
                        ...linkBindings,
                    ],
                }),
            );
            if ((yield* changes(operation, result)) !== 1) {
                return yield* Effect.fail(
                    input.accessTokenHash === undefined
                        ? new Forbidden()
                        : new AccessLinkInvalid(),
                );
            }

            const challengeHash = yield* blob(
                operation,
                row.challenge_hash,
                32,
            );
            const user = yield* userFromRow(operation, row);
            return {
                challengeId: row.challenge_id,
                accessLinkId: row.access_link_id,
                purpose: row.purpose as AccessLinkPurpose,
                challengeHash,
                expectedRpId: row.expected_rp_id,
                expectedOrigin: row.expected_origin,
                user,
            };
        }),

    completeRegistration: (input) =>
        Effect.gen(function* () {
            const operation = 'registration.complete';
            const linkPredicate =
                input.accessTokenHash !== undefined
                    ? 'AND token_hash = ?'
                    : 'AND created_by_user_id = ? AND user_id = ?';
            const linkBindings =
                input.accessTokenHash !== undefined
                    ? [input.accessTokenHash]
                    : [input.authenticatedUserId, input.authenticatedUserId];
            if (
                input.accessTokenHash === undefined &&
                input.authenticatedUserId === undefined
            ) {
                return yield* Effect.fail(new Forbidden());
            }

            const statements: D1Statement[] = [
                {
                    sql: `
                        INSERT INTO passkeys (
                            id, user_id, credential_id, public_key,
                            sign_count, transports_json, aaguid, name,
                            is_backed_up, created_at, updated_at
                        )
                        SELECT ?, user_id, ?, ?, ?, ?, ?, ?, ?, ?, ?
                        FROM user_access_links
                        WHERE id = ? AND user_id = ? AND purpose = ?
                          AND consumed_at IS NULL AND revoked_at IS NULL
                          AND expires_at > ? ${linkPredicate}
                    `,
                    bindings: [
                        input.passkey.id,
                        input.passkey.credentialId,
                        input.passkey.publicKey,
                        input.passkey.signCount,
                        JSON.stringify(input.passkey.transports),
                        input.passkey.aaguid,
                        input.passkey.name,
                        input.passkey.backedUp ? 1 : 0,
                        input.now,
                        input.now,
                        input.context.accessLinkId,
                        input.context.user.id,
                        input.context.purpose,
                        input.now,
                        ...linkBindings,
                    ],
                },
                {
                    sql: `
                        UPDATE user_access_links
                        SET consumed_at = ?
                        WHERE id = ? AND user_id = ? AND purpose = ?
                          AND consumed_at IS NULL AND revoked_at IS NULL
                          AND expires_at > ? ${linkPredicate}
                          AND changes() = 1
                          AND EXISTS (
                              SELECT 1 FROM passkeys
                              WHERE id = ? AND user_id = ?
                          )
                    `,
                    bindings: [
                        input.now,
                        input.context.accessLinkId,
                        input.context.user.id,
                        input.context.purpose,
                        input.now,
                        ...linkBindings,
                        input.passkey.id,
                        input.context.user.id,
                    ],
                },
                {
                    sql: `
                        UPDATE sessions
                        SET revoked_at = ?
                        WHERE user_id = ? AND revoked_at IS NULL
                          AND ? = 'recovery' AND changes() = 1
                          AND EXISTS (
                              SELECT 1 FROM user_access_links
                              WHERE id = ? AND user_id = ?
                                AND purpose = 'recovery' AND consumed_at = ?
                          )
                    `,
                    bindings: [
                        input.now,
                        input.context.user.id,
                        input.context.purpose,
                        input.context.accessLinkId,
                        input.context.user.id,
                        input.now,
                    ],
                },
            ];
            if (input.session !== undefined) {
                statements.push({
                    sql: `
                        INSERT INTO sessions (
                            id, user_id, token_hash, csrf_token_hash,
                            expires_at, last_seen_at, created_at
                        )
                        SELECT ?, ?, ?, ?, ?, ?, ?
                        WHERE EXISTS (
                            SELECT 1 FROM user_access_links
                            WHERE id = ? AND user_id = ? AND consumed_at = ?
                        ) AND EXISTS (
                            SELECT 1 FROM users
                            WHERE id = ? AND disabled_at IS NULL
                        )
                    `,
                    bindings: [
                        input.session.id,
                        input.context.user.id,
                        input.session.tokenHash,
                        input.session.csrfTokenHash,
                        input.session.expiresAt,
                        input.now,
                        input.now,
                        input.context.accessLinkId,
                        input.context.user.id,
                        input.now,
                        input.context.user.id,
                    ],
                });
            }
            statements.push({
                sql: `
                    INSERT INTO security_events (
                        id, user_id, actor_user_id, kind,
                        metadata_json, created_at
                    )
                    SELECT ?, ?, ?, ?, ?, ?
                    WHERE EXISTS (
                        SELECT 1 FROM user_access_links
                        WHERE id = ? AND user_id = ? AND consumed_at = ?
                    ) AND EXISTS (
                        SELECT 1 FROM passkeys
                        WHERE id = ? AND user_id = ?
                    )
                `,
                bindings: [
                    input.eventId,
                    input.context.user.id,
                    input.context.user.id,
                    input.context.purpose === 'recovery'
                        ? 'recovery.completed'
                        : 'passkey.registered',
                    eventMetadata({
                        accessLinkId: input.context.accessLinkId,
                        passkeyId: input.passkey.id,
                    }),
                    input.now,
                    input.context.accessLinkId,
                    input.context.user.id,
                    input.now,
                    input.passkey.id,
                    input.context.user.id,
                ],
            });

            const results = yield* withStorageError(
                operation,
                d1.batch(statements),
            );
            const counts = yield* Effect.forEach(results, (result) =>
                changes(operation, result),
            );
            const requiredIndexes = [
                0,
                1,
                ...(input.session === undefined ? [3] : [3, 4]),
            ];
            if (counts[0] === 0 && counts[1] === 0) {
                return yield* Effect.fail(
                    input.accessTokenHash === undefined
                        ? new Forbidden()
                        : new AccessLinkInvalid(),
                );
            }
            if (!requiredIndexes.every((index) => counts[index] === 1)) {
                return yield* Effect.fail(invariantError(operation));
            }
        }),

    findSession: (input) =>
        Effect.gen(function* () {
            const operation = 'session.find';
            const value = yield* withStorageError(
                operation,
                d1.first({
                    sql: `
                        SELECT s.id AS session_id, s.user_id,
                            s.csrf_token_hash, s.expires_at, s.last_seen_at,
                            u.username, u.display_name, u.is_admin
                        FROM sessions s
                        JOIN users u ON u.id = s.user_id
                        WHERE s.token_hash = ? AND s.revoked_at IS NULL
                          AND s.expires_at > ? AND s.last_seen_at > ?
                          AND u.disabled_at IS NULL
                    `,
                    bindings: [input.tokenHash, input.now, input.idleCutoff],
                }),
            );
            if (value === null) {
                return yield* Effect.fail(new Unauthenticated());
            }
            const row = yield* decode(operation, SessionRowSchema, value);
            const csrfTokenHash = yield* blob(
                operation,
                row.csrf_token_hash,
                32,
            );

            if (row.last_seen_at <= input.lastSeenThrottleCutoff) {
                yield* withStorageError(
                    operation,
                    d1.run({
                        sql: `
                            UPDATE sessions SET last_seen_at = ?
                            WHERE id = ? AND revoked_at IS NULL
                              AND expires_at > ? AND last_seen_at > ?
                              AND last_seen_at <= ?
                        `,
                        bindings: [
                            input.now,
                            row.session_id,
                            input.now,
                            input.idleCutoff,
                            input.lastSeenThrottleCutoff,
                        ],
                    }),
                );
            }

            return {
                id: row.session_id,
                user: {
                    id: row.user_id,
                    handle: new Uint8Array(32),
                    username: row.username,
                    email: '',
                    displayName: row.display_name,
                    isAdmin: row.is_admin === 1,
                },
                csrfTokenHash,
                expiresAt: row.expires_at,
                lastSeenAt: row.last_seen_at,
            };
        }),

    revokeSession: (input) =>
        Effect.gen(function* () {
            const operation = 'session.revoke';
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `
                            UPDATE sessions SET revoked_at = ?
                            WHERE token_hash = ? AND revoked_at IS NULL
                        `,
                        bindings: [input.now, input.tokenHash],
                    },
                    {
                        sql: `
                            INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, user_id, user_id, 'session.revoked', '{}', ?
                            FROM sessions
                            WHERE token_hash = ? AND revoked_at = ?
                              AND changes() = 1
                        `,
                        bindings: [
                            input.eventId,
                            input.now,
                            input.tokenHash,
                            input.now,
                        ],
                    },
                ]),
            );
            const first = yield* changes(operation, results[0]);
            const second = yield* changes(operation, results[1]);
            if (
                !(
                    (first === 0 && second === 0) ||
                    (first === 1 && second === 1)
                )
            ) {
                return yield* Effect.fail(invariantError(operation));
            }
        }),

    listPasskeys: (userId) =>
        listPasskeysForUser(d1, 'passkey.list', userId).pipe(
            Effect.flatMap((passkeys) =>
                passkeys.length === 0
                    ? withStorageError(
                          'passkey.list',
                          d1.first({
                              sql: 'SELECT id FROM users WHERE id = ? AND disabled_at IS NULL',
                              bindings: [userId],
                          }),
                      ).pipe(
                          Effect.flatMap((user) =>
                              user === null
                                  ? Effect.fail(new Forbidden())
                                  : Effect.succeed(passkeys),
                          ),
                      )
                    : Effect.succeed(passkeys),
            ),
        ),

    deletePasskey: (input) =>
        Effect.gen(function* () {
            const operation = 'passkey.delete';
            const state = yield* withStorageError(
                operation,
                d1.first<{ target: number; total: number }>({
                    sql: `
                        SELECT
                            SUM(CASE WHEN id = ? THEN 1 ELSE 0 END) AS target,
                            COUNT(*) AS total
                        FROM passkeys
                        WHERE user_id = ?
                          AND EXISTS (
                              SELECT 1 FROM users
                              WHERE id = ? AND disabled_at IS NULL
                          )
                    `,
                    bindings: [input.passkeyId, input.userId, input.userId],
                }),
            );
            if (state === null || state.target !== 1) {
                return yield* Effect.fail(new AuthNotFound());
            }
            if (state.total <= 1) {
                return yield* Effect.fail(new AuthConflict());
            }

            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `
                            UPDATE passkeys SET updated_at = ?
                            WHERE id = ? AND user_id = ?
                              AND EXISTS (
                                  SELECT 1 FROM passkeys other
                                  WHERE other.user_id = ? AND other.id <> ?
                              )
                              AND EXISTS (
                                  SELECT 1 FROM users
                                  WHERE id = ? AND disabled_at IS NULL
                              )
                        `,
                        bindings: [
                            input.now,
                            input.passkeyId,
                            input.userId,
                            input.userId,
                            input.passkeyId,
                            input.userId,
                        ],
                    },
                    {
                        sql: `
                            INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, ?, ?, 'passkey.deleted', ?, ?
                            WHERE changes() = 1 AND EXISTS (
                                SELECT 1 FROM passkeys
                                WHERE id = ? AND user_id = ? AND updated_at = ?
                            )
                        `,
                        bindings: [
                            input.eventId,
                            input.userId,
                            input.userId,
                            eventMetadata({ passkeyId: input.passkeyId }),
                            input.now,
                            input.passkeyId,
                            input.userId,
                            input.now,
                        ],
                    },
                    {
                        sql: 'DELETE FROM passkeys WHERE id = ? AND user_id = ? AND updated_at = ?',
                        bindings: [input.passkeyId, input.userId, input.now],
                    },
                ]),
            );
            const counts = yield* Effect.forEach(results, (result) =>
                changes(operation, result),
            );
            if (counts.every((count) => count === 0)) {
                return yield* Effect.fail(new AuthConflict());
            }
            if (!counts.every((count) => count === 1)) {
                return yield* Effect.fail(invariantError(operation));
            }
        }),

    createEnrollmentLink: (input) =>
        Effect.gen(function* () {
            const operation = 'access.createEnrollment';
            const duplicate = yield* withStorageError(
                operation,
                d1.first({
                    sql: `
                        SELECT id FROM users
                        WHERE username = ? COLLATE NOCASE
                           OR email = ? COLLATE NOCASE
                    `,
                    bindings: [input.user.username, input.user.email],
                }),
            );
            if (duplicate !== null) {
                return yield* Effect.fail(new AuthConflict());
            }

            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `
                            INSERT INTO users (
                                id, webauthn_user_handle, username, email,
                                display_name, is_admin, created_at, updated_at
                            )
                            SELECT ?, ?, ?, ?, ?, ?, ?, ?
                            WHERE ${activeAdmin}
                        `,
                        bindings: [
                            input.user.id,
                            input.user.handle,
                            input.user.username,
                            input.user.email,
                            input.user.displayName,
                            input.user.isAdmin ? 1 : 0,
                            input.now,
                            input.now,
                            input.actorUserId,
                        ],
                    },
                    {
                        sql: `
                            INSERT INTO user_access_links (
                                id, user_id, created_by_user_id, purpose,
                                token_hash, expires_at, created_at
                            )
                            SELECT ?, ?, ?, 'enrollment', ?, ?, ?
                            WHERE changes() = 1 AND ${activeAdmin}
                              AND EXISTS (SELECT 1 FROM users WHERE id = ?)
                        `,
                        bindings: [
                            input.linkId,
                            input.user.id,
                            input.actorUserId,
                            input.tokenHash,
                            input.expiresAt,
                            input.now,
                            input.actorUserId,
                            input.user.id,
                        ],
                    },
                    {
                        sql: `
                            INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, ?, ?, 'access.enrollment_created', ?, ?
                            WHERE changes() = 1 AND ${activeAdmin}
                              AND EXISTS (
                                  SELECT 1 FROM user_access_links
                                  WHERE id = ? AND user_id = ?
                              )
                        `,
                        bindings: [
                            input.eventId,
                            input.user.id,
                            input.actorUserId,
                            eventMetadata({ linkId: input.linkId }),
                            input.now,
                            input.actorUserId,
                            input.linkId,
                            input.user.id,
                        ],
                    },
                ]),
            );
            const counts = yield* Effect.forEach(results, (result) =>
                changes(operation, result),
            );
            if (counts.every((count) => count === 0)) {
                return yield* Effect.fail(new Forbidden());
            }
            if (!counts.every((count) => count === 1)) {
                return yield* Effect.fail(invariantError(operation));
            }
        }),

    createRecoveryLink: (input) =>
        Effect.gen(function* () {
            const operation = 'access.createRecovery';
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `
                            INSERT INTO user_access_links (
                                id, user_id, created_by_user_id, purpose,
                                token_hash, expires_at, created_at
                            )
                            SELECT ?, target.id, ?, 'recovery', ?, ?, ?
                            FROM users target
                            WHERE target.id = ? AND target.disabled_at IS NULL
                              AND ${activeAdmin}
                        `,
                        bindings: [
                            input.linkId,
                            input.actorUserId,
                            input.tokenHash,
                            input.expiresAt,
                            input.now,
                            input.targetUserId,
                            input.actorUserId,
                        ],
                    },
                    {
                        sql: `
                            INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, ?, ?, 'access.recovery_created', ?, ?
                            WHERE changes() = 1 AND ${activeAdmin}
                              AND EXISTS (
                                  SELECT 1 FROM user_access_links
                                  WHERE id = ? AND user_id = ?
                              )
                        `,
                        bindings: [
                            input.eventId,
                            input.targetUserId,
                            input.actorUserId,
                            eventMetadata({ linkId: input.linkId }),
                            input.now,
                            input.actorUserId,
                            input.linkId,
                            input.targetUserId,
                        ],
                    },
                ]),
            );
            const counts = yield* Effect.forEach(results, (result) =>
                changes(operation, result),
            );
            if (counts.every((count) => count === 0)) {
                return yield* Effect.fail(new AuthNotFound());
            }
            if (!counts.every((count) => count === 1)) {
                return yield* Effect.fail(invariantError(operation));
            }
        }),

    revokeAccessLink: (input) =>
        Effect.gen(function* () {
            const operation = 'access.revoke';
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `
                            UPDATE user_access_links SET revoked_at = ?
                            WHERE id = ? AND consumed_at IS NULL
                              AND revoked_at IS NULL AND ${activeAdmin}
                        `,
                        bindings: [input.now, input.linkId, input.actorUserId],
                    },
                    {
                        sql: `
                            INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, user_id, ?, 'access.revoked', ?, ?
                            FROM user_access_links
                            WHERE id = ? AND revoked_at = ?
                              AND changes() = 1 AND ${activeAdmin}
                        `,
                        bindings: [
                            input.eventId,
                            input.actorUserId,
                            eventMetadata({ linkId: input.linkId }),
                            input.now,
                            input.linkId,
                            input.now,
                            input.actorUserId,
                        ],
                    },
                ]),
            );
            const counts = yield* Effect.forEach(results, (result) =>
                changes(operation, result),
            );
            if (counts.every((count) => count === 0)) {
                return yield* Effect.fail(new AuthNotFound());
            }
            if (!counts.every((count) => count === 1)) {
                return yield* Effect.fail(invariantError(operation));
            }
        }),

    listAppTokens: (userId) =>
        Effect.gen(function* () {
            const operation = 'appToken.list';
            const active = yield* withStorageError(
                operation,
                d1.first({
                    sql: 'SELECT id FROM users WHERE id = ? AND disabled_at IS NULL',
                    bindings: [userId],
                }),
            );
            if (active === null) {
                return yield* Effect.fail(new Forbidden());
            }
            const result = yield* withStorageError(
                operation,
                d1.all({
                    sql: `
                        SELECT id, name, token_prefix, scopes_json,
                            created_at, last_used_at, expires_at
                        FROM app_tokens
                        WHERE user_id = ? AND revoked_at IS NULL
                        ORDER BY created_at DESC, id DESC
                    `,
                    bindings: [userId],
                }),
            );
            return yield* Effect.forEach(result.results, (value) =>
                Effect.gen(function* () {
                    const row = yield* decode(
                        operation,
                        AppTokenRowSchema,
                        value,
                    );
                    return {
                        id: row.id,
                        name: row.name,
                        prefix: row.token_prefix,
                        scopes: yield* scopes(operation, row.scopes_json),
                        createdAt: row.created_at,
                        lastUsedAt: row.last_used_at,
                        expiresAt: row.expires_at,
                    };
                }),
            );
        }),

    createAppToken: (input) =>
        Effect.gen(function* () {
            const operation = 'appToken.create';
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `
                            INSERT INTO app_tokens (
                                id, user_id, name, token_hash, token_prefix,
                                scopes_json, expires_at, fever_verifier_hash,
                                created_at
                            )
                            SELECT ?, id, ?, ?, ?, ?, ?, ?, ?
                            FROM users
                            WHERE id = ? AND disabled_at IS NULL
                        `,
                        bindings: [
                            input.token.id,
                            input.token.name,
                            input.tokenHash,
                            input.token.prefix,
                            JSON.stringify(input.token.scopes),
                            input.token.expiresAt,
                            input.feverVerifierHash,
                            input.now,
                            input.userId,
                        ],
                    },
                    {
                        sql: `
                            INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, ?, ?, 'app_token.created', ?, ?
                            WHERE changes() = 1 AND EXISTS (
                                SELECT 1 FROM app_tokens
                                WHERE id = ? AND user_id = ?
                            )
                        `,
                        bindings: [
                            input.eventId,
                            input.userId,
                            input.userId,
                            eventMetadata({
                                tokenId: input.token.id,
                                scopes: input.token.scopes,
                            }),
                            input.now,
                            input.token.id,
                            input.userId,
                        ],
                    },
                ]),
            );
            const counts = yield* Effect.forEach(results, (result) =>
                changes(operation, result),
            );
            if (counts.every((count) => count === 0)) {
                return yield* Effect.fail(new Forbidden());
            }
            if (!counts.every((count) => count === 1)) {
                return yield* Effect.fail(invariantError(operation));
            }
        }),

    revokeAppToken: (input) =>
        Effect.gen(function* () {
            const operation = 'appToken.revoke';
            const results = yield* withStorageError(
                operation,
                d1.batch([
                    {
                        sql: `
                            UPDATE app_tokens SET revoked_at = ?
                            WHERE id = ? AND user_id = ? AND revoked_at IS NULL
                              AND EXISTS (
                                  SELECT 1 FROM users
                                  WHERE id = ? AND disabled_at IS NULL
                              )
                        `,
                        bindings: [
                            input.now,
                            input.tokenId,
                            input.userId,
                            input.userId,
                        ],
                    },
                    {
                        sql: `
                            INSERT INTO security_events (
                                id, user_id, actor_user_id, kind,
                                metadata_json, created_at
                            )
                            SELECT ?, ?, ?, 'app_token.revoked', ?, ?
                            WHERE changes() = 1 AND EXISTS (
                                SELECT 1 FROM app_tokens
                                WHERE id = ? AND user_id = ? AND revoked_at = ?
                            )
                        `,
                        bindings: [
                            input.eventId,
                            input.userId,
                            input.userId,
                            eventMetadata({ tokenId: input.tokenId }),
                            input.now,
                            input.tokenId,
                            input.userId,
                            input.now,
                        ],
                    },
                ]),
            );
            const counts = yield* Effect.forEach(results, (result) =>
                changes(operation, result),
            );
            if (counts.every((count) => count === 0)) {
                return yield* Effect.fail(new AuthNotFound());
            }
            if (!counts.every((count) => count === 1)) {
                return yield* Effect.fail(invariantError(operation));
            }
        }),

    authenticateAppToken: (input) =>
        Effect.gen(function* () {
            const operation = 'appToken.authenticate';
            const value = yield* withStorageError(
                operation,
                d1.first({
                    sql: `
                        SELECT t.id AS token_id, t.user_id, u.username,
                            u.display_name, u.is_admin, t.scopes_json,
                            t.last_used_at
                        FROM app_tokens t
                        JOIN users u ON u.id = t.user_id
                        WHERE (? IS NULL OR u.username = ? COLLATE NOCASE)
                          AND t.token_hash = ? AND t.revoked_at IS NULL
                          AND (t.expires_at IS NULL OR t.expires_at > ?)
                          AND u.disabled_at IS NULL
                    `,
                    bindings: [
                        input.username ?? null,
                        input.username ?? null,
                        input.tokenHash,
                        input.now,
                    ],
                }),
            );
            if (value === null) {
                return yield* Effect.fail(new AuthenticationFailed());
            }
            const row = yield* decode(
                operation,
                AppTokenAuthenticationRowSchema,
                value,
            );
            const tokenScopes = yield* scopes(operation, row.scopes_json);
            if (!tokenScopes.includes(input.requiredScope)) {
                return yield* Effect.fail(new AuthenticationFailed());
            }
            if (
                row.last_used_at === null ||
                row.last_used_at <= input.lastUsedThrottleCutoff
            ) {
                yield* withStorageError(
                    operation,
                    d1.run({
                        sql: `
                            UPDATE app_tokens SET last_used_at = ?
                            WHERE id = ? AND revoked_at IS NULL
                              AND (expires_at IS NULL OR expires_at > ?)
                              AND (last_used_at IS NULL OR last_used_at <= ?)
                        `,
                        bindings: [
                            input.now,
                            row.token_id,
                            input.now,
                            input.lastUsedThrottleCutoff,
                        ],
                    }),
                );
            }
            return {
                tokenId: row.token_id,
                user: {
                    id: row.user_id,
                    handle: new Uint8Array(32),
                    username: row.username,
                    email: '',
                    displayName: row.display_name,
                    isAdmin: row.is_admin === 1,
                },
                scopes: tokenScopes,
            };
        }),

    authenticateFeverVerifier: (input) =>
        Effect.gen(function* () {
            const operation = 'appToken.authenticateFever';
            const value = yield* withStorageError(
                operation,
                d1.first({
                    sql: `
                        SELECT t.id AS token_id, t.user_id, u.username,
                            u.display_name, u.is_admin, t.scopes_json,
                            t.last_used_at
                        FROM app_tokens t
                        JOIN users u ON u.id = t.user_id
                        WHERE t.fever_verifier_hash = ?
                          AND t.revoked_at IS NULL
                          AND (t.expires_at IS NULL OR t.expires_at > ?)
                          AND u.disabled_at IS NULL
                    `,
                    bindings: [input.verifierHash, input.now],
                }),
            );
            if (value === null) {
                return yield* Effect.fail(new AuthenticationFailed());
            }
            const row = yield* decode(
                operation,
                AppTokenAuthenticationRowSchema,
                value,
            );
            const tokenScopes = yield* scopes(operation, row.scopes_json);
            if (!tokenScopes.includes('fever')) {
                return yield* Effect.fail(new AuthenticationFailed());
            }
            if (
                row.last_used_at === null ||
                row.last_used_at <= input.lastUsedThrottleCutoff
            ) {
                yield* withStorageError(
                    operation,
                    d1.run({
                        sql: `
                            UPDATE app_tokens SET last_used_at = ?
                            WHERE id = ? AND revoked_at IS NULL
                              AND fever_verifier_hash = ?
                              AND (expires_at IS NULL OR expires_at > ?)
                              AND (last_used_at IS NULL OR last_used_at <= ?)
                        `,
                        bindings: [
                            input.now,
                            row.token_id,
                            input.verifierHash,
                            input.now,
                            input.lastUsedThrottleCutoff,
                        ],
                    }),
                );
            }
            return {
                tokenId: row.token_id,
                user: {
                    id: row.user_id,
                    handle: new Uint8Array(32),
                    username: row.username,
                    email: '',
                    displayName: row.display_name,
                    isAdmin: row.is_admin === 1,
                },
                scopes: tokenScopes,
            };
        }),
});

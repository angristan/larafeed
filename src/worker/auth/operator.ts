import { Effect } from 'effect';

import type { D1, D1Statement } from '../infrastructure/d1';
import type { AuthConfig } from './config';
import {
    generateRandomToken,
    generateSafeId,
    sha256Bytes,
    timingSafeEqual,
} from './crypto';
import {
    AuthConflict,
    AuthInvariantError,
    AuthNotFound,
    AuthStorageError,
    AuthValidationError,
    Forbidden,
} from './errors';

export const OPERATOR_ACCESS_LINK_TTL_MS = 30 * 60 * 1_000;

export interface InitialAdminAccessInput {
    readonly mode: 'initial-admin';
    readonly username: string;
    readonly email: string;
    readonly displayName: string;
}

export interface RecoverAdminAccessInput {
    readonly mode: 'recover-admin';
    readonly userId: number;
}

export type AuthOperatorAccessInput =
    | InitialAdminAccessInput
    | RecoverAdminAccessInput;

export interface AuthOperatorDependencies {
    readonly d1: D1;
    readonly config: AuthConfig;
    readonly operatorSecret: string;
    readonly now?: () => number;
    readonly webCrypto?: Crypto;
}

export interface AuthOperatorAccessLink {
    readonly id: number;
    readonly userId: number;
    readonly purpose: 'enrollment' | 'recovery';
    readonly url: string;
    readonly expiresAt: number;
}

const validName = (value: string, maximum: number): boolean =>
    value.trim() === value && value.length > 0 && value.length <= maximum;

const validSafeId = (value: number): boolean =>
    Number.isSafeInteger(value) && value > 0;

const storageError = (operation: string, cause: unknown) =>
    new AuthStorageError({ operation, cause });

const invariantError = (operation: string) =>
    new AuthInvariantError({ operation });

const batchChanges = (
    operation: string,
    results: readonly D1Result<unknown>[],
): Effect.Effect<readonly number[], AuthInvariantError> =>
    Effect.forEach(results, (result) =>
        typeof result.meta.changes === 'number' && result.meta.changes >= 0
            ? Effect.succeed(result.meta.changes)
            : Effect.fail(invariantError(operation)),
    );

const runBatch = (
    d1: D1,
    operation: string,
    statements: readonly D1Statement[],
) =>
    d1.batch(statements).pipe(
        Effect.mapError((error) => storageError(operation, error)),
        Effect.flatMap((results) => batchChanges(operation, results)),
    );

export const makeAuthOperator = (dependencies: AuthOperatorDependencies) => {
    const {
        d1,
        config,
        operatorSecret,
        webCrypto = globalThis.crypto,
    } = dependencies;
    const currentTime = dependencies.now ?? Date.now;
    const token = () => generateRandomToken(webCrypto);
    const safeId = () => generateSafeId(webCrypto);
    const hash = (value: string | Uint8Array) => sha256Bytes(value, webCrypto);

    const authorize = Effect.fn('auth.operator.authorize')(function* (
        authorizationHeader: string | undefined,
    ) {
        const hasBearerScheme =
            authorizationHeader?.startsWith('Bearer ') === true;
        const suppliedSecret = hasBearerScheme
            ? (authorizationHeader?.slice('Bearer '.length) ?? '')
            : '';
        const [expectedHash, suppliedHash] = yield* Effect.all([
            hash(operatorSecret),
            hash(suppliedSecret),
        ]);

        if (
            !hasBearerScheme ||
            operatorSecret.length === 0 ||
            suppliedSecret.length === 0 ||
            !timingSafeEqual(expectedHash, suppliedHash)
        ) {
            return yield* Effect.fail(new Forbidden());
        }
    });

    const createInitialAdminLink = Effect.fn(
        'auth.operator.createInitialAdmin',
    )(function* (input: InitialAdminAccessInput) {
        if (
            !validName(input.username, 100) ||
            !validName(input.email, 320) ||
            !validName(input.displayName, 200)
        ) {
            return yield* Effect.fail(new AuthValidationError());
        }

        const now = currentTime();
        const expiresAt = now + OPERATOR_ACCESS_LINK_TTL_MS;
        const userId = yield* safeId();
        const linkId = yield* safeId();
        const eventId = yield* safeId();
        const plaintextToken = yield* token();
        const handle = yield* token().pipe(Effect.flatMap(hash));
        const tokenHash = yield* hash(plaintextToken);
        const operation = 'operator.initialAdmin';
        const counts = yield* runBatch(d1, operation, [
            {
                sql: `
                    INSERT INTO users (
                        id, webauthn_user_handle, username, email,
                        display_name, is_admin, created_at, updated_at
                    )
                    SELECT ?, ?, ?, ?, ?, 1, ?, ?
                    WHERE NOT EXISTS (SELECT 1 FROM users)
                `,
                bindings: [
                    userId,
                    handle,
                    input.username,
                    input.email,
                    input.displayName,
                    now,
                    now,
                ],
            },
            {
                sql: `
                    INSERT INTO user_access_links (
                        id, user_id, purpose, token_hash,
                        expires_at, created_at
                    )
                    SELECT ?, ?, 'enrollment', ?, ?, ?
                    WHERE changes() = 1
                      AND EXISTS (
                          SELECT 1 FROM users
                          WHERE id = ? AND is_admin = 1
                            AND disabled_at IS NULL
                      )
                `,
                bindings: [linkId, userId, tokenHash, expiresAt, now, userId],
            },
            {
                sql: `
                    INSERT INTO security_events (
                        id, user_id, kind, metadata_json, created_at
                    )
                    SELECT ?, ?,
                        'operator.initial_admin_enrollment_created', ?, ?
                    WHERE changes() = 1
                      AND EXISTS (
                          SELECT 1 FROM user_access_links
                          WHERE id = ? AND user_id = ?
                            AND purpose = 'enrollment'
                      )
                `,
                bindings: [
                    eventId,
                    userId,
                    JSON.stringify({ linkId }),
                    now,
                    linkId,
                    userId,
                ],
            },
        ]);

        if (counts.length !== 3) {
            return yield* Effect.fail(invariantError(operation));
        }
        if (counts.every((count) => count === 0)) {
            return yield* Effect.fail(new AuthConflict());
        }
        if (!counts.every((count) => count === 1)) {
            return yield* Effect.fail(invariantError(operation));
        }

        return {
            id: linkId,
            userId,
            purpose: 'enrollment',
            url: `${config.origin}/auth/enroll#token=${encodeURIComponent(plaintextToken)}`,
            expiresAt,
        } satisfies AuthOperatorAccessLink;
    });

    const createRecoveryLink = Effect.fn('auth.operator.createRecovery')(
        function* (input: RecoverAdminAccessInput) {
            if (!validSafeId(input.userId)) {
                return yield* Effect.fail(new AuthValidationError());
            }

            const now = currentTime();
            const expiresAt = now + OPERATOR_ACCESS_LINK_TTL_MS;
            const linkId = yield* safeId();
            const eventId = yield* safeId();
            const plaintextToken = yield* token();
            const tokenHash = yield* hash(plaintextToken);
            const operation = 'operator.recoverAdmin';
            const counts = yield* runBatch(d1, operation, [
                {
                    sql: `
                        INSERT INTO user_access_links (
                            id, user_id, purpose, token_hash,
                            expires_at, created_at
                        )
                        SELECT ?, id, 'recovery', ?, ?, ?
                        FROM users
                        WHERE id = ? AND is_admin = 1
                          AND disabled_at IS NULL
                    `,
                    bindings: [linkId, tokenHash, expiresAt, now, input.userId],
                },
                {
                    sql: `
                        INSERT INTO security_events (
                            id, user_id, kind, metadata_json, created_at
                        )
                        SELECT ?, ?, 'operator.admin_recovery_created', ?, ?
                        WHERE changes() = 1
                          AND EXISTS (
                              SELECT 1 FROM user_access_links
                              WHERE id = ? AND user_id = ?
                                AND purpose = 'recovery'
                          )
                    `,
                    bindings: [
                        eventId,
                        input.userId,
                        JSON.stringify({ linkId }),
                        now,
                        linkId,
                        input.userId,
                    ],
                },
            ]);

            if (counts.length !== 2) {
                return yield* Effect.fail(invariantError(operation));
            }
            if (counts.every((count) => count === 0)) {
                return yield* Effect.fail(new AuthNotFound());
            }
            if (!counts.every((count) => count === 1)) {
                return yield* Effect.fail(invariantError(operation));
            }

            return {
                id: linkId,
                userId: input.userId,
                purpose: 'recovery',
                url: `${config.origin}/auth/recover#token=${encodeURIComponent(plaintextToken)}`,
                expiresAt,
            } satisfies AuthOperatorAccessLink;
        },
    );

    const createAccessLink = Effect.fn('auth.operator.createAccessLink')(
        function* (
            authorizationHeader: string | undefined,
            input: AuthOperatorAccessInput,
        ) {
            yield* authorize(authorizationHeader);

            switch (input.mode) {
                case 'initial-admin':
                    return yield* createInitialAdminLink(input);
                case 'recover-admin':
                    return yield* createRecoveryLink(input);
                default:
                    return yield* Effect.fail(new AuthValidationError());
            }
        },
    );

    return { createAccessLink };
};

export type AuthOperator = ReturnType<typeof makeAuthOperator>;

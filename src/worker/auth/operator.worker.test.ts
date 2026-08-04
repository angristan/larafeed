import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import type { AuthConfig } from './config';
import { sha256Bytes } from './crypto';
import { AuthConflict, AuthNotFound, Forbidden } from './errors';
import { makeAuthOperator, OPERATOR_ACCESS_LINK_TTL_MS } from './operator';

const now = 2_100_200_000_000;
const operatorSecret = 'operator-secret-only-from-a-worker-secret';
const authorization = `Bearer ${operatorSecret}`;
const d1 = makeD1(env.DB);

const config: AuthConfig = {
    environment: 'test',
    rpId: 'larafeed-test.stanislas.cloud',
    origin: 'https://larafeed-test.stanislas.cloud',
    rpName: 'Larafeed Test',
    challengeTtlMs: 300_000,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1_000,
    turnstileSiteKey: 'site-key',
    turnstileSecretKey: 'turnstile-secret-key',
    sessionCookie: {
        name: '__Host-larafeed-test-session',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
    },
    csrfCookie: {
        name: '__Host-larafeed-test-csrf',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
        path: '/',
    },
};

const operator = () =>
    makeAuthOperator({
        d1,
        config,
        operatorSecret,
        now: () => now,
    });

const bytes = (value: number) => new Uint8Array(32).fill(value);

const insertUser = (
    id: number,
    suffix: string,
    options: { readonly admin?: boolean; readonly disabled?: boolean } = {},
) =>
    d1.run({
        sql: `
            INSERT INTO users (
                id, webauthn_user_handle, username, email, display_name,
                is_admin, disabled_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        bindings: [
            id,
            bytes(id % 255),
            `operator-${suffix}`,
            `operator-${suffix}@example.test`,
            `Operator ${suffix}`,
            options.admin === true ? 1 : 0,
            options.disabled === true ? now : null,
            now,
            now,
        ],
    });

const accessToken = (url: string): string => {
    const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
    if (token === null) {
        throw new Error('Expected fragment access token');
    }
    return token;
};

const asBytes = (value: unknown): Uint8Array => {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) {
        return Uint8Array.from(value as number[]);
    }
    throw new Error('Expected D1 BLOB');
};

const rowCount = (table: 'security_events' | 'user_access_links' | 'users') =>
    env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<number>(
        'count',
    );

beforeEach(async () => {
    await env.DB.batch([
        env.DB.prepare('DELETE FROM security_events'),
        env.DB.prepare('DELETE FROM users'),
    ]);
});

describe('authentication operator', () => {
    it('creates the first enabled admin and stores only its enrollment token hash', async () => {
        const result = await Effect.runPromise(
            operator().createAccessLink(authorization, {
                mode: 'initial-admin',
                username: 'initial-admin',
                email: 'initial-admin@example.test',
                displayName: 'Initial Admin',
            }),
        );
        const plaintextToken = accessToken(result.url);
        const expectedHash = await Effect.runPromise(
            sha256Bytes(plaintextToken),
        );

        expect(result).toMatchObject({
            purpose: 'enrollment',
            expiresAt: now + OPERATOR_ACCESS_LINK_TTL_MS,
        });
        expect(result.url).toBe(
            `${config.origin}/auth/enroll#token=${encodeURIComponent(plaintextToken)}`,
        );

        const user = await env.DB.prepare(
            `SELECT id, webauthn_user_handle, is_admin, disabled_at
             FROM users WHERE id = ?`,
        )
            .bind(result.userId)
            .first<{
                id: number;
                webauthn_user_handle: unknown;
                is_admin: number;
                disabled_at: number | null;
            }>();
        expect(user?.id).toBe(result.userId);
        expect(asBytes(user?.webauthn_user_handle)).toHaveLength(32);
        expect(user?.is_admin).toBe(1);
        expect(user?.disabled_at).toBeNull();

        const link = await env.DB.prepare(
            `SELECT token_hash, typeof(token_hash) AS storage_type,
                    purpose, expires_at, consumed_at, revoked_at
             FROM user_access_links WHERE id = ?`,
        )
            .bind(result.id)
            .first<{
                token_hash: unknown;
                storage_type: string;
                purpose: string;
                expires_at: number;
                consumed_at: number | null;
                revoked_at: number | null;
            }>();
        expect(link?.storage_type).toBe('blob');
        expect(asBytes(link?.token_hash)).toEqual(expectedHash);
        expect(link).toMatchObject({
            purpose: 'enrollment',
            expires_at: now + OPERATOR_ACCESS_LINK_TTL_MS,
            consumed_at: null,
            revoked_at: null,
        });
        expect(
            await env.DB.prepare(
                `SELECT instr(CAST(token_hash AS TEXT), ?) AS contains_plaintext
                 FROM user_access_links WHERE id = ?`,
            )
                .bind(plaintextToken, result.id)
                .first<number>('contains_plaintext'),
        ).toBe(0);

        const event = await env.DB.prepare(
            `SELECT actor_user_id, kind, metadata_json
             FROM security_events WHERE user_id = ?`,
        )
            .bind(result.userId)
            .first<{
                actor_user_id: number | null;
                kind: string;
                metadata_json: string;
            }>();
        expect(event).toMatchObject({
            actor_user_id: null,
            kind: 'operator.initial_admin_enrollment_created',
            metadata_json: JSON.stringify({ linkId: result.id }),
        });
        expect(event?.metadata_json).not.toContain(operatorSecret);
        expect(event?.metadata_json).not.toContain(plaintextToken);
    });

    it('rejects initial administration after any user exists', async () => {
        await Effect.runPromise(insertUser(8_200_001, 'existing'));

        await expect(
            Effect.runPromise(
                operator().createAccessLink(authorization, {
                    mode: 'initial-admin',
                    username: 'too-late',
                    email: 'too-late@example.test',
                    displayName: 'Too Late',
                }),
            ),
        ).rejects.toBeInstanceOf(AuthConflict);
        expect(await rowCount('users')).toBe(1);
        expect(await rowCount('user_access_links')).toBe(0);
        expect(await rowCount('security_events')).toBe(0);
    });

    it('creates a hash-only recovery link for an existing enabled admin', async () => {
        const adminId = 8_200_011;
        await Effect.runPromise(
            insertUser(adminId, 'recoverable', { admin: true }),
        );

        const result = await Effect.runPromise(
            operator().createAccessLink(authorization, {
                mode: 'recover-admin',
                userId: adminId,
            }),
        );
        const plaintextToken = accessToken(result.url);
        const expectedHash = await Effect.runPromise(
            sha256Bytes(plaintextToken),
        );
        const link = await env.DB.prepare(
            `SELECT user_id, purpose, token_hash, expires_at
             FROM user_access_links WHERE id = ?`,
        )
            .bind(result.id)
            .first<{
                user_id: number;
                purpose: string;
                token_hash: unknown;
                expires_at: number;
            }>();

        expect(result).toEqual({
            id: result.id,
            userId: adminId,
            purpose: 'recovery',
            url: `${config.origin}/auth/recover#token=${encodeURIComponent(plaintextToken)}`,
            expiresAt: now + OPERATOR_ACCESS_LINK_TTL_MS,
        });
        expect(link).toMatchObject({
            user_id: adminId,
            purpose: 'recovery',
            expires_at: now + OPERATOR_ACCESS_LINK_TTL_MS,
        });
        expect(asBytes(link?.token_hash)).toEqual(expectedHash);

        const event = await env.DB.prepare(
            `SELECT actor_user_id, kind, metadata_json
             FROM security_events WHERE user_id = ?`,
        )
            .bind(adminId)
            .first<{
                actor_user_id: number | null;
                kind: string;
                metadata_json: string;
            }>();
        expect(event).toMatchObject({
            actor_user_id: null,
            kind: 'operator.admin_recovery_created',
            metadata_json: JSON.stringify({ linkId: result.id }),
        });
        expect(event?.metadata_json).not.toContain(operatorSecret);
        expect(event?.metadata_json).not.toContain(plaintextToken);
    });

    it('rejects recovery for non-admin and disabled admin users', async () => {
        const nonAdminId = 8_200_021;
        const disabledAdminId = 8_200_022;
        await Effect.runPromise(insertUser(nonAdminId, 'non-admin'));
        await Effect.runPromise(
            insertUser(disabledAdminId, 'disabled-admin', {
                admin: true,
                disabled: true,
            }),
        );

        for (const userId of [nonAdminId, disabledAdminId]) {
            await expect(
                Effect.runPromise(
                    operator().createAccessLink(authorization, {
                        mode: 'recover-admin',
                        userId,
                    }),
                ),
            ).rejects.toBeInstanceOf(AuthNotFound);
        }
        expect(await rowCount('user_access_links')).toBe(0);
        expect(await rowCount('security_events')).toBe(0);
    });

    it('rejects malformed and incorrect bearer secrets without writes', async () => {
        const input = {
            mode: 'initial-admin' as const,
            username: 'unauthorized',
            email: 'unauthorized@example.test',
            displayName: 'Unauthorized',
        };

        for (const header of [
            undefined,
            operatorSecret,
            `bearer ${operatorSecret}`,
            `Bearer ${operatorSecret} `,
            'Bearer incorrect-secret',
        ]) {
            await expect(
                Effect.runPromise(operator().createAccessLink(header, input)),
            ).rejects.toBeInstanceOf(Forbidden);
        }
        expect(await rowCount('users')).toBe(0);
    });

    it('allows only one winner across concurrent initial-admin batches', async () => {
        const attempts = await Promise.allSettled([
            Effect.runPromise(
                operator().createAccessLink(authorization, {
                    mode: 'initial-admin',
                    username: 'race-one',
                    email: 'race-one@example.test',
                    displayName: 'Race One',
                }),
            ),
            Effect.runPromise(
                operator().createAccessLink(authorization, {
                    mode: 'initial-admin',
                    username: 'race-two',
                    email: 'race-two@example.test',
                    displayName: 'Race Two',
                }),
            ),
        ]);

        expect(
            attempts.filter((attempt) => attempt.status === 'fulfilled'),
        ).toHaveLength(1);
        const rejected = attempts.find(
            (attempt) => attempt.status === 'rejected',
        );
        expect(rejected).toMatchObject({
            status: 'rejected',
            reason: expect.any(AuthConflict),
        });
        expect(await rowCount('users')).toBe(1);
        expect(await rowCount('user_access_links')).toBe(1);
        expect(await rowCount('security_events')).toBe(1);
    });
});

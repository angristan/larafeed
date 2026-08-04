import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { AuthConfig } from '../auth/config';
import { md5Hex, sha256Bytes } from '../auth/crypto';
import { AuthenticationFailed } from '../auth/errors';
import { makeAuthRepository } from '../auth/repository';
import { makeAuthService } from '../auth/service';
import type { TurnstileValidator } from '../auth/turnstile';
import type { WebAuthn } from '../auth/webauthn';
import { makeD1 } from '../infrastructure/d1';

const d1 = makeD1(env.DB);
const repository = makeAuthRepository(d1);
const now = 1_920_000_000_000;
const bytes = (value: number) => new Uint8Array(32).fill(value % 251 || 1);
const config = {
    environment: 'test',
    rpId: 'example.test',
    origin: 'https://example.test',
    rpName: 'Larafeed Test',
    challengeTtlMs: 300_000,
    sessionTtlMs: 3_600_000,
    sessionCookie: {},
    csrfCookie: {},
} as AuthConfig;
const service = makeAuthService({
    repository,
    webAuthn: {} as WebAuthn,
    turnstile: {} as TurnstileValidator,
    config,
    now: () => now,
});

const insertUser = (id: number, username: string, disabled = false) =>
    d1.run({
        sql: `INSERT INTO users (
            id, webauthn_user_handle, username, email, display_name,
            disabled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        bindings: [
            id,
            bytes(id),
            username,
            `${username}@example.test`,
            username,
            disabled ? now - 1 : null,
            now - 1_000,
            now,
        ],
    });

const insertToken = async (input: {
    readonly id: number;
    readonly userId: number;
    readonly username: string;
    readonly plaintext: string;
    readonly scopes: readonly ('google-reader' | 'fever')[];
    readonly expired?: boolean;
    readonly revoked?: boolean;
}) => {
    const apiKey = md5Hex(`${input.username}:${input.plaintext}`);
    await Effect.runPromise(
        d1.run({
            sql: `INSERT INTO app_tokens (
                id, user_id, name, token_hash, token_prefix, scopes_json,
                fever_verifier_hash, expires_at, revoked_at, created_at
            ) VALUES (?, ?, 'Compatibility', ?, 'prefix', ?, ?, ?, ?, ?)`,
            bindings: [
                input.id,
                input.userId,
                await Effect.runPromise(sha256Bytes(input.plaintext)),
                JSON.stringify(input.scopes),
                await Effect.runPromise(sha256Bytes(apiKey)),
                input.expired ? now - 1 : null,
                input.revoked ? now - 1 : null,
                now - 1_000,
            ],
        }),
    );
    return apiKey;
};

describe('compatibility app-token authentication', () => {
    it('stores only SHA-256 Fever verifier material and honors revocation', async () => {
        const userId = 7_310_001;
        await Effect.runPromise(insertUser(userId, 'fever-hash-owner'));
        const session = {
            sessionId: 1,
            user: {
                id: userId,
                username: 'fever-hash-owner',
                displayName: 'Fever Hash Owner',
                isAdmin: false,
            },
            expiresAt: now + 1_000,
            csrfTokenHash: bytes(1),
        };
        const created = await Effect.runPromise(
            service.createAppToken(session, {
                name: 'Reeder',
                scopes: ['google-reader', 'fever'],
            }),
        );
        const apiKey = md5Hex(
            `${session.user.username}:${created.plaintextToken}`,
        );
        const stored = await env.DB.prepare(
            `SELECT id, token_hash, fever_verifier_hash,
                typeof(fever_verifier_hash) AS verifier_type
             FROM app_tokens WHERE user_id = ?`,
        )
            .bind(userId)
            .first<{
                id: number;
                token_hash: ArrayBuffer;
                fever_verifier_hash: ArrayBuffer;
                verifier_type: string;
            }>();

        expect(stored?.verifier_type).toBe('blob');
        const verifier = new Uint8Array(
            stored?.fever_verifier_hash ?? new ArrayBuffer(0),
        );
        expect(verifier).toHaveLength(32);
        expect(verifier).not.toEqual(new TextEncoder().encode(apiKey));
        await expect(
            Effect.runPromise(service.authenticateFeverApiKey(apiKey)),
        ).resolves.toMatchObject({ tokenId: stored?.id, user: { id: userId } });
        await expect(
            Effect.runPromise(
                service.authenticateAppTokenCredential({
                    plaintextToken: created.plaintextToken,
                    requiredScope: 'google-reader',
                }),
            ),
        ).resolves.toMatchObject({ tokenId: stored?.id });

        await Effect.runPromise(
            d1.run({
                sql: 'UPDATE app_tokens SET revoked_at = ? WHERE id = ?',
                bindings: [now, stored?.id],
            }),
        );
        await expect(
            Effect.runPromise(service.authenticateFeverApiKey(apiKey)),
        ).rejects.toBeInstanceOf(AuthenticationFailed);
        await expect(
            Effect.runPromise(
                service.authenticateAppTokenCredential({
                    plaintextToken: created.plaintextToken,
                    requiredScope: 'google-reader',
                }),
            ),
        ).rejects.toBeInstanceOf(AuthenticationFailed);
    });

    it('rejects wrong scopes, expired tokens, and disabled owners', async () => {
        const cases = [
            {
                userId: 7_320_001,
                tokenId: 7_321_001,
                username: 'google-scope-owner',
                scopes: ['google-reader'] as const,
                feverAllowed: false,
                googleAllowed: true,
            },
            {
                userId: 7_320_004,
                tokenId: 7_321_004,
                username: 'fever-scope-owner',
                scopes: ['fever'] as const,
                feverAllowed: true,
                googleAllowed: false,
            },
            {
                userId: 7_320_002,
                tokenId: 7_321_002,
                username: 'expired-owner',
                scopes: ['google-reader', 'fever'] as const,
                expired: true,
                feverAllowed: false,
                googleAllowed: false,
            },
            {
                userId: 7_320_003,
                tokenId: 7_321_003,
                username: 'disabled-owner',
                scopes: ['google-reader', 'fever'] as const,
                disabled: true,
                feverAllowed: false,
                googleAllowed: false,
            },
        ];

        for (const item of cases) {
            await Effect.runPromise(
                insertUser(item.userId, item.username, item.disabled),
            );
            const plaintext = `token-${item.tokenId}`;
            const apiKey = await insertToken({
                id: item.tokenId,
                userId: item.userId,
                username: item.username,
                plaintext,
                scopes: item.scopes,
                expired: item.expired,
            });
            const feverAttempt = expect(
                Effect.runPromise(service.authenticateFeverApiKey(apiKey)),
            );
            if (item.feverAllowed) {
                await feverAttempt.resolves.toMatchObject({
                    tokenId: item.tokenId,
                });
            } else {
                await feverAttempt.rejects.toBeInstanceOf(AuthenticationFailed);
            }

            const googleAttempt = expect(
                Effect.runPromise(
                    service.authenticateAppTokenCredential({
                        plaintextToken: plaintext,
                        requiredScope: 'google-reader',
                    }),
                ),
            );
            if (item.googleAllowed) {
                await googleAttempt.resolves.toMatchObject({
                    tokenId: item.tokenId,
                });
            } else {
                await googleAttempt.rejects.toBeInstanceOf(
                    AuthenticationFailed,
                );
            }
        }
    });
});

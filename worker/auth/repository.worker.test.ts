import { env } from 'cloudflare:workers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeD1 } from '../infrastructure/d1';
import { sha256Bytes } from './crypto';
import { AuthenticationFailed } from './errors';
import { makeAuthRepository } from './repository';

const d1 = makeD1(env.DB);
const repository = makeAuthRepository(d1);
const now = 2_100_000_000_000;

const bytes = (value: number) => new Uint8Array(32).fill(value);

const insertUser = (id: number, suffix: string, isAdmin = false) =>
    d1.run({
        sql: `
            INSERT INTO users (
                id, webauthn_user_handle, username, email, display_name,
                is_admin, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        bindings: [
            id,
            bytes(id % 255),
            `auth-${suffix}`,
            `auth-${suffix}@example.test`,
            `Auth ${suffix}`,
            isAdmin ? 1 : 0,
            now,
            now,
        ],
    });

const insertPasskey = (id: number, userId: number, credentialId: Uint8Array) =>
    d1.run({
        sql: `
            INSERT INTO passkeys (
                id, user_id, credential_id, public_key, sign_count,
                transports_json, name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 0, '["internal"]', ?, ?, ?)
        `,
        bindings: [
            id,
            userId,
            credentialId,
            bytes((id + 1) % 255),
            'Primary',
            now,
            now,
        ],
    });

describe('authentication D1 repository', () => {
    it('stores only challenge hashes and atomically rejects replay races', async () => {
        const userId = 8_100_001;
        const passkeyId = 8_100_002;
        const challengeId = 8_100_003;
        const credentialId = new Uint8Array([11, 12, 13, 14]);
        const plaintextChallenge = 'never-store-this-challenge';
        const challengeHash = await Effect.runPromise(
            sha256Bytes(plaintextChallenge),
        );

        await Effect.runPromise(insertUser(userId, 'race'));
        await Effect.runPromise(insertPasskey(passkeyId, userId, credentialId));
        await Effect.runPromise(
            repository.issueAuthenticationChallenge({
                id: challengeId,
                challengeHash,
                rpId: 'larafeed-test.stanislas.cloud',
                origin: 'https://larafeed-test.stanislas.cloud',
                now,
                expiresAt: now + 300_000,
            }),
        );

        const stored = await env.DB.prepare(
            `SELECT challenge_hash, typeof(challenge_hash) AS storage_type
             FROM webauthn_challenges WHERE id = ?`,
        )
            .bind(challengeId)
            .first<{ challenge_hash: ArrayBuffer; storage_type: string }>();
        expect(stored?.storage_type).toBe('blob');
        expect(
            new Uint8Array(stored?.challenge_hash ?? new ArrayBuffer(0)),
        ).toEqual(challengeHash);
        expect(
            await env.DB.prepare(
                `SELECT instr(CAST(challenge_hash AS TEXT), ?) AS contains_plaintext
                 FROM webauthn_challenges WHERE id = ?`,
            )
                .bind(plaintextChallenge, challengeId)
                .first<number>('contains_plaintext'),
        ).toBe(0);

        const attempts = await Promise.allSettled([
            Effect.runPromise(
                repository.consumeAuthenticationChallenge({
                    challengeId,
                    credentialId,
                    now: now + 1,
                }),
            ),
            Effect.runPromise(
                repository.consumeAuthenticationChallenge({
                    challengeId,
                    credentialId,
                    now: now + 1,
                }),
            ),
        ]);

        expect(
            attempts.filter(({ status }) => status === 'fulfilled'),
        ).toHaveLength(1);
        const rejected = attempts.find(({ status }) => status === 'rejected');
        expect(rejected).toMatchObject({
            status: 'rejected',
            reason: expect.any(AuthenticationFailed),
        });
    });

    it('atomically consumes recovery and revokes prior sessions', async () => {
        const userId = 8_100_031;
        const passkeyId = 8_100_032;
        const oldSessionId = 8_100_033;
        const linkId = 8_100_034;
        const challengeId = 8_100_035;
        const newPasskeyId = 8_100_036;
        const newSessionId = 8_100_037;
        const eventId = 8_100_038;
        const linkToken = 'one-time-recovery-token';
        const linkTokenHash = await Effect.runPromise(sha256Bytes(linkToken));
        const challengeHash = await Effect.runPromise(
            sha256Bytes('recovery-challenge'),
        );

        await Effect.runPromise(insertUser(userId, 'recovery'));
        await Effect.runPromise(
            insertPasskey(passkeyId, userId, new Uint8Array([31, 32])),
        );
        await Effect.runPromise(
            d1.run({
                sql: `
                    INSERT INTO sessions (
                        id, user_id, token_hash, csrf_token_hash, expires_at,
                        last_seen_at, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
                bindings: [
                    oldSessionId,
                    userId,
                    bytes(41),
                    bytes(42),
                    now + 1_000_000,
                    now,
                    now,
                ],
            }),
        );
        await Effect.runPromise(
            d1.run({
                sql: `
                    INSERT INTO user_access_links (
                        id, user_id, purpose, token_hash, expires_at, created_at
                    ) VALUES (?, ?, 'recovery', ?, ?, ?)
                `,
                bindings: [linkId, userId, linkTokenHash, now + 300_000, now],
            }),
        );
        const access = await Effect.runPromise(
            repository.findAccessContext({ tokenHash: linkTokenHash, now }),
        );
        await Effect.runPromise(
            repository.issueAccessChallenge({
                id: challengeId,
                context: access,
                challengeHash,
                rpId: 'larafeed-test.stanislas.cloud',
                origin: 'https://larafeed-test.stanislas.cloud',
                now,
                expiresAt: now + 300_000,
            }),
        );
        const context = await Effect.runPromise(
            repository.consumeRegistrationChallenge({
                challengeId,
                accessTokenHash: linkTokenHash,
                now: now + 1,
            }),
        );
        await Effect.runPromise(
            repository.completeRegistration({
                context,
                accessTokenHash: linkTokenHash,
                passkey: {
                    id: newPasskeyId,
                    credentialId: new Uint8Array([33, 34]),
                    publicKey: new Uint8Array([35, 36]),
                    signCount: 0,
                    transports: ['internal'],
                    aaguid: null,
                    name: 'Recovered',
                    backedUp: true,
                },
                session: {
                    id: newSessionId,
                    tokenHash: bytes(43),
                    csrfTokenHash: bytes(44),
                    expiresAt: now + 2_000_000,
                },
                eventId,
                now: now + 2,
            }),
        );

        const sessions = await env.DB.prepare(
            `SELECT id, revoked_at FROM sessions
             WHERE user_id = ? ORDER BY id`,
        )
            .bind(userId)
            .all<{ id: number; revoked_at: number | null }>();
        expect(sessions.results).toEqual([
            { id: oldSessionId, revoked_at: now + 2 },
            { id: newSessionId, revoked_at: null },
        ]);
        expect(
            await env.DB.prepare(
                'SELECT consumed_at FROM user_access_links WHERE id = ?',
            )
                .bind(linkId)
                .first<number>('consumed_at'),
        ).toBe(now + 2);
    });

    it('stores app-token hashes and secret-free security events', async () => {
        const userId = 8_100_011;
        const tokenId = 8_100_012;
        const eventId = 8_100_013;
        const plaintextToken = 'plaintext-app-token-that-is-returned-once';
        const tokenHash = await Effect.runPromise(sha256Bytes(plaintextToken));

        await Effect.runPromise(insertUser(userId, 'token'));
        await Effect.runPromise(
            repository.createAppToken({
                userId,
                token: {
                    id: tokenId,
                    name: 'Reader client',
                    prefix: plaintextToken.slice(0, 10),
                    scopes: ['google-reader', 'fever'],
                    createdAt: now,
                    lastUsedAt: null,
                    expiresAt: null,
                },
                tokenHash,
                eventId,
                now,
            }),
        );

        const stored = await env.DB.prepare(
            `SELECT token_hash, typeof(token_hash) AS storage_type
             FROM app_tokens WHERE id = ?`,
        )
            .bind(tokenId)
            .first<{ token_hash: ArrayBuffer; storage_type: string }>();
        expect(stored?.storage_type).toBe('blob');
        expect(
            new Uint8Array(stored?.token_hash ?? new ArrayBuffer(0)),
        ).toEqual(tokenHash);

        const event = await env.DB.prepare(
            'SELECT metadata_json FROM security_events WHERE id = ?',
        )
            .bind(eventId)
            .first<{ metadata_json: string }>();
        expect(event?.metadata_json).not.toContain(plaintextToken);
        expect(event?.metadata_json).not.toContain(
            Array.from(tokenHash).join(','),
        );
    });
});

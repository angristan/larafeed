import type { AppTokenScope, AuthUser } from '@shared/schemas/auth';
import { Effect } from 'effect';

import type { AuthConfig, AuthCookieConfig } from './config';
import {
    generateRandomToken,
    generateSafeId,
    md5Hex,
    sha256Bytes,
    timingSafeEqual,
} from './crypto';
import {
    AccessLinkInvalid,
    AuthenticationFailed,
    AuthValidationError,
    CsrfInvalid,
    Forbidden,
    Unauthenticated,
} from './errors';
import type {
    AccessContext,
    AppTokenAuthentication,
    AppTokenRecord,
    AuthRepository,
    AuthUserRecord,
    NewPasskey,
    NewSession,
    PasskeyRecord,
} from './repository';
import type { TurnstileValidator } from './turnstile';
import type { VerifiedRegistration, WebAuthn } from './webauthn';

export const SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1_000;
export const SESSION_LAST_SEEN_THROTTLE_MS = 15 * 60 * 1_000;
export const ACCESS_LINK_TTL_MS = 30 * 60 * 1_000;
export const APP_TOKEN_LAST_USED_THROTTLE_MS = 15 * 60 * 1_000;

export const TURNSTILE_ACTIONS = {
    authenticationOptions: 'authentication_options',
    authenticationVerify: 'authentication_verify',
    accessRegistrationOptions: 'registration_options',
    accessRegistrationVerify: 'registration_verify',
    passkeyRegistrationOptions: 'registration_options',
    passkeyRegistrationVerify: 'registration_verify',
} as const;

export interface CookieValue {
    readonly name: string;
    readonly value: string;
    readonly httpOnly: boolean;
    readonly secure: boolean;
    readonly sameSite: 'Lax';
    readonly path: '/';
    readonly expiresAt: number;
}

export interface SessionCookieMaterial {
    readonly session: CookieValue;
    readonly csrf: CookieValue;
}

export interface AuthenticatedSession {
    readonly sessionId: number;
    readonly user: AuthUser;
    readonly expiresAt: number;
    /** Internal verifier material. HTTP adapters must not serialize this field. */
    readonly csrfTokenHash: Uint8Array;
}

export interface AuthenticationResult {
    readonly user: AuthUser;
    readonly expiresAt: number;
    readonly cookies: SessionCookieMaterial;
}

export interface AppTokenAuthenticationResult {
    readonly tokenId: number;
    readonly user: AuthUser;
    readonly scopes: readonly AppTokenScope[];
}

export interface MutationRequestMetadata {
    readonly method: string;
    readonly origin?: string;
    readonly contentType?: string;
    readonly csrfCookieToken?: string;
    readonly csrfHeaderToken?: string;
}

export interface AuthServiceDependencies {
    readonly repository: AuthRepository;
    readonly webAuthn: WebAuthn;
    readonly turnstile: TurnstileValidator;
    readonly config: AuthConfig;
    readonly now?: () => number;
    readonly webCrypto?: Crypto;
}

const authUser = (user: AuthUserRecord): AuthUser => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
});

const challenge = (
    options: Record<string, unknown>,
): Effect.Effect<string, AuthValidationError> => {
    const value = options.challenge;
    return typeof value === 'string' && value.length > 0
        ? Effect.succeed(value)
        : Effect.fail(new AuthValidationError());
};

const cookie = (
    config: AuthCookieConfig,
    value: string,
    expiresAt: number,
): CookieValue => ({
    ...config,
    value,
    expiresAt,
});

const passkeyResponse = (passkey: PasskeyRecord) => ({
    id: passkey.id,
    name: passkey.name,
    transports: [...passkey.transports],
    backedUp: passkey.backedUp,
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt,
});

const appTokenResponse = (token: AppTokenRecord) => ({
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: [...token.scopes],
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
});

const requireAdmin = (
    session: AuthenticatedSession,
): Effect.Effect<void, Forbidden> =>
    session.user.isAdmin ? Effect.void : Effect.fail(new Forbidden());

const validName = (value: string, maximum: number): boolean =>
    value.trim() === value && value.length > 0 && value.length <= maximum;

const registrationOptions = (
    webAuthn: WebAuthn,
    config: AuthConfig,
    context: AccessContext,
) =>
    webAuthn.registrationOptions({
        rpId: config.rpId,
        rpName: config.rpName,
        user: {
            handle: context.user.handle,
            username: context.user.username,
            displayName: context.user.displayName,
        },
        excludeCredentials: context.passkeys.map((passkey) => ({
            credentialId: passkey.credentialId,
            transports: passkey.transports,
        })),
    });

const verifiedPasskey = (
    id: number,
    name: string,
    verified: VerifiedRegistration,
): NewPasskey => ({
    id,
    name,
    credentialId: verified.credentialId,
    publicKey: verified.publicKey,
    signCount: verified.signCount,
    transports: verified.transports,
    aaguid: verified.aaguid,
    backedUp: verified.backedUp,
});

export const makeAuthService = (dependencies: AuthServiceDependencies) => {
    const {
        repository,
        webAuthn,
        turnstile,
        config,
        webCrypto = globalThis.crypto,
    } = dependencies;
    const currentTime = dependencies.now ?? Date.now;

    const safeId = () => generateSafeId(webCrypto);
    const token = () => generateRandomToken(webCrypto);
    const hash = (value: string | Uint8Array) => sha256Bytes(value, webCrypto);

    const makeSession = Effect.fn('auth.session.material')(function* (
        now: number,
    ) {
        const sessionToken = yield* token();
        const csrfToken = yield* token();
        const session: NewSession = {
            id: yield* safeId(),
            tokenHash: yield* hash(sessionToken),
            csrfTokenHash: yield* hash(csrfToken),
            expiresAt: now + config.sessionTtlMs,
        };
        return {
            session,
            plaintext: {
                sessionToken,
                csrfToken,
            },
        };
    });

    const sessionResult = (
        user: AuthUserRecord,
        material: {
            readonly session: NewSession;
            readonly plaintext: {
                readonly sessionToken: string;
                readonly csrfToken: string;
            };
        },
    ): AuthenticationResult => ({
        user: authUser(user),
        expiresAt: material.session.expiresAt,
        cookies: {
            session: cookie(
                config.sessionCookie,
                material.plaintext.sessionToken,
                material.session.expiresAt,
            ),
            csrf: cookie(
                config.csrfCookie,
                material.plaintext.csrfToken,
                material.session.expiresAt,
            ),
        },
    });

    const verifyTurnstile = (
        turnstileToken: string,
        expectedAction: string,
        remoteIp?: string,
    ) =>
        turnstile.verify({
            token: turnstileToken,
            expectedAction,
            ...(remoteIp === undefined ? {} : { remoteIp }),
        });

    const authenticationOptions = Effect.fn('auth.authentication.options')(
        function* (input: {
            readonly turnstileToken: string;
            readonly remoteIp?: string;
        }) {
            yield* verifyTurnstile(
                input.turnstileToken,
                TURNSTILE_ACTIONS.authenticationOptions,
                input.remoteIp,
            );
            const options = yield* webAuthn.authenticationOptions({
                rpId: config.rpId,
            });
            const plaintextChallenge = yield* challenge(options);
            const now = currentTime();
            const challengeId = yield* safeId();
            yield* repository.issueAuthenticationChallenge({
                id: challengeId,
                challengeHash: yield* hash(plaintextChallenge),
                rpId: config.rpId,
                origin: config.origin,
                now,
                expiresAt: now + config.challengeTtlMs,
            });
            return { challengeId, options };
        },
    );

    const verifyAuthentication = Effect.fn('auth.authentication.verify')(
        function* (input: {
            readonly challengeId: number;
            readonly turnstileToken: string;
            readonly response: Record<string, unknown>;
            readonly remoteIp?: string;
        }) {
            yield* verifyTurnstile(
                input.turnstileToken,
                TURNSTILE_ACTIONS.authenticationVerify,
                input.remoteIp,
            );
            const credentialId = yield* webAuthn
                .authenticationCredentialId(input.response)
                .pipe(Effect.mapError(() => new AuthenticationFailed()));
            const now = currentTime();
            const context = yield* repository.consumeAuthenticationChallenge({
                challengeId: input.challengeId,
                credentialId,
                now,
            });
            if (
                context.expectedRpId !== config.rpId ||
                context.expectedOrigin !== config.origin
            ) {
                return yield* Effect.fail(new AuthenticationFailed());
            }
            const verified = yield* webAuthn
                .verifyAuthentication({
                    response: input.response,
                    expectedChallengeHash: context.challengeHash,
                    expectedOrigin: config.origin,
                    expectedRpId: config.rpId,
                    expectedUserHandle: context.user.handle,
                    credential: context.passkey,
                })
                .pipe(Effect.mapError(() => new AuthenticationFailed()));
            const material = yield* makeSession(now);
            yield* repository.completeAuthentication({
                context,
                newSignCount: verified.newSignCount,
                backedUp: verified.backedUp,
                session: material.session,
                eventId: yield* safeId(),
                now,
            });
            return sessionResult(context.user, material);
        },
    );

    const accessRegistrationOptions = Effect.fn(
        'auth.accessRegistration.options',
    )(function* (input: {
        readonly accessToken: string;
        readonly turnstileToken: string;
        readonly remoteIp?: string;
    }) {
        yield* verifyTurnstile(
            input.turnstileToken,
            TURNSTILE_ACTIONS.accessRegistrationOptions,
            input.remoteIp,
        );
        const context = yield* repository.findAccessContext({
            tokenHash: yield* hash(input.accessToken),
            now: currentTime(),
        });
        const options = yield* registrationOptions(webAuthn, config, context);
        const plaintextChallenge = yield* challenge(options);
        const now = currentTime();
        const challengeId = yield* safeId();
        yield* repository.issueAccessChallenge({
            id: challengeId,
            context,
            challengeHash: yield* hash(plaintextChallenge),
            rpId: config.rpId,
            origin: config.origin,
            now,
            expiresAt: now + config.challengeTtlMs,
        });
        return { challengeId, purpose: context.purpose, options };
    });

    const accessRegistrationVerify = Effect.fn(
        'auth.accessRegistration.verify',
    )(function* (input: {
        readonly accessToken: string;
        readonly challengeId: number;
        readonly name: string;
        readonly turnstileToken: string;
        readonly response: Record<string, unknown>;
        readonly remoteIp?: string;
    }) {
        if (!validName(input.name, 100)) {
            return yield* Effect.fail(new AuthValidationError());
        }
        yield* verifyTurnstile(
            input.turnstileToken,
            TURNSTILE_ACTIONS.accessRegistrationVerify,
            input.remoteIp,
        );
        const accessTokenHash = yield* hash(input.accessToken);
        const now = currentTime();
        const context = yield* repository.consumeRegistrationChallenge({
            challengeId: input.challengeId,
            accessTokenHash,
            now,
        });
        if (
            context.expectedRpId !== config.rpId ||
            context.expectedOrigin !== config.origin
        ) {
            return yield* Effect.fail(new AccessLinkInvalid());
        }
        const verified = yield* webAuthn
            .verifyRegistration({
                response: input.response,
                expectedChallengeHash: context.challengeHash,
                expectedOrigin: config.origin,
                expectedRpId: config.rpId,
            })
            .pipe(Effect.mapError(() => new AccessLinkInvalid()));
        const material = yield* makeSession(now);
        yield* repository.completeRegistration({
            context,
            accessTokenHash,
            passkey: verifiedPasskey(yield* safeId(), input.name, verified),
            session: material.session,
            eventId: yield* safeId(),
            now,
        });
        return sessionResult(context.user, material);
    });

    const passkeyRegistrationOptions = Effect.fn(
        'auth.passkeyRegistration.options',
    )(function* (
        session: AuthenticatedSession,
        input: {
            readonly turnstileToken: string;
            readonly remoteIp?: string;
        },
    ) {
        yield* verifyTurnstile(
            input.turnstileToken,
            TURNSTILE_ACTIONS.passkeyRegistrationOptions,
            input.remoteIp,
        );
        const context = yield* repository.findUserRegistrationContext(
            session.user.id,
        );
        const options = yield* registrationOptions(webAuthn, config, context);
        const plaintextChallenge = yield* challenge(options);
        const challengeId = yield* safeId();
        const now = currentTime();
        yield* repository.issueAuthenticatedRegistrationChallenge({
            linkId: yield* safeId(),
            linkTokenHash: yield* token().pipe(Effect.flatMap(hash)),
            challengeId,
            userId: session.user.id,
            challengeHash: yield* hash(plaintextChallenge),
            rpId: config.rpId,
            origin: config.origin,
            now,
            expiresAt: now + config.challengeTtlMs,
        });
        return { challengeId, purpose: 'enrollment' as const, options };
    });

    const passkeyRegistrationVerify = Effect.fn(
        'auth.passkeyRegistration.verify',
    )(function* (
        session: AuthenticatedSession,
        input: {
            readonly challengeId: number;
            readonly name: string;
            readonly turnstileToken: string;
            readonly response: Record<string, unknown>;
            readonly remoteIp?: string;
        },
    ) {
        if (!validName(input.name, 100)) {
            return yield* Effect.fail(new AuthValidationError());
        }
        yield* verifyTurnstile(
            input.turnstileToken,
            TURNSTILE_ACTIONS.passkeyRegistrationVerify,
            input.remoteIp,
        );
        const now = currentTime();
        const context = yield* repository.consumeRegistrationChallenge({
            challengeId: input.challengeId,
            authenticatedUserId: session.user.id,
            now,
        });
        if (
            context.expectedRpId !== config.rpId ||
            context.expectedOrigin !== config.origin ||
            context.user.id !== session.user.id
        ) {
            return yield* Effect.fail(new AuthenticationFailed());
        }
        const verified = yield* webAuthn
            .verifyRegistration({
                response: input.response,
                expectedChallengeHash: context.challengeHash,
                expectedOrigin: config.origin,
                expectedRpId: config.rpId,
            })
            .pipe(Effect.mapError(() => new AuthenticationFailed()));
        const passkey = verifiedPasskey(yield* safeId(), input.name, verified);
        yield* repository.completeRegistration({
            context,
            authenticatedUserId: session.user.id,
            passkey,
            eventId: yield* safeId(),
            now,
        });
        return {
            passkey: passkeyResponse({
                ...passkey,
                userId: session.user.id,
                lastUsedAt: null,
                createdAt: now,
            }),
        };
    });

    const authenticateSession = Effect.fn('auth.session.authenticate')(
        function* (sessionToken: string | undefined) {
            if (sessionToken === undefined || sessionToken.length === 0) {
                return yield* Effect.fail(new Unauthenticated());
            }
            const now = currentTime();
            const session = yield* repository.findSession({
                tokenHash: yield* hash(sessionToken),
                now,
                idleCutoff: now - SESSION_IDLE_TIMEOUT_MS,
                lastSeenThrottleCutoff: now - SESSION_LAST_SEEN_THROTTLE_MS,
            });
            return {
                sessionId: session.id,
                user: authUser(session.user),
                expiresAt: session.expiresAt,
                csrfTokenHash: session.csrfTokenHash,
            } satisfies AuthenticatedSession;
        },
    );

    const authorizeMutation = Effect.fn('auth.csrf.authorize')(function* (
        session: AuthenticatedSession,
        metadata: MutationRequestMetadata,
    ) {
        const method = metadata.method.toUpperCase();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
            return;
        }
        if (metadata.origin !== config.origin) {
            return yield* Effect.fail(new CsrfInvalid());
        }
        const mediaType = metadata.contentType
            ?.split(';', 1)[0]
            ?.trim()
            .toLowerCase();
        if (mediaType !== 'application/json') {
            return yield* Effect.fail(new CsrfInvalid());
        }
        const cookieToken = metadata.csrfCookieToken;
        const headerToken = metadata.csrfHeaderToken;
        if (
            cookieToken === undefined ||
            headerToken === undefined ||
            cookieToken.length === 0 ||
            cookieToken.length > 2048 ||
            headerToken.length === 0 ||
            headerToken.length > 2048
        ) {
            return yield* Effect.fail(new CsrfInvalid());
        }
        if (
            !timingSafeEqual(
                new TextEncoder().encode(cookieToken),
                new TextEncoder().encode(headerToken),
            )
        ) {
            return yield* Effect.fail(new CsrfInvalid());
        }
        const suppliedHash = yield* hash(headerToken);
        if (!timingSafeEqual(suppliedHash, session.csrfTokenHash)) {
            return yield* Effect.fail(new CsrfInvalid());
        }
    });

    const revokeSession = Effect.fn('auth.session.revoke')(function* (
        sessionToken: string | undefined,
    ) {
        if (sessionToken !== undefined && sessionToken.length > 0) {
            yield* repository.revokeSession({
                tokenHash: yield* hash(sessionToken),
                eventId: yield* safeId(),
                now: currentTime(),
            });
        }
        return {
            session: cookie(config.sessionCookie, '', 0),
            csrf: cookie(config.csrfCookie, '', 0),
        } satisfies SessionCookieMaterial;
    });

    const listPasskeys = (session: AuthenticatedSession) =>
        repository.listPasskeys(session.user.id).pipe(
            Effect.map((passkeys) => ({
                passkeys: passkeys.map(passkeyResponse),
            })),
        );

    const deletePasskey = Effect.fn('auth.passkey.delete')(function* (
        session: AuthenticatedSession,
        passkeyId: number,
    ) {
        yield* repository.deletePasskey({
            userId: session.user.id,
            passkeyId,
            eventId: yield* safeId(),
            now: currentTime(),
        });
    });

    const createEnrollmentLink = Effect.fn('auth.access.createEnrollment')(
        function* (
            session: AuthenticatedSession,
            input: {
                readonly username: string;
                readonly email: string;
                readonly displayName: string;
                readonly isAdmin: boolean;
            },
        ) {
            yield* requireAdmin(session);
            if (
                !validName(input.username, 100) ||
                !validName(input.email, 320) ||
                !validName(input.displayName, 200)
            ) {
                return yield* Effect.fail(new AuthValidationError());
            }
            const now = currentTime();
            const plaintextToken = yield* token();
            const userId = yield* safeId();
            const linkId = yield* safeId();
            const expiresAt = now + ACCESS_LINK_TTL_MS;
            yield* repository.createEnrollmentLink({
                actorUserId: session.user.id,
                user: {
                    id: userId,
                    handle: yield* hash(yield* token()),
                    username: input.username,
                    email: input.email,
                    displayName: input.displayName,
                    isAdmin: input.isAdmin,
                },
                linkId,
                tokenHash: yield* hash(plaintextToken),
                eventId: yield* safeId(),
                now,
                expiresAt,
            });
            return {
                id: linkId,
                userId,
                purpose: 'enrollment' as const,
                url: `${config.origin}/auth/enroll#token=${encodeURIComponent(plaintextToken)}`,
                expiresAt,
            };
        },
    );

    const createRecoveryLink = Effect.fn('auth.access.createRecovery')(
        function* (session: AuthenticatedSession, targetUserId: number) {
            yield* requireAdmin(session);
            const now = currentTime();
            const plaintextToken = yield* token();
            const linkId = yield* safeId();
            const expiresAt = now + ACCESS_LINK_TTL_MS;
            yield* repository.createRecoveryLink({
                actorUserId: session.user.id,
                targetUserId,
                linkId,
                tokenHash: yield* hash(plaintextToken),
                eventId: yield* safeId(),
                now,
                expiresAt,
            });
            return {
                id: linkId,
                userId: targetUserId,
                purpose: 'recovery' as const,
                url: `${config.origin}/auth/recover#token=${encodeURIComponent(plaintextToken)}`,
                expiresAt,
            };
        },
    );

    const revokeAccessLink = Effect.fn('auth.access.revoke')(function* (
        session: AuthenticatedSession,
        linkId: number,
    ) {
        yield* requireAdmin(session);
        yield* repository.revokeAccessLink({
            actorUserId: session.user.id,
            linkId,
            eventId: yield* safeId(),
            now: currentTime(),
        });
    });

    const listAppTokens = (session: AuthenticatedSession) =>
        repository.listAppTokens(session.user.id).pipe(
            Effect.map((tokens) => ({
                tokens: tokens.map(appTokenResponse),
            })),
        );

    const createAppToken = Effect.fn('auth.appToken.create')(function* (
        session: AuthenticatedSession,
        input: {
            readonly name: string;
            readonly scopes: readonly AppTokenScope[];
        },
    ) {
        if (
            !validName(input.name, 100) ||
            input.scopes.length === 0 ||
            input.scopes.length > 2 ||
            new Set(input.scopes).size !== input.scopes.length ||
            !input.scopes.every(
                (scope) => scope === 'google-reader' || scope === 'fever',
            )
        ) {
            return yield* Effect.fail(new AuthValidationError());
        }
        const now = currentTime();
        const plaintextToken = yield* token();
        const tokenRecord: AppTokenRecord = {
            id: yield* safeId(),
            name: input.name,
            prefix: plaintextToken.slice(0, 10),
            scopes: [...input.scopes],
            createdAt: now,
            lastUsedAt: null,
            expiresAt: null,
        };
        const feverVerifierHash = input.scopes.includes('fever')
            ? yield* hash(md5Hex(`${session.user.username}:${plaintextToken}`))
            : null;
        yield* repository.createAppToken({
            userId: session.user.id,
            token: tokenRecord,
            tokenHash: yield* hash(plaintextToken),
            feverVerifierHash,
            eventId: yield* safeId(),
            now,
        });
        return {
            token: appTokenResponse(tokenRecord),
            plaintextToken,
        };
    });

    const revokeAppToken = (session: AuthenticatedSession, tokenId: number) =>
        Effect.gen(function* () {
            yield* repository.revokeAppToken({
                userId: session.user.id,
                tokenId,
                eventId: yield* safeId(),
                now: currentTime(),
            });
        });

    const appTokenResult = (
        result: AppTokenAuthentication,
    ): AppTokenAuthenticationResult => ({
        tokenId: result.tokenId,
        user: authUser(result.user),
        scopes: result.scopes,
    });

    const authenticateTokenHash = Effect.fn('auth.appToken.authenticateHash')(
        function* (input: {
            readonly username?: string;
            readonly plaintextToken: string;
            readonly requiredScope: AppTokenScope;
        }) {
            if (
                input.username === '' ||
                input.plaintextToken.length === 0 ||
                input.plaintextToken.length > 2048
            ) {
                return yield* Effect.fail(new AuthenticationFailed());
            }
            const now = currentTime();
            return appTokenResult(
                yield* repository.authenticateAppToken({
                    ...(input.username === undefined
                        ? {}
                        : { username: input.username }),
                    tokenHash: yield* hash(input.plaintextToken),
                    requiredScope: input.requiredScope,
                    now,
                    lastUsedThrottleCutoff:
                        now - APP_TOKEN_LAST_USED_THROTTLE_MS,
                }),
            );
        },
    );

    const authenticateAppToken = (input: {
        readonly username: string;
        readonly plaintextToken: string;
        readonly requiredScope: AppTokenScope;
    }) => authenticateTokenHash(input);

    const authenticateAppTokenCredential = (input: {
        readonly plaintextToken: string;
        readonly requiredScope: AppTokenScope;
    }) => authenticateTokenHash(input);

    const authenticateFeverApiKey = Effect.fn(
        'auth.appToken.authenticateFever',
    )(function* (apiKey: string) {
        if (!/^[0-9a-fA-F]{32}$/u.test(apiKey)) {
            return yield* Effect.fail(new AuthenticationFailed());
        }
        const now = currentTime();
        return appTokenResult(
            yield* repository.authenticateFeverVerifier({
                verifierHash: yield* hash(apiKey.toLowerCase()),
                now,
                lastUsedThrottleCutoff: now - APP_TOKEN_LAST_USED_THROTTLE_MS,
            }),
        );
    });

    return {
        authenticationOptions,
        verifyAuthentication,
        accessRegistrationOptions,
        accessRegistrationVerify,
        passkeyRegistrationOptions,
        passkeyRegistrationVerify,
        authenticateSession,
        authorizeMutation,
        revokeSession,
        listPasskeys,
        deletePasskey,
        createEnrollmentLink,
        createRecoveryLink,
        revokeAccessLink,
        listAppTokens,
        createAppToken,
        revokeAppToken,
        authenticateAppToken,
        authenticateAppTokenCredential,
        authenticateFeverApiKey,
    };
};

export type AuthService = ReturnType<typeof makeAuthService>;

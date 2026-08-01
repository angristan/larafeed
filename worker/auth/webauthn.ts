import type {
    AuthenticationResponseJSON,
    AuthenticatorTransportFuture,
    RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { Effect } from 'effect';

import { timingSafeEqual } from './crypto';
import { WebAuthnOperationError } from './errors';

export interface RegistrationUser {
    readonly handle: Uint8Array;
    readonly username: string;
    readonly displayName: string;
}

export interface RegistrationCredentialDescriptor {
    readonly credentialId: Uint8Array;
    readonly transports: readonly string[];
}

export interface AuthenticationCredential {
    readonly credentialId: Uint8Array;
    readonly publicKey: Uint8Array;
    readonly signCount: number;
    readonly transports: readonly string[];
}

export interface VerifiedAuthentication {
    readonly newSignCount: number;
    readonly backedUp: boolean;
}

export interface VerifiedRegistration {
    readonly credentialId: Uint8Array;
    readonly publicKey: Uint8Array;
    readonly signCount: number;
    readonly transports: readonly string[];
    readonly aaguid: string | null;
    readonly backedUp: boolean;
}

export interface WebAuthn {
    readonly authenticationCredentialId: (
        response: Record<string, unknown>,
    ) => Effect.Effect<Uint8Array, WebAuthnOperationError>;
    readonly authenticationOptions: (input: {
        readonly rpId: string;
    }) => Effect.Effect<Record<string, unknown>, WebAuthnOperationError>;
    readonly registrationOptions: (input: {
        readonly rpId: string;
        readonly rpName: string;
        readonly user: RegistrationUser;
        readonly excludeCredentials: readonly RegistrationCredentialDescriptor[];
    }) => Effect.Effect<Record<string, unknown>, WebAuthnOperationError>;
    readonly verifyAuthentication: (input: {
        readonly response: Record<string, unknown>;
        readonly expectedChallengeHash: Uint8Array;
        readonly expectedOrigin: string;
        readonly expectedRpId: string;
        readonly expectedUserHandle: Uint8Array;
        readonly credential: AuthenticationCredential;
    }) => Effect.Effect<VerifiedAuthentication, WebAuthnOperationError>;
    readonly verifyRegistration: (input: {
        readonly response: Record<string, unknown>;
        readonly expectedChallengeHash: Uint8Array;
        readonly expectedOrigin: string;
        readonly expectedRpId: string;
    }) => Effect.Effect<VerifiedRegistration, WebAuthnOperationError>;
}

const operationError = (
    operation:
        | 'authenticationOptions'
        | 'authenticationVerify'
        | 'registrationOptions'
        | 'registrationVerify',
    cause: unknown,
) => new WebAuthnOperationError({ operation, cause });

const copyBytes = (source: Uint8Array): Uint8Array<ArrayBuffer> => {
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return copy;
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, '');
};

const base64UrlToBytes = (
    value: unknown,
    operation: 'authenticationVerify' | 'registrationVerify',
): Uint8Array => {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        !/^[A-Za-z0-9_-]+$/u.test(value)
    ) {
        throw operationError(operation, new Error('Invalid base64url value'));
    }

    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(
        value.replaceAll('-', '+').replaceAll('_', '/') + padding,
    );
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

const responseField = (
    response: Record<string, unknown>,
    field: string,
): unknown => {
    const nested = response.response;
    return typeof nested === 'object' && nested !== null
        ? Reflect.get(nested, field)
        : undefined;
};

const challengeMatches =
    (expectedHash: Uint8Array, webCrypto: Crypto) =>
    async (challenge: string): Promise<boolean> => {
        const digest = await webCrypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(challenge),
        );
        return timingSafeEqual(new Uint8Array(digest), expectedHash);
    };

const transport = (value: string): value is AuthenticatorTransportFuture =>
    value === 'ble' ||
    value === 'cable' ||
    value === 'hybrid' ||
    value === 'internal' ||
    value === 'nfc' ||
    value === 'smart-card' ||
    value === 'usb';

export const makeWebAuthn = (
    webCrypto: Crypto = globalThis.crypto,
): WebAuthn => ({
    authenticationCredentialId: (response) =>
        Effect.try({
            try: () => base64UrlToBytes(response.id, 'authenticationVerify'),
            catch: (cause) =>
                cause instanceof WebAuthnOperationError
                    ? cause
                    : operationError('authenticationVerify', cause),
        }),

    authenticationOptions: ({ rpId }) =>
        Effect.tryPromise({
            try: async () => ({
                ...(await generateAuthenticationOptions({
                    rpID: rpId,
                    userVerification: 'required',
                })),
            }),
            catch: (cause) => operationError('authenticationOptions', cause),
        }),

    registrationOptions: ({ rpId, rpName, user, excludeCredentials }) =>
        Effect.tryPromise({
            try: async () => ({
                ...(await generateRegistrationOptions({
                    rpID: rpId,
                    rpName,
                    userID: copyBytes(user.handle),
                    userName: user.username,
                    userDisplayName: user.displayName,
                    attestationType: 'none',
                    authenticatorSelection: {
                        residentKey: 'required',
                        userVerification: 'required',
                    },
                    excludeCredentials: excludeCredentials.map(
                        ({ credentialId, transports }) => ({
                            id: bytesToBase64Url(credentialId),
                            transports: transports.filter(transport),
                        }),
                    ),
                })),
            }),
            catch: (cause) => operationError('registrationOptions', cause),
        }),

    verifyAuthentication: ({
        response,
        expectedChallengeHash,
        expectedOrigin,
        expectedRpId,
        expectedUserHandle,
        credential,
    }) =>
        Effect.tryPromise({
            try: async () => {
                const suppliedUserHandle = base64UrlToBytes(
                    responseField(response, 'userHandle'),
                    'authenticationVerify',
                );
                if (!timingSafeEqual(suppliedUserHandle, expectedUserHandle)) {
                    throw new Error('Unexpected user handle');
                }

                const verification = await verifyAuthenticationResponse({
                    response: response as unknown as AuthenticationResponseJSON,
                    expectedChallenge: challengeMatches(
                        expectedChallengeHash,
                        webCrypto,
                    ),
                    expectedOrigin,
                    expectedRPID: expectedRpId,
                    requireUserVerification: true,
                    advancedFIDOConfig: { userVerification: 'required' },
                    credential: {
                        id: bytesToBase64Url(credential.credentialId),
                        publicKey: copyBytes(credential.publicKey),
                        counter: credential.signCount,
                        transports: credential.transports.filter(transport),
                    },
                });

                if (!verification.verified) {
                    throw new Error('Authentication was not verified');
                }

                return {
                    newSignCount: verification.authenticationInfo.newCounter,
                    backedUp:
                        verification.authenticationInfo.credentialBackedUp,
                };
            },
            catch: (cause) => operationError('authenticationVerify', cause),
        }),

    verifyRegistration: ({
        response,
        expectedChallengeHash,
        expectedOrigin,
        expectedRpId,
    }) =>
        Effect.tryPromise({
            try: async () => {
                const verification = await verifyRegistrationResponse({
                    response: response as unknown as RegistrationResponseJSON,
                    expectedChallenge: challengeMatches(
                        expectedChallengeHash,
                        webCrypto,
                    ),
                    expectedOrigin,
                    expectedRPID: expectedRpId,
                    requireUserPresence: true,
                    requireUserVerification: true,
                });

                if (!verification.verified) {
                    throw new Error('Registration was not verified');
                }

                return {
                    credentialId: base64UrlToBytes(
                        verification.registrationInfo.credential.id,
                        'registrationVerify',
                    ),
                    publicKey: copyBytes(
                        verification.registrationInfo.credential.publicKey,
                    ),
                    signCount: verification.registrationInfo.credential.counter,
                    transports:
                        verification.registrationInfo.credential.transports ??
                        [],
                    aaguid: verification.registrationInfo.aaguid || null,
                    backedUp: verification.registrationInfo.credentialBackedUp,
                };
            },
            catch: (cause) => operationError('registrationVerify', cause),
        }),
});

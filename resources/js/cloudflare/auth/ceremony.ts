import {
    type AuthenticationResponseJSON,
    browserSupportsWebAuthn,
    type PublicKeyCredentialCreationOptionsJSON,
    type PublicKeyCredentialRequestOptionsJSON,
    type RegistrationResponseJSON,
    startAuthentication,
    startRegistration,
} from '@simplewebauthn/browser';

export const AUTH_TURNSTILE_ACTIONS = {
    authenticationOptions: 'authentication_options',
    authenticationVerify: 'authentication_verify',
    registrationOptions: 'registration_options',
    registrationVerify: 'registration_verify',
} as const;

export class PasskeyCeremonyError extends Error {
    readonly _tag = 'PasskeyCeremonyError';

    constructor(
        readonly kind: 'unsupported' | 'canceled' | 'registered' | 'failed',
        message: string,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'PasskeyCeremonyError';
    }
}

function errorName(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }

    const name = Reflect.get(error, 'name');
    return typeof name === 'string' ? name : undefined;
}

function mapBrowserError(error: unknown, registration: boolean): never {
    const name = errorName(error);

    if (name === 'AbortError' || name === 'NotAllowedError') {
        throw new PasskeyCeremonyError(
            'canceled',
            'The passkey request was canceled or timed out.',
            error,
        );
    }

    if (registration && name === 'InvalidStateError') {
        throw new PasskeyCeremonyError(
            'registered',
            'This passkey is already registered.',
            error,
        );
    }

    throw new PasskeyCeremonyError(
        'failed',
        'The browser could not complete the passkey request.',
        error,
    );
}

export function supportsPasskeys(): boolean {
    return browserSupportsWebAuthn();
}

function requireWebAuthn(): void {
    if (!supportsPasskeys()) {
        throw new PasskeyCeremonyError(
            'unsupported',
            'This browser or device does not support passkeys.',
        );
    }
}

// The shared wire schema intentionally treats WebAuthn JSON as opaque. These
// adapters isolate the SDK-specific structural type assertion at that boundary.
const authenticationOptions = (
    options: Readonly<Record<string, unknown>>,
): PublicKeyCredentialRequestOptionsJSON =>
    options as unknown as PublicKeyCredentialRequestOptionsJSON;

const registrationOptions = (
    options: Readonly<Record<string, unknown>>,
): PublicKeyCredentialCreationOptionsJSON =>
    options as unknown as PublicKeyCredentialCreationOptionsJSON;

const authenticationResponse = (
    response: AuthenticationResponseJSON,
): Record<string, unknown> => response as unknown as Record<string, unknown>;

const registrationResponse = (
    response: RegistrationResponseJSON,
): Record<string, unknown> => response as unknown as Record<string, unknown>;

export async function requestAuthentication(
    options: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
    requireWebAuthn();

    try {
        const response = await startAuthentication({
            optionsJSON: authenticationOptions(options),
        });
        return authenticationResponse(response);
    } catch (error) {
        return mapBrowserError(error, false);
    }
}

export async function requestRegistration(
    options: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
    requireWebAuthn();

    try {
        const response = await startRegistration({
            optionsJSON: registrationOptions(options),
        });
        return registrationResponse(response);
    } catch (error) {
        return mapBrowserError(error, true);
    }
}

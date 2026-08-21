import {
    type AccessRegistrationOptionsRequest,
    type AccessRegistrationVerifyRequest,
    ApiErrorResponse,
    AuthConfigResponse,
    AuthenticatedSessionResponse,
    type AuthenticationOptionsRequest,
    AuthenticationOptionsResponse,
    type AuthenticationVerifyRequest,
    AuthSessionResponse,
    PasskeyListResponse,
    type PasskeyRegistrationOptionsRequest,
    type PasskeyRegistrationVerifyRequest,
    PasskeyResponse,
    RegistrationOptionsResponse,
} from '@shared/http';
import { Effect, Schema } from 'effect';

import { AuthClientError } from './authError';

export { AuthClientError, type AuthClientErrorKind } from './authError';

export type AuthConfig = typeof AuthConfigResponse.Type;
export type AuthSession = typeof AuthSessionResponse.Type;
export type AuthenticatedSession = typeof AuthenticatedSessionResponse.Type;
export type AuthenticationOptions = typeof AuthenticationOptionsResponse.Type;
export type RegistrationOptions = typeof RegistrationOptionsResponse.Type;
export type PasskeyList = typeof PasskeyListResponse.Type;
export type PasskeyRecord = PasskeyList['passkeys'][number];

type RequestBody =
    | typeof AuthenticationOptionsRequest.Type
    | typeof AuthenticationVerifyRequest.Type
    | typeof AccessRegistrationOptionsRequest.Type
    | typeof AccessRegistrationVerifyRequest.Type
    | typeof PasskeyRegistrationOptionsRequest.Type
    | typeof PasskeyRegistrationVerifyRequest.Type;

interface JsonRequestOptions {
    readonly method?: 'GET' | 'POST' | 'DELETE';
    readonly body?: RequestBody;
    readonly headers?: Readonly<Record<string, string>>;
}

const readJson = (response: Response) =>
    Effect.tryPromise({
        try: async () => {
            const json: unknown = await response.json();
            return json;
        },
        catch: (cause) =>
            new AuthClientError(
                'decode',
                'The authentication service returned invalid JSON.',
                response.status,
                undefined,
                cause,
            ),
    });

const statusError = (response: Response, body: unknown) =>
    Schema.decodeUnknownEffect(ApiErrorResponse)(body).pipe(
        Effect.match({
            onFailure: () =>
                new AuthClientError(
                    'status',
                    `The authentication service returned status ${response.status}.`,
                    response.status,
                ),
            onSuccess: ({ error }) =>
                new AuthClientError(
                    'status',
                    error.message,
                    response.status,
                    error.code,
                ),
        }),
    );

const requestJson = <A>(
    path: string,
    schema: Schema.Decoder<A, never>,
    options: JsonRequestOptions = {},
): Effect.Effect<A, AuthClientError> =>
    Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
            try: (signal) =>
                fetch(path, {
                    method: options.method ?? 'GET',
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json',
                        ...(options.body === undefined
                            ? {}
                            : { 'Content-Type': 'application/json' }),
                        ...options.headers,
                    },
                    ...(options.body === undefined
                        ? {}
                        : { body: JSON.stringify(options.body) }),
                    signal,
                }),
            catch: (cause) =>
                new AuthClientError(
                    'transport',
                    'The authentication service is unavailable.',
                    undefined,
                    undefined,
                    cause,
                ),
        });

        const body = yield* readJson(response);

        if (!response.ok) {
            return yield* Effect.fail(yield* statusError(response, body));
        }

        return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
            Effect.mapError(
                (cause) =>
                    new AuthClientError(
                        'decode',
                        'The authentication response has an invalid shape.',
                        response.status,
                        undefined,
                        cause,
                    ),
            ),
        );
    });

const postJson = <A>(
    path: string,
    schema: Schema.Decoder<A, never>,
    body: RequestBody,
) => requestJson(path, schema, { method: 'POST', body });

export const getAuthConfig = Effect.fn('AuthClient.getConfig')(() =>
    requestJson('/api/auth/config', AuthConfigResponse),
);

export const getAuthConfigPromise = (signal: AbortSignal) =>
    Effect.runPromise(getAuthConfig(), { signal });

export const getAuthSession = Effect.fn('AuthClient.getSession')(() =>
    requestJson('/api/auth/session', AuthSessionResponse),
);

export const getAuthenticationOptions = Effect.fn(
    'AuthClient.getAuthenticationOptions',
)((body: typeof AuthenticationOptionsRequest.Type) =>
    postJson(
        '/api/auth/authentication/options',
        AuthenticationOptionsResponse,
        body,
    ),
);

export const verifyAuthentication = Effect.fn(
    'AuthClient.verifyAuthentication',
)((body: typeof AuthenticationVerifyRequest.Type) =>
    postJson(
        '/api/auth/authentication/verify',
        AuthenticatedSessionResponse,
        body,
    ),
);

export const getAccessRegistrationOptions = Effect.fn(
    'AuthClient.getAccessRegistrationOptions',
)((body: typeof AccessRegistrationOptionsRequest.Type) =>
    postJson(
        '/api/auth/access/registration/options',
        RegistrationOptionsResponse,
        body,
    ),
);

export const verifyAccessRegistration = Effect.fn(
    'AuthClient.verifyAccessRegistration',
)((body: typeof AccessRegistrationVerifyRequest.Type) =>
    postJson(
        '/api/auth/access/registration/verify',
        AuthenticatedSessionResponse,
        body,
    ),
);

export const listPasskeys = Effect.fn('AuthClient.listPasskeys')(() =>
    requestJson('/api/auth/passkeys', PasskeyListResponse),
);

export const getPasskeyRegistrationOptions = Effect.fn(
    'AuthClient.getPasskeyRegistrationOptions',
)((input: { readonly turnstileToken?: string; readonly csrfToken: string }) =>
    requestJson(
        '/api/auth/passkeys/registration/options',
        RegistrationOptionsResponse,
        {
            method: 'POST',
            body:
                input.turnstileToken === undefined
                    ? {}
                    : { turnstileToken: input.turnstileToken },
            headers: { 'X-CSRF-Token': input.csrfToken },
        },
    ),
);

export const verifyPasskeyRegistration = Effect.fn(
    'AuthClient.verifyPasskeyRegistration',
)(
    (
        input: typeof PasskeyRegistrationVerifyRequest.Type & {
            readonly csrfToken: string;
        },
    ) =>
        requestJson('/api/auth/passkeys/registration/verify', PasskeyResponse, {
            method: 'POST',
            body: {
                challengeId: input.challengeId,
                name: input.name,
                ...(input.turnstileToken === undefined
                    ? {}
                    : { turnstileToken: input.turnstileToken }),
                response: input.response,
            },
            headers: { 'X-CSRF-Token': input.csrfToken },
        }),
);

export const deletePasskey = Effect.fn('AuthClient.deletePasskey')(
    (input: { readonly passkeyId: number; readonly csrfToken: string }) =>
        Effect.gen(function* () {
            const response = yield* Effect.tryPromise({
                try: (signal) =>
                    fetch(`/api/auth/passkeys/${input.passkeyId}`, {
                        method: 'DELETE',
                        credentials: 'same-origin',
                        headers: {
                            Accept: 'application/json',
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': input.csrfToken,
                        },
                        signal,
                    }),
                catch: (cause) =>
                    new AuthClientError(
                        'transport',
                        'The authentication service is unavailable.',
                        undefined,
                        undefined,
                        cause,
                    ),
            });
            if (response.ok) return;
            const body = yield* readJson(response);
            return yield* Effect.fail(yield* statusError(response, body));
        }),
);

export const logout = Effect.fn('AuthClient.logout')((csrfToken: string) =>
    Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
            try: (signal) =>
                fetch('/api/auth/logout', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken,
                    },
                    body: '{}',
                    signal,
                }),
            catch: (cause) =>
                new AuthClientError(
                    'transport',
                    'The authentication service is unavailable.',
                    undefined,
                    undefined,
                    cause,
                ),
        });

        if (response.ok) {
            return;
        }

        const body = yield* readJson(response);
        return yield* Effect.fail(yield* statusError(response, body));
    }),
);

export function readCsrfToken(cookie = document.cookie): string | undefined {
    for (const part of cookie.split(';')) {
        const separator = part.indexOf('=');
        if (separator === -1) {
            continue;
        }

        const name = part.slice(0, separator).trim();
        if (!/^(?:__Host-)?larafeed(?:-[a-z]+)?-csrf$/.test(name)) {
            continue;
        }

        const value = part.slice(separator + 1);
        if (value.length > 0) {
            try {
                return decodeURIComponent(value);
            } catch {
                return undefined;
            }
        }
    }

    return undefined;
}

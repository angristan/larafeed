import {
    AccessLinkResponse,
    AccountActionResponse,
    AccountProfile,
    AdminOverviewResponse,
    AdminUser,
    ApiErrorResponse,
    type CreateEnrollmentLinkRequest,
} from '@shared/http';
import { Effect, Schema } from 'effect';

export type Account = typeof AccountProfile.Type;
export type AdminOverview = typeof AdminOverviewResponse.Type;
export type ManagedUser = AdminOverview['users'][number];
export type ManagedAccessLink = AdminOverview['accessLinks'][number];

export class AccountClientError extends Error {
    readonly _tag = 'AccountClientError';
    constructor(
        readonly kind: 'transport' | 'status' | 'decode',
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'AccountClientError';
    }
}

interface Options {
    readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    readonly body?: unknown;
    readonly csrfToken?: string;
}
const readJson = (response: Response) =>
    Effect.tryPromise({
        try: async () => {
            const value: unknown = await response.json();
            return value;
        },
        catch: (cause) =>
            new AccountClientError(
                'decode',
                'The account service returned invalid JSON.',
                response.status,
                undefined,
                cause,
            ),
    });
const statusError = (response: Response, body: unknown) =>
    Schema.decodeUnknownEffect(ApiErrorResponse)(body).pipe(
        Effect.match({
            onFailure: () =>
                new AccountClientError(
                    'status',
                    `The account service returned status ${response.status}.`,
                    response.status,
                ),
            onSuccess: ({ error }) =>
                new AccountClientError(
                    'status',
                    error.message,
                    response.status,
                    error.code,
                ),
        }),
    );
const request = <A>(
    path: string,
    schema: Schema.Decoder<A, never>,
    options: Options = {},
): Effect.Effect<A, AccountClientError> =>
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
                        ...(options.csrfToken === undefined
                            ? {}
                            : { 'X-CSRF-Token': options.csrfToken }),
                    },
                    ...(options.body === undefined
                        ? {}
                        : { body: JSON.stringify(options.body) }),
                    signal,
                }),
            catch: (cause) =>
                new AccountClientError(
                    'transport',
                    'The account service is unavailable.',
                    undefined,
                    undefined,
                    cause,
                ),
        });
        const body = yield* readJson(response);
        if (!response.ok)
            return yield* Effect.fail(yield* statusError(response, body));
        return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
            Effect.mapError(
                (cause) =>
                    new AccountClientError(
                        'decode',
                        'The account response has an invalid shape.',
                        response.status,
                        undefined,
                        cause,
                    ),
            ),
        );
    });
const noContent = (path: string, csrfToken: string) =>
    Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
            try: (signal) =>
                fetch(path, {
                    method: 'DELETE',
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken,
                    },
                    signal,
                }),
            catch: (cause) =>
                new AccountClientError(
                    'transport',
                    'The account service is unavailable.',
                    undefined,
                    undefined,
                    cause,
                ),
        });
        if (response.ok) return;
        const body = yield* readJson(response);
        return yield* Effect.fail(yield* statusError(response, body));
    });

export const getAccount = Effect.fn('AccountClient.get')(() =>
    request('/api/account', AccountProfile),
);
export const updateAccount = Effect.fn('AccountClient.update')(
    (input: {
        readonly email: string;
        readonly displayName: string;
        readonly csrfToken: string;
    }) =>
        request('/api/account', AccountProfile, {
            method: 'PATCH',
            body: { email: input.email, displayName: input.displayName },
            csrfToken: input.csrfToken,
        }),
);
export const wipeAccount = Effect.fn('AccountClient.wipe')(
    (input: { readonly confirmation: string; readonly csrfToken: string }) =>
        request('/api/account/wipe', AccountActionResponse, {
            method: 'POST',
            body: { confirmation: input.confirmation },
            csrfToken: input.csrfToken,
        }),
);
export const deleteAccount = Effect.fn('AccountClient.delete')(
    (input: { readonly confirmation: string; readonly csrfToken: string }) =>
        request('/api/account', AccountActionResponse, {
            method: 'DELETE',
            body: { confirmation: input.confirmation },
            csrfToken: input.csrfToken,
        }),
);
export const getAdminOverview = Effect.fn('AccountClient.adminOverview')(() =>
    request('/api/admin/overview', AdminOverviewResponse),
);
export const setUserDisabled = Effect.fn('AccountClient.setUserDisabled')(
    (input: {
        readonly userId: number;
        readonly disabled: boolean;
        readonly csrfToken: string;
    }) =>
        request(`/api/admin/users/${input.userId}`, AdminUser, {
            method: 'PATCH',
            body: { disabled: input.disabled },
            csrfToken: input.csrfToken,
        }),
);
export const createEnrollmentLink = Effect.fn(
    'AccountClient.createEnrollmentLink',
)(
    (
        input: typeof CreateEnrollmentLinkRequest.Type & {
            readonly csrfToken: string;
        },
    ) =>
        request('/api/auth/admin/enrollment-links', AccessLinkResponse, {
            method: 'POST',
            body: {
                username: input.username,
                email: input.email,
                displayName: input.displayName,
                isAdmin: input.isAdmin,
            },
            csrfToken: input.csrfToken,
        }),
);
export const createRecoveryLink = Effect.fn('AccountClient.createRecoveryLink')(
    (input: { readonly userId: number; readonly csrfToken: string }) =>
        request(
            `/api/auth/admin/users/${input.userId}/recovery-links`,
            AccessLinkResponse,
            {
                method: 'POST',
                body: {},
                csrfToken: input.csrfToken,
            },
        ),
);
export const revokeAccessLink = Effect.fn('AccountClient.revokeAccessLink')(
    (input: { readonly linkId: number; readonly csrfToken: string }) =>
        noContent(
            `/api/auth/admin/access-links/${input.linkId}`,
            input.csrfToken,
        ),
);

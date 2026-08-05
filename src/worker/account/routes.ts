import {
    AccountActionResponse,
    AccountConfirmationRequest,
    AccountProfile,
    AdminOverviewResponse,
    AdminUser,
    ApiErrorResponse,
    UpdateAccountProfileRequest,
    UpdateAdminUserRequest,
} from '@shared/http';
import { Effect, Schema } from 'effect';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, makeDefaultAuthRuntime } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { recoverHttpCause } from '../http/failures';
import {
    isRequestBodyTooLarge,
    type RequestBodyError,
    readBoundedJsonBody,
} from '../http/request-body';
import { makeD1 } from '../infrastructure/d1';
import { AccountValidationError } from './errors';
import { makeAccountRepository } from './repository';
import { type AccountService, makeAccountService } from './service';

const SafePathId = Schema.NumberFromString.pipe(
    Schema.check(
        Schema.isInt(),
        Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    ),
);
const headers = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=UTF-8',
} as const;
const MAX_JSON_BODY_BYTES = 64 * 1_024;
const expiredCookie = (name: string, httpOnly: boolean): string =>
    `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Secure; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}`;

export interface AccountRuntime {
    readonly auth: AuthRuntime;
    readonly service: AccountService;
}
export type AccountRuntimeFactory = (
    env: Env,
) => Effect.Effect<AccountRuntime, unknown>;
export interface AccountRouteDependencies {
    readonly runtimeFactory?: AccountRuntimeFactory;
}
export const defaultAccountRuntimeFactory: AccountRuntimeFactory = (env) => {
    const d1 = makeD1(env.DB);
    return makeDefaultAuthRuntime(env, d1).pipe(
        Effect.map((auth) => ({
            auth,
            service: makeAccountService({
                repository: makeAccountRepository(d1),
            }),
        })),
    );
};

const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
    request: Request,
    schema: S,
    validationError: (value: unknown) => AccountValidationError = () =>
        new AccountValidationError({}),
): Effect.Effect<S['Type'], AccountValidationError | RequestBodyError> =>
    readBoundedJsonBody(request, MAX_JSON_BODY_BYTES).pipe(
        Effect.mapError((error) =>
            isRequestBodyTooLarge(error)
                ? error
                : new AccountValidationError({}),
        ),
        Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(schema, { onExcessProperty: 'error' })(
                value,
            ).pipe(Effect.mapError(() => validationError(value))),
        ),
    );

const profileValidationError = (value: unknown): AccountValidationError => {
    if (typeof value !== 'object' || value === null) {
        return new AccountValidationError({});
    }
    const displayName = Reflect.get(value, 'displayName');
    if (
        typeof displayName !== 'string' ||
        displayName.trim().length === 0 ||
        displayName.trim().length > 255
    ) {
        return new AccountValidationError({ field: 'displayName' });
    }
    const email = Reflect.get(value, 'email');
    if (
        typeof email !== 'string' ||
        email.trim().length === 0 ||
        email.trim().length > 320
    ) {
        return new AccountValidationError({ field: 'email' });
    }
    return new AccountValidationError({});
};
const decodeId = (value: string) =>
    Schema.decodeUnknownEffect(SafePathId)(value).pipe(
        Effect.mapError(() => new AccountValidationError()),
    );
const token = (
    context: Parameters<typeof getCookie>[0],
    runtime: AuthRuntime,
) => getCookie(context, runtime.config.sessionCookie.name);
const authenticate = (
    context: Parameters<typeof getCookie>[0],
    runtime: AuthRuntime,
) => runtime.service.authenticateSession(token(context, runtime));
const mutation = <A, E>(
    context: Parameters<typeof getCookie>[0],
    runtime: AuthRuntime,
    operation: (session: AuthenticatedSession) => Effect.Effect<A, E>,
) =>
    authenticate(context, runtime).pipe(
        Effect.tap((session) =>
            runtime.service.authorizeMutation(session, {
                method: context.req.raw.method,
                origin: context.req.raw.headers.get('Origin') ?? undefined,
                contentType:
                    context.req.raw.headers.get('Content-Type') ?? undefined,
                csrfCookieToken: getCookie(
                    context,
                    runtime.config.csrfCookie.name,
                ),
                csrfHeaderToken:
                    context.req.raw.headers.get('X-CSRF-Token') ?? undefined,
            }),
        ),
        Effect.flatMap(operation),
    );
const bodyMutation = <S extends Schema.ConstraintDecoder<unknown>, A, E>(
    context: Parameters<typeof getCookie>[0],
    runtime: AuthRuntime,
    schema: S,
    operation: (
        session: AuthenticatedSession,
        body: S['Type'],
    ) => Effect.Effect<A, E>,
    validationError?: (value: unknown) => AccountValidationError,
) =>
    mutation(context, runtime, (session) =>
        decodeJson(context.req.raw, schema, validationError).pipe(
            Effect.flatMap((body) => operation(session, body)),
        ),
    );
const json = <S extends Schema.Top>(schema: S, value: unknown, status = 200) =>
    Schema.encodeUnknownEffect(schema)(value).pipe(
        Effect.map(
            (body) => new Response(JSON.stringify(body), { status, headers }),
        ),
    );

interface SafeError {
    readonly code:
        | 'validation_error'
        | 'payload_too_large'
        | 'unauthenticated'
        | 'csrf_invalid'
        | 'forbidden'
        | 'not_found'
        | 'conflict'
        | 'service_unavailable'
        | 'internal_server_error';
    readonly message: string;
    readonly status: number;
}
const tag = (error: unknown): string | undefined =>
    typeof error === 'object' && error !== null
        ? typeof Reflect.get(error, '_tag') === 'string'
            ? (Reflect.get(error, '_tag') as string)
            : undefined
        : undefined;
const validationMessage = (error: unknown): string => {
    if (typeof error !== 'object' || error === null) return 'Invalid request';
    switch (Reflect.get(error, 'field')) {
        case 'displayName':
            return 'Display name must be between 1 and 255 characters';
        case 'email':
            return 'Enter a valid email address';
        case 'confirmation':
            return 'The confirmation does not match your username';
        default:
            return 'Invalid request';
    }
};
const safeError = (error: unknown): SafeError => {
    if (isRequestBodyTooLarge(error)) {
        return {
            code: 'payload_too_large',
            message: 'Request body is too large',
            status: 413,
        };
    }

    switch (tag(error)) {
        case 'AccountValidationError':
            return {
                code: 'validation_error',
                message: validationMessage(error),
                status: 400,
            };
        case 'AuthValidationError':
            return {
                code: 'validation_error',
                message: 'Invalid request',
                status: 400,
            };
        case 'Unauthenticated':
            return {
                code: 'unauthenticated',
                message: 'Authentication required',
                status: 401,
            };
        case 'CsrfInvalid':
            return {
                code: 'csrf_invalid',
                message: 'Request verification failed',
                status: 403,
            };
        case 'AccountFreshAuthenticationRequired':
            return {
                code: 'forbidden',
                message: 'Fresh authentication required',
                status: 403,
            };
        case 'AccountForbidden':
        case 'Forbidden':
            return { code: 'forbidden', message: 'Forbidden', status: 403 };
        case 'AccountNotFound':
            return { code: 'not_found', message: 'Not found', status: 404 };
        case 'AccountConflict':
            return {
                code: 'conflict',
                message:
                    typeof error === 'object' &&
                    error !== null &&
                    Reflect.get(error, 'field') === 'email'
                        ? 'Email address is already in use'
                        : 'Conflict',
                status: 409,
            };
        case 'AccountStorageError':
        case 'AuthStorageError':
            return {
                code: 'service_unavailable',
                message: 'Service unavailable',
                status: 503,
            };
        default:
            return {
                code: 'internal_server_error',
                message: 'Internal server error',
                status: 500,
            };
    }
};
const errorResponse = (error: unknown): Response => {
    const safe = safeError(error);
    try {
        const body = Schema.encodeUnknownSync(ApiErrorResponse)(
            ApiErrorResponse.make({
                error: { code: safe.code, message: safe.message },
            }),
        );
        return new Response(JSON.stringify(body), {
            status: safe.status,
            headers,
        });
    } catch {
        return new Response(
            '{"error":{"code":"internal_server_error","message":"Internal server error"}}',
            { status: 500, headers },
        );
    }
};
const run = (request: Request, program: Effect.Effect<Response, unknown>) =>
    Effect.runPromise(
        program.pipe(
            Effect.catchCause((cause) =>
                recoverHttpCause(cause, errorResponse),
            ),
        ),
        { signal: request.signal },
    );

export const registerAccountRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: AccountRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const factory = dependencies.runtimeFactory ?? defaultAccountRuntimeFactory;
    const runtime = (env: Env) => Effect.suspend(() => factory(env));

    app.get('/api/account', (context) =>
        run(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticate(context, value.auth).pipe(
                        Effect.flatMap(value.service.getProfile),
                    ),
                ),
                Effect.flatMap((value) => json(AccountProfile, value)),
            ),
        ),
    );
    app.patch('/api/account', (context) =>
        run(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    bodyMutation(
                        context,
                        value.auth,
                        UpdateAccountProfileRequest,
                        value.service.updateProfile,
                        profileValidationError,
                    ),
                ),
                Effect.flatMap((value) => json(AccountProfile, value)),
            ),
        ),
    );
    app.post('/api/account/wipe', (context) =>
        run(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    bodyMutation(
                        context,
                        value.auth,
                        AccountConfirmationRequest,
                        (session, body) =>
                            value.service.wipeReaderData(
                                session,
                                body.confirmation,
                            ),
                    ),
                ),
                Effect.flatMap((value) => json(AccountActionResponse, value)),
            ),
        ),
    );
    app.delete('/api/account', (context) =>
        run(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    bodyMutation(
                        context,
                        value.auth,
                        AccountConfirmationRequest,
                        (session, body) =>
                            value.service.deleteAccount(
                                session,
                                body.confirmation,
                            ),
                    ).pipe(
                        Effect.flatMap((result) =>
                            json(AccountActionResponse, result),
                        ),
                        Effect.map((response) => {
                            response.headers.append(
                                'Set-Cookie',
                                expiredCookie(
                                    value.auth.config.sessionCookie.name,
                                    true,
                                ),
                            );
                            response.headers.append(
                                'Set-Cookie',
                                expiredCookie(
                                    value.auth.config.csrfCookie.name,
                                    false,
                                ),
                            );
                            return response;
                        }),
                    ),
                ),
            ),
        ),
    );
    app.get('/api/admin/overview', (context) =>
        run(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    authenticate(context, value.auth).pipe(
                        Effect.flatMap(value.service.adminOverview),
                    ),
                ),
                Effect.flatMap((value) => json(AdminOverviewResponse, value)),
            ),
        ),
    );
    app.patch('/api/admin/users/:id', (context) =>
        run(
            context.req.raw,
            runtime(context.env).pipe(
                Effect.flatMap((value) =>
                    bodyMutation(
                        context,
                        value.auth,
                        UpdateAdminUserRequest,
                        (session, body) =>
                            decodeId(context.req.param('id')).pipe(
                                Effect.flatMap((userId) =>
                                    value.service.setUserDisabled(session, {
                                        userId,
                                        disabled: body.disabled,
                                    }),
                                ),
                            ),
                    ),
                ),
                Effect.flatMap((value) => json(AdminUser, value)),
            ),
        ),
    );

    return app;
};

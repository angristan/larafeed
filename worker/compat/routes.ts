import { Cause, Effect } from 'effect';
import type { Context, Hono } from 'hono';

import { type AuthRuntime, defaultAuthRuntimeFactory } from '../auth/routes';
import type { AppTokenAuthenticationResult } from '../auth/service';
import { makeD1 } from '../infrastructure/d1';
import {
    CompatibilityRateLimited,
    CompatibilityStorageError,
    CompatibilityValidationError,
} from './errors';
import {
    feverItem,
    googleEntry,
    googleSubscription,
    parseCompatibilityItemId,
} from './protocol';
import {
    type CompatibilityRepository,
    MAX_COMPAT_ITEM_IDS,
    MAX_GOOGLE_CONTENT_ITEMS,
    makeCompatibilityRepository,
} from './repository';

const MAX_FORM_BYTES = 64 * 1_024;
const MAX_URL_BYTES = 16 * 1_024;
const GOOGLE_ROOT = '/api/reader/reader/api/0';
const NO_STORE = 'no-store';

type CompatibilityContext = Context<{ Bindings: Env }>;

export interface CompatibilityRuntime {
    readonly auth: AuthRuntime;
    readonly repository: CompatibilityRepository;
    readonly now: () => number;
}

export type CompatibilityRuntimeFactory = (
    env: Env,
) => Effect.Effect<CompatibilityRuntime, unknown>;

export interface CompatibilityRouteDependencies {
    readonly runtimeFactory?: CompatibilityRuntimeFactory;
    readonly rateLimit?: (
        env: Env,
        key: string,
    ) => Effect.Effect<
        void,
        CompatibilityRateLimited | CompatibilityStorageError
    >;
}

export const defaultCompatibilityRuntimeFactory: CompatibilityRuntimeFactory = (
    env,
) =>
    defaultAuthRuntimeFactory(env).pipe(
        Effect.map((auth) => ({
            auth,
            repository: makeCompatibilityRepository(makeD1(env.DB)),
            now: Date.now,
        })),
    );

const defaultRateLimit = (
    env: Env,
    key: string,
): Effect.Effect<void, CompatibilityRateLimited | CompatibilityStorageError> =>
    Effect.tryPromise({
        try: () => env.AUTH_RATE_LIMITER.limit({ key }),
        catch: (cause) =>
            new CompatibilityStorageError({
                operation: 'compat.rateLimit',
                cause,
            }),
    }).pipe(
        Effect.flatMap((outcome) =>
            outcome.success
                ? Effect.void
                : Effect.fail(new CompatibilityRateLimited()),
        ),
    );

const headers = (contentType: string): Headers =>
    new Headers({ 'cache-control': NO_STORE, 'content-type': contentType });
const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: headers('application/json; charset=UTF-8'),
    });
const text = (body: string, status = 200): Response =>
    new Response(body, {
        status,
        headers: headers('text/plain; charset=UTF-8'),
    });
const errorTag = (error: unknown): string | undefined => {
    if (typeof error !== 'object' || error === null) return undefined;
    const tag = Reflect.get(error, '_tag');
    return typeof tag === 'string' ? tag : undefined;
};
const squashedTag = (cause: Cause.Cause<unknown>): string | undefined =>
    errorTag(Cause.squash(cause));

const googleFailure = (
    cause: Cause.Cause<unknown>,
    authenticationError: string,
): Response => {
    switch (squashedTag(cause)) {
        case 'AuthenticationFailed':
            return text(`Error=${authenticationError}\n`, 403);
        case 'CompatibilityValidationError':
            return text('Error=BadRequest\n', 400);
        case 'CompatibilityRateLimited':
            return text('Error=RateLimited\n', 429);
        case 'AuthStorageError':
        case 'CompatibilityStorageError':
        case 'ReaderStorageError':
            return text('Error=ServiceUnavailable\n', 503);
        case 'ReaderNotFound':
            return text('OK');
        default:
            return text('Error=InternalServerError\n', 500);
    }
};

const runGoogle = (
    request: Request,
    program: Effect.Effect<Response, unknown>,
    authenticationError = 'InvalidAuthToken',
): Promise<Response> =>
    Effect.runPromise(
        program.pipe(
            Effect.catchCause((cause) =>
                Effect.succeed(googleFailure(cause, authenticationError)),
            ),
        ),
        { signal: request.signal },
    );

const feverFailure = (cause: Cause.Cause<unknown>): Response => {
    switch (squashedTag(cause)) {
        case 'AuthenticationFailed':
        case 'CompatibilityValidationError':
            return json({ api_version: 3, auth: 0 });
        case 'CompatibilityRateLimited':
            return json({ api_version: 3, auth: 1 }, 429);
        case 'AuthStorageError':
        case 'CompatibilityStorageError':
        case 'ReaderStorageError':
            return json({ api_version: 3, auth: 0 }, 503);
        case 'ReaderNotFound':
            return json({ api_version: 3, auth: 1 });
        default:
            return json({ api_version: 3, auth: 0 }, 500);
    }
};

const runFever = (
    request: Request,
    program: Effect.Effect<Response, unknown>,
): Promise<Response> =>
    Effect.runPromise(
        program.pipe(
            Effect.catchCause((cause) => Effect.succeed(feverFailure(cause))),
        ),
        { signal: request.signal },
    );

const readBoundedBody = async (request: Request): Promise<Uint8Array> => {
    if (request.body === null) return new Uint8Array();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            total += next.value.byteLength;
            if (total > MAX_FORM_BYTES) {
                await reader.cancel('form too large');
                throw new Error('form too large');
            }
            chunks.push(next.value);
        }
    } finally {
        reader.releaseLock();
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
};

const readForm = (
    request: Request,
): Effect.Effect<URLSearchParams, CompatibilityValidationError> =>
    Effect.tryPromise({
        try: async () => {
            const lengthHeader = request.headers.get('content-length');
            if (
                lengthHeader !== null &&
                (!/^\d+$/u.test(lengthHeader) ||
                    Number(lengthHeader) > MAX_FORM_BYTES)
            ) {
                throw new Error('form too large');
            }
            const mediaType =
                request.headers
                    .get('content-type')
                    ?.split(';', 1)[0]
                    ?.trim()
                    .toLowerCase() ?? '';
            if (
                mediaType !== '' &&
                mediaType !== 'application/x-www-form-urlencoded'
            ) {
                throw new Error('unsupported form content type');
            }
            const bodyBytes = await readBoundedBody(request);
            return new URLSearchParams(
                new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes),
            );
        },
        catch: () => new CompatibilityValidationError(),
    });

const requestParameters = (
    request: Request,
): Effect.Effect<URLSearchParams, CompatibilityValidationError> =>
    Effect.gen(function* () {
        if (new TextEncoder().encode(request.url).byteLength > MAX_URL_BYTES) {
            return yield* Effect.fail(new CompatibilityValidationError());
        }
        const parameters = new URLSearchParams(new URL(request.url).search);
        if (request.method === 'POST') {
            const form = yield* readForm(request);
            for (const [key, value] of form) parameters.append(key, value);
        }
        return parameters;
    });

const requiredValue = (
    parameters: URLSearchParams,
    key: string,
    maximum = 2_048,
): Effect.Effect<string, CompatibilityValidationError> => {
    const value = parameters.get(key);
    return value !== null && value.length > 0 && value.length <= maximum
        ? Effect.succeed(value)
        : Effect.fail(new CompatibilityValidationError());
};

const parseBoundedInt = (
    value: string | null,
    maximum: number,
    allowZero = false,
): Effect.Effect<number | undefined, CompatibilityValidationError> => {
    if (value === null) return Effect.succeed(undefined);
    if (!/^\d+$/u.test(value)) {
        return Effect.fail(new CompatibilityValidationError());
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) &&
        parsed <= maximum &&
        (allowZero ? parsed >= 0 : parsed > 0)
        ? Effect.succeed(parsed)
        : Effect.fail(new CompatibilityValidationError());
};

const remoteIp = (context: CompatibilityContext): string =>
    context.req.header('CF-Connecting-IP') ?? 'local-development';

const googleCredential = (
    context: CompatibilityContext,
): Effect.Effect<string, never> | null => {
    const authorization = context.req.header('Authorization');
    if (authorization === undefined) return null;
    const match = /^GoogleLogin auth=([^\s]{1,2048})$/u.exec(authorization);
    return match?.[1] === undefined ? null : Effect.succeed(match[1]);
};

const feedsGroups = (
    subscriptions: readonly {
        readonly categoryId: number;
        readonly feedId: number;
    }[],
) => {
    const grouped = new Map<number, number[]>();
    for (const subscription of subscriptions) {
        const ids = grouped.get(subscription.categoryId) ?? [];
        ids.push(subscription.feedId);
        grouped.set(subscription.categoryId, ids);
    }
    return [...grouped]
        .sort(([left], [right]) => left - right)
        .map(([groupId, feedIds]) => ({
            group_id: groupId,
            feed_ids: feedIds.join(','),
        }));
};

export const registerCompatibilityRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: CompatibilityRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const runtimeFactory =
        dependencies.runtimeFactory ?? defaultCompatibilityRuntimeFactory;
    const rateLimit = dependencies.rateLimit ?? defaultRateLimit;
    const runtime = (env: Env) => Effect.suspend(() => runtimeFactory(env));

    app.post('/api/reader/accounts/ClientLogin', (context) =>
        runGoogle(
            context.req.raw,
            Effect.gen(function* () {
                const form = yield* requestParameters(context.req.raw);
                const username = yield* requiredValue(form, 'Email', 100);
                const plaintextToken = yield* requiredValue(form, 'Passwd');
                yield* rateLimit(
                    context.env,
                    `compat:google:login:${username.toLowerCase()}:${remoteIp(context)}`,
                );
                const compat = yield* runtime(context.env);
                yield* compat.auth.service.authenticateAppToken({
                    username,
                    plaintextToken,
                    requiredScope: 'google-reader',
                });
                return text(
                    `SID=${plaintextToken}\nLSID=${plaintextToken}\nAuth=${plaintextToken}\n`,
                );
            }),
            'BadAuthentication',
        ),
    );

    const protectedGoogle = (
        context: CompatibilityContext,
        operation: (
            compat: CompatibilityRuntime,
            authentication: AppTokenAuthenticationResult,
            credential: string,
        ) => Effect.Effect<Response, unknown>,
    ): Promise<Response> => {
        const credential = googleCredential(context);
        if (credential === null) {
            return Promise.resolve(text('Error=AuthRequired\n', 401));
        }
        return runGoogle(
            context.req.raw,
            Effect.gen(function* () {
                const plaintextToken = yield* credential;
                const compat = yield* runtime(context.env);
                const authentication =
                    yield* compat.auth.service.authenticateAppTokenCredential({
                        plaintextToken,
                        requiredScope: 'google-reader',
                    });
                yield* rateLimit(
                    context.env,
                    `compat:google:token:${authentication.tokenId}`,
                );
                return yield* operation(compat, authentication, plaintextToken);
            }),
        );
    };

    app.get(`${GOOGLE_ROOT}/user-info`, (context) =>
        protectedGoogle(context, (compat, authentication) =>
            compat.repository.getProfile(authentication.user.id).pipe(
                Effect.map((profile) =>
                    json({
                        userId: String(profile.id),
                        userName: profile.displayName,
                        userEmail: profile.email,
                        userProfileId: String(profile.id),
                    }),
                ),
            ),
        ),
    );

    app.get(`${GOOGLE_ROOT}/token`, (context) =>
        protectedGoogle(context, (_compat, _authentication, credential) =>
            Effect.succeed(text(credential)),
        ),
    );

    app.get(`${GOOGLE_ROOT}/subscription/list`, (context) =>
        protectedGoogle(context, (compat, authentication) =>
            compat.repository.listSubscriptions(authentication.user.id).pipe(
                Effect.map((subscriptions) =>
                    json({
                        subscriptions: subscriptions.map((subscription) =>
                            googleSubscription(
                                authentication.user.id,
                                subscription,
                            ),
                        ),
                    }),
                ),
            ),
        ),
    );

    app.get(`${GOOGLE_ROOT}/stream/items/ids`, (context) =>
        protectedGoogle(context, (compat, authentication) =>
            Effect.gen(function* () {
                const search = yield* requestParameters(context.req.raw);
                const requestedLimit =
                    (yield* parseBoundedInt(
                        search.get('n'),
                        MAX_COMPAT_ITEM_IDS,
                    )) ?? MAX_COMPAT_ITEM_IDS;
                const filter =
                    search.get('s') === 'user/-/state/com.google/starred'
                        ? 'starred'
                        : search.get('xt') === 'user/-/state/com.google/read'
                          ? 'unread'
                          : 'all';
                const ids = yield* compat.repository.listItemIds(
                    authentication.user.id,
                    filter,
                    requestedLimit,
                );
                return json({
                    itemRefs: ids.map((id) => ({ id: String(id) })),
                });
            }),
        ),
    );

    app.post(`${GOOGLE_ROOT}/stream/items/contents`, (context) =>
        protectedGoogle(context, (compat, authentication) =>
            Effect.gen(function* () {
                const form = yield* requestParameters(context.req.raw);
                const values = form.getAll('i');
                if (values.length > MAX_GOOGLE_CONTENT_ITEMS) {
                    return yield* Effect.fail(
                        new CompatibilityValidationError(),
                    );
                }
                const ids = values.flatMap((value) => {
                    const id = parseCompatibilityItemId(value);
                    return id === null ? [] : [id];
                });
                const entries = yield* compat.repository.findEntries(
                    authentication.user.id,
                    ids,
                );
                return json({
                    items: entries.map((entry) =>
                        googleEntry(authentication.user.id, entry),
                    ),
                    updated: Math.floor(compat.now() / 1_000),
                });
            }),
        ),
    );

    app.post(`${GOOGLE_ROOT}/edit-tag`, (context) =>
        protectedGoogle(context, (compat, authentication) =>
            Effect.gen(function* () {
                const form = yield* requestParameters(context.req.raw);
                const id = parseCompatibilityItemId(form.get('i') ?? '');
                if (id === null) {
                    return yield* Effect.fail(
                        new CompatibilityValidationError(),
                    );
                }
                const add = form.get('a') ?? '';
                const remove = form.get('r') ?? '';
                const now = compat.now();
                if (add.endsWith('/read')) {
                    yield* compat.repository.setRead(
                        authentication.user.id,
                        id,
                        true,
                        now,
                    );
                } else if (remove.endsWith('/read')) {
                    yield* compat.repository.setRead(
                        authentication.user.id,
                        id,
                        false,
                        now,
                    );
                } else if (add.endsWith('/starred')) {
                    yield* compat.repository.setStarred(
                        authentication.user.id,
                        id,
                        true,
                        now,
                    );
                } else if (remove.endsWith('/starred')) {
                    yield* compat.repository.setStarred(
                        authentication.user.id,
                        id,
                        false,
                        now,
                    );
                }
                return text('OK');
            }),
        ),
    );

    const feverHandler = (context: CompatibilityContext) =>
        runFever(
            context.req.raw,
            Effect.gen(function* () {
                const parameters = yield* requestParameters(context.req.raw);
                const apiKey = yield* requiredValue(parameters, 'api_key', 32);
                const compat = yield* runtime(context.env);
                const authentication =
                    yield* compat.auth.service.authenticateFeverApiKey(apiKey);
                yield* rateLimit(
                    context.env,
                    `compat:fever:token:${authentication.tokenId}`,
                );
                const userId = authentication.user.id;
                const base: Record<string, unknown> = {
                    api_version: 3,
                    auth: 1,
                    last_refreshed_on_time: Math.floor(compat.now() / 1_000),
                };

                const wantsGroups = parameters.has('groups');
                const wantsFeeds = parameters.has('feeds');
                if (wantsGroups || wantsFeeds) {
                    const subscriptions =
                        yield* compat.repository.listSubscriptions(userId);
                    const groupedFeeds = feedsGroups(subscriptions);
                    if (wantsGroups) {
                        const categories =
                            yield* compat.repository.listCategories(userId);
                        base.groups = categories.map((category) => ({
                            id: category.id,
                            title: category.name,
                        }));
                        base.feeds_groups = groupedFeeds;
                    }
                    if (wantsFeeds) {
                        base.feeds = subscriptions.map((subscription) => ({
                            id: subscription.feedId,
                            favicon_id: subscription.faviconUrl,
                            title: subscription.title,
                            url: subscription.feedUrl,
                            site_url: subscription.siteUrl,
                            is_spark: 0,
                            last_updated_on_time:
                                subscription.lastSuccessfulRefreshAt === null
                                    ? 0
                                    : Math.floor(
                                          subscription.lastSuccessfulRefreshAt /
                                              1_000,
                                      ),
                        }));
                        base.feeds_groups = groupedFeeds;
                    }
                }

                if (parameters.has('items')) {
                    const sinceId = yield* parseBoundedInt(
                        parameters.get('since_id'),
                        Number.MAX_SAFE_INTEGER,
                        true,
                    );
                    const parsedMaxId = yield* parseBoundedInt(
                        parameters.get('max_id'),
                        Number.MAX_SAFE_INTEGER,
                        true,
                    );
                    const maxId = parsedMaxId === 0 ? undefined : parsedMaxId;
                    if (sinceId !== undefined && maxId !== undefined) {
                        return yield* Effect.fail(
                            new CompatibilityValidationError(),
                        );
                    }
                    const page = yield* compat.repository.listFeverItems(
                        userId,
                        {
                            ...(sinceId === undefined ? {} : { sinceId }),
                            ...(maxId === undefined ? {} : { maxId }),
                        },
                    );
                    base.items = page.entries.map(feverItem);
                    base.total_items = page.total;
                }
                if (parameters.has('unread_item_ids')) {
                    base.unread_item_ids =
                        (yield* compat.repository.listItemIds(
                            userId,
                            'unread',
                        )).join(',');
                }
                if (parameters.has('saved_item_ids')) {
                    base.saved_item_ids = (yield* compat.repository.listItemIds(
                        userId,
                        'starred',
                    )).join(',');
                }

                if (parameters.get('mark') !== null) {
                    const id = parseCompatibilityItemId(
                        parameters.get('id') ?? '',
                    );
                    const action = parameters.get('as') ?? '';
                    if (id !== null) {
                        if (action === 'saved') {
                            yield* compat.repository.setStarred(
                                userId,
                                id,
                                true,
                                compat.now(),
                            );
                        } else if (action === 'unsaved') {
                            yield* compat.repository.setStarred(
                                userId,
                                id,
                                false,
                                compat.now(),
                            );
                        } else if (action === 'read') {
                            yield* compat.repository.setRead(
                                userId,
                                id,
                                true,
                                compat.now(),
                            );
                        } else if (action === 'unread') {
                            yield* compat.repository.setRead(
                                userId,
                                id,
                                false,
                                compat.now(),
                            );
                        }
                    }
                }

                return json(base);
            }),
        );

    for (const path of ['/api/fever', '/api/fever/']) {
        app.get(path, feverHandler);
        app.post(path, feverHandler);
    }

    return app;
};

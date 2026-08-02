import {
    ApiErrorResponse,
    CreateSubscriptionResponse,
    SubscriptionManagementResponse,
} from '@shared/http';
import { Effect, Schema } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import { CsrfInvalid } from '../auth/errors';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import { SubscriptionConflict, SubscriptionFeedError } from './errors';
import { registerSubscriptionRoutes } from './routes';
import type { SubscriptionService } from './service';

const origin = 'https://larafeed-test.stanislas.cloud';
const config = {
    environment: 'test',
    rpId: 'larafeed-test.stanislas.cloud',
    origin,
    rpName: 'Larafeed test',
    challengeTtlMs: 120_000,
    sessionTtlMs: 3_600_000,
    turnstileSiteKey: 'site-key',
    turnstileSecretKey: 'secret-key',
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
} satisfies AuthConfig;
const session: AuthenticatedSession = {
    sessionId: 1,
    user: {
        id: 7,
        username: 'reader',
        displayName: 'Reader',
        isAdmin: false,
    },
    expiresAt: 2_000_000_000_000,
    csrfTokenHash: new Uint8Array(32),
};
const category = { id: 11, name: 'Tech', subscriptionCount: 1 };
const subscription = {
    feedId: 21,
    categoryId: 11,
    categoryName: 'Tech',
    feedName: 'Feed',
    customFeedName: null,
    feedUrl: 'https://example.test/feed.xml',
    siteUrl: 'https://example.test/',
    faviconUrl: '/api/images/feeds/21/small',
    faviconIsDark: null,
    entryCount: 4,
    unreadCount: 2,
    isGone: false,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    lastSuccessfulRefreshAt: null,
    lastFailedRefreshAt: null,
    lastErrorClass: null,
    lastErrorMessage: null,
    filterRules: {
        excludeTitle: [],
        excludeContent: [],
        excludeAuthor: [],
    },
    refreshes: [],
};

const authService = (overrides: Partial<AuthService> = {}): AuthService =>
    ({
        authenticateSession: () => Effect.succeed(session),
        authorizeMutation: () => Effect.void,
        ...overrides,
    }) as AuthService;
const subscriptionService = (
    overrides: Partial<SubscriptionService> = {},
): SubscriptionService =>
    ({
        list: () =>
            Effect.succeed({
                categories: [category],
                subscriptions: [subscription],
            }),
        createSubscription: () =>
            Effect.succeed({
                subscription,
                createdFeed: true,
                createdSubscription: true,
                refreshOperationId: 'refresh-operation',
            }),
        createCategory: () => Effect.succeed({ category }),
        updateCategory: () => Effect.succeed({ category }),
        deleteCategory: () => Effect.void,
        updateSubscription: () => Effect.succeed({ subscription }),
        unsubscribe: () => Effect.void,
        ...overrides,
    }) as SubscriptionService;
const app = (
    service: SubscriptionService = subscriptionService(),
    auth: AuthService = authService(),
) => {
    const hono = new Hono<{ Bindings: Env }>();
    const authRuntime: AuthRuntime = { config, service: auth };
    registerSubscriptionRoutes(hono, {
        runtimeFactory: () =>
            Effect.succeed({
                auth: authRuntime,
                service,
                limitFeedAdd: () => Effect.void,
            }),
    });
    return hono;
};
const cookie = `${config.sessionCookie.name}=session-secret`;
const csrfCookie = `${config.csrfCookie.name}=csrf-secret`;
const request = (method: string, body?: unknown) => ({
    method,
    headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-secret',
        Cookie: `${cookie}; ${csrfCookie}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const decode = async <S extends Schema.ConstraintDecoder<unknown>>(
    response: Response,
    schema: S,
): Promise<S['Type']> =>
    Schema.decodeUnknownSync(schema)(await response.json());

describe('subscription management routes', () => {
    it('authenticates and schema-encodes the management response', async () => {
        const response = await app().request('/api/subscriptions/manage', {
            headers: { Cookie: cookie },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        await expect(
            decode(response, SubscriptionManagementResponse),
        ).resolves.toMatchObject({
            categories: [{ id: 11 }],
            subscriptions: [{ feedId: 21 }],
        });
    });

    it('validates, rate-limits, and CSRF-protects feed creation', async () => {
        const createSubscription = vi.fn(() =>
            Effect.succeed({
                subscription,
                createdFeed: true,
                createdSubscription: true,
                refreshOperationId: 'refresh-operation',
            }),
        );
        const response = await app(
            subscriptionService({ createSubscription }),
        ).request(
            '/api/subscriptions',
            request('POST', {
                feedUrl: 'https://example.test/feed.xml',
                categoryId: 11,
            }),
        );

        expect(response.status).toBe(200);
        await expect(
            decode(response, CreateSubscriptionResponse),
        ).resolves.toMatchObject({ refreshOperationId: 'refresh-operation' });
        expect(createSubscription).toHaveBeenCalledWith(7, {
            feedUrl: 'https://example.test/feed.xml',
            categoryId: 11,
        });

        const firstFeed = await app(
            subscriptionService({ createSubscription }),
        ).request(
            '/api/subscriptions',
            request('POST', {
                feedUrl: 'https://example.test/feed.xml',
                categoryName: 'Tech',
            }),
        );
        expect(firstFeed.status).toBe(200);
        expect(createSubscription).toHaveBeenCalledWith(7, {
            feedUrl: 'https://example.test/feed.xml',
            categoryName: 'Tech',
        });

        const invalid = await app().request(
            '/api/subscriptions',
            request('POST', { feedUrl: 'not trimmed ', categoryId: 11 }),
        );
        expect(invalid.status).toBe(400);

        const csrfFailure = await app(
            subscriptionService(),
            authService({
                authorizeMutation: () => Effect.fail(new CsrfInvalid()),
            }),
        ).request(
            '/api/subscriptions',
            request('POST', {
                feedUrl: 'https://example.test/feed.xml',
                categoryId: 11,
            }),
        );
        expect(csrfFailure.status).toBe(403);
    });

    it.each([
        [
            'invalid_url',
            400,
            'validation_error',
            'Enter a valid public HTTP(S) feed or website URL',
        ],
        [
            'unresolvable_host',
            400,
            'validation_error',
            'Could not resolve this hostname. Check the URL and try again',
        ],
        [
            'unsupported_feed',
            400,
            'validation_error',
            'No supported feed was found at this URL',
        ],
        [
            'feed_too_large',
            400,
            'validation_error',
            'The feed document is too large',
        ],
        [
            'upstream_rate_limited',
            503,
            'service_unavailable',
            'The feed site is rate limiting requests. Try again later',
        ],
        [
            'temporarily_unavailable',
            503,
            'service_unavailable',
            'Feed discovery is temporarily unavailable',
        ],
    ] as const)('maps %s feed failures to a safe actionable response', async (reason, status, code, message) => {
        const response = await app(
            subscriptionService({
                createSubscription: () =>
                    Effect.fail(new SubscriptionFeedError({ reason })),
            }),
        ).request(
            '/api/subscriptions',
            request('POST', {
                feedUrl: 'https://example.test/feed.xml',
                categoryId: 11,
            }),
        );

        expect(response.status).toBe(status);
        await expect(decode(response, ApiErrorResponse)).resolves.toEqual({
            error: { code, message },
        });
    });

    it('maps category conflicts without exposing storage details', async () => {
        const response = await app(
            subscriptionService({
                deleteCategory: () =>
                    Effect.fail(
                        new SubscriptionConflict({ reason: 'category_in_use' }),
                    ),
            }),
        ).request('/api/categories/11', request('DELETE'));

        expect(response.status).toBe(409);
        await expect(decode(response, ApiErrorResponse)).resolves.toEqual({
            error: {
                code: 'conflict',
                message: 'Move or remove feeds before deleting this category',
            },
        });
    });
});

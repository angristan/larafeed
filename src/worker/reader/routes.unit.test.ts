import {
    ApiErrorResponse,
    ReaderCategoryListResponse,
    ReaderCountsResponse,
    ReaderEntryDetail,
    ReaderEntryListResponse,
    ReaderInteractionResponse,
    ReaderReadThroughResponse,
    ReaderSubscriptionListResponse,
} from '@shared/http';
import { Effect, Schema } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../auth/config';
import { CsrfInvalid, Unauthenticated } from '../auth/errors';
import type { AuthRuntime } from '../auth/routes';
import type {
    AuthenticatedSession,
    AuthService,
    MutationRequestMetadata,
} from '../auth/service';
import { ReaderStorageError } from './errors';
import type { ReaderEntryQuery } from './repository';
import { registerReaderRoutes } from './routes';
import type { ReaderService } from './service';

const origin = 'https://larafeed-test.stanislas.cloud';
const config: AuthConfig = {
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
};
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
const entry = {
    id: 31,
    feedId: 21,
    title: 'Entry',
    url: 'https://example.test/entry',
    author: null,
    publishedAt: 100,
    createdAt: 101,
    feedName: 'Feed',
    customFeedName: null,
    faviconUrl: null,
    faviconIsDark: null,
    read: false,
    starred: false,
    archived: false,
};
const detail = {
    ...entry,
    contentHtml: '<p>Content</p>',
    readChangedAt: null,
    starredAt: null,
    archivedAt: null,
};
const interaction = {
    entryId: entry.id,
    feedId: entry.feedId,
    read: true,
    readChangedAt: 200,
    starred: false,
    starredAt: null,
    archived: false,
    archivedAt: null,
};

const makeAuthService = (overrides: Partial<AuthService> = {}): AuthService =>
    ({
        authenticateSession: () => Effect.succeed(session),
        authorizeMutation: () => Effect.void,
        ...overrides,
    }) as AuthService;

const makeReaderService = (
    overrides: Partial<ReaderService> = {},
): ReaderService =>
    ({
        listCategories: () =>
            Effect.succeed({ categories: [{ id: 11, name: 'Tech' }] }),
        listSubscriptions: () =>
            Effect.succeed({
                subscriptions: [
                    {
                        feedId: 21,
                        categoryId: 11,
                        feedName: 'Feed',
                        customFeedName: null,
                        faviconUrl: null,
                        faviconIsDark: null,
                        totalCount: 1,
                        unreadCount: 1,
                    },
                ],
            }),
        getCounts: () =>
            Effect.succeed({ total: 1, unread: 1, read: 0, starred: 0 }),
        listEntries: () =>
            Effect.succeed({
                entries: [entry],
                total: 1,
                nextCursor: null,
            }),
        findEntry: () => Effect.succeed(detail),
        setRead: () => Effect.succeed(interaction),
        setStarred: () =>
            Effect.succeed({
                ...interaction,
                read: false,
                readChangedAt: null,
                starred: true,
                starredAt: 201,
            }),
        setArchived: () =>
            Effect.succeed({
                ...interaction,
                read: false,
                readChangedAt: null,
                archived: true,
                archivedAt: 202,
            }),
        advanceReadThrough: () =>
            Effect.succeed({ feedId: 21, readThroughEntryId: 31 }),
        ...overrides,
    }) as ReaderService;

const makeApp = (
    readerService: ReaderService = makeReaderService(),
    authService: AuthService = makeAuthService(),
) => {
    const app = new Hono<{ Bindings: Env }>();
    const auth: AuthRuntime = { config, service: authService };
    registerReaderRoutes(app, {
        runtimeFactory: () => Effect.succeed({ auth, service: readerService }),
    });
    return app;
};

const cookie = `${config.sessionCookie.name}=session-secret`;
const csrfCookie = `${config.csrfCookie.name}=csrf-secret`;
const get = { headers: { Cookie: cookie } };
const put = (body: unknown) => ({
    method: 'PUT',
    headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-secret',
        Cookie: `${cookie}; ${csrfCookie}`,
    },
    body: JSON.stringify(body),
});
const decodeResponse = async <S extends Schema.ConstraintDecoder<unknown>>(
    response: Response,
    schema: S,
): Promise<S['Type']> =>
    Schema.decodeUnknownSync(schema)(await response.json());
const expectNoStore = (response: Response) =>
    expect(response.headers.get('cache-control')).toBe('no-store');

describe('reader routes', () => {
    it('authenticates and schema-encodes all reader GET responses', async () => {
        const authenticateSession = vi.fn(() => Effect.succeed(session));
        const app = makeApp(
            makeReaderService(),
            makeAuthService({ authenticateSession }),
        );
        const cases = [
            ['/api/categories', ReaderCategoryListResponse],
            ['/api/subscriptions', ReaderSubscriptionListResponse],
            ['/api/entries/counts', ReaderCountsResponse],
            ['/api/entries', ReaderEntryListResponse],
            ['/api/entries/31', ReaderEntryDetail],
        ] as const;

        for (const [path, schema] of cases) {
            const response = await app.request(path, get);
            expect(response.status).toBe(200);
            expectNoStore(response);
            await expect(
                decodeResponse(response, schema),
            ).resolves.toBeDefined();
        }
        expect(authenticateSession).toHaveBeenCalledTimes(cases.length);
        expect(authenticateSession).toHaveBeenCalledWith('session-secret');
    });

    it('parses complete entry queries and rejects ambiguous or unbounded input', async () => {
        const listEntries = vi.fn((_userId: number, _query: ReaderEntryQuery) =>
            Effect.succeed({
                entries: [entry],
                total: 1,
                nextCursor: null,
            }),
        );
        const app = makeApp(makeReaderService({ listEntries }));
        const response = await app.request(
            '/api/entries?category_id=11&filter=favorites&order_by=created_at&cursor=1900000000000%3A44&page_size=50',
            get,
        );
        expect(response.status).toBe(200);
        expect(listEntries).toHaveBeenCalledWith(session.user.id, {
            scope: { type: 'category', id: 11 },
            filter: 'favorites',
            orderBy: 'created_at',
            cursor: { orderValue: 1_900_000_000_000, id: 44 },
            pageSize: 50,
        });

        for (const query of [
            'feed_id=21&category_id=11',
            'filter=unknown',
            'order_by=title',
            'cursor=abc',
            'cursor=1%3A',
            'cursor=-1%3A2',
            'page=1',
            'page_size=101',
            'feed_id=1&feed_id=2',
            'unexpected=true',
        ]) {
            const invalid = await app.request(`/api/entries?${query}`, get);
            expect(invalid.status).toBe(400);
            expectNoStore(invalid);
            await expect(
                decodeResponse(invalid, ApiErrorResponse),
            ).resolves.toMatchObject({
                error: { code: 'validation_error' },
            });
        }
        expect(listEntries).toHaveBeenCalledTimes(1);
    });

    it('passes desired states through authenticated CSRF-protected PUT routes', async () => {
        const setRead = vi.fn(() => Effect.succeed(interaction));
        const setStarred = vi.fn(() => Effect.succeed(interaction));
        const setArchived = vi.fn(() => Effect.succeed(interaction));
        const advanceReadThrough = vi.fn(() =>
            Effect.succeed({ feedId: 21, readThroughEntryId: 31 }),
        );
        let metadata: MutationRequestMetadata | undefined;
        const authorizeMutation = vi.fn(
            (
                _session: AuthenticatedSession,
                input: MutationRequestMetadata,
            ) => {
                metadata = input;
                return Effect.succeed(undefined);
            },
        );
        const app = makeApp(
            makeReaderService({
                setRead,
                setStarred,
                setArchived,
                advanceReadThrough,
            }),
            makeAuthService({ authorizeMutation }),
        );

        const read = await app.request(
            '/api/entries/31/read',
            put({ read: true }),
        );
        const star = await app.request(
            '/api/entries/31/star',
            put({ starred: false }),
        );
        const archive = await app.request(
            '/api/entries/31/archive',
            put({ archived: true }),
        );
        const readThrough = await app.request(
            '/api/subscriptions/21/read-through',
            put({}),
        );

        for (const response of [read, star, archive]) {
            expect(response.status).toBe(200);
            expectNoStore(response);
            await expect(
                decodeResponse(response, ReaderInteractionResponse),
            ).resolves.toBeDefined();
        }
        await expect(
            decodeResponse(readThrough, ReaderReadThroughResponse),
        ).resolves.toEqual({ feedId: 21, readThroughEntryId: 31 });
        expect(setRead).toHaveBeenCalledWith(7, 31, true);
        expect(setStarred).toHaveBeenCalledWith(7, 31, false);
        expect(setArchived).toHaveBeenCalledWith(7, 31, true);
        expect(advanceReadThrough).toHaveBeenCalledWith(7, 21);
        expect(metadata).toEqual({
            method: 'PUT',
            origin,
            contentType: 'application/json',
            csrfCookieToken: 'csrf-secret',
            csrfHeaderToken: 'csrf-secret',
        });
        expect(authorizeMutation).toHaveBeenCalledTimes(4);
    });

    it('rejects missing authentication, CSRF failures, and excess JSON fields safely', async () => {
        const unauthenticated = makeApp(
            makeReaderService(),
            makeAuthService({
                authenticateSession: () => Effect.fail(new Unauthenticated()),
            }),
        );
        const anonymous = await unauthenticated.request('/api/categories');
        expect(anonymous.status).toBe(401);
        await expect(
            decodeResponse(anonymous, ApiErrorResponse),
        ).resolves.toMatchObject({ error: { code: 'unauthenticated' } });

        const setRead = vi.fn(() => Effect.succeed(interaction));
        const csrfFailure = makeApp(
            makeReaderService({ setRead }),
            makeAuthService({
                authorizeMutation: () => Effect.fail(new CsrfInvalid()),
            }),
        );
        const forbidden = await csrfFailure.request(
            '/api/entries/31/read',
            put({ read: true }),
        );
        expect(forbidden.status).toBe(403);
        expect(setRead).not.toHaveBeenCalled();

        const excess = await makeApp(makeReaderService({ setRead })).request(
            '/api/entries/31/read',
            put({ read: true, toggle: true }),
        );
        expect(excess.status).toBe(400);
        expect(setRead).not.toHaveBeenCalled();
    });

    it('never exposes storage causes, defects, or invalid encoded responses', async () => {
        const failures = [
            Effect.fail(
                new ReaderStorageError({
                    operation: 'private query',
                    cause: new Error('database-secret'),
                }),
            ),
            Effect.die(new Error('private defect')),
            Effect.succeed({ categories: [{ id: 0, name: '' }] }),
        ];

        for (const failure of failures) {
            const response = await makeApp(
                makeReaderService({ listCategories: () => failure }),
            ).request('/api/categories', get);
            const text = await response.text();
            expect([500, 503]).toContain(response.status);
            expectNoStore(response);
            expect(text).not.toContain('database-secret');
            expect(text).not.toContain('private query');
            expect(text).not.toContain('private defect');
            expect(() =>
                Schema.decodeUnknownSync(ApiErrorResponse)(JSON.parse(text)),
            ).not.toThrow();
        }
    });
});

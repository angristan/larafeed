import { ApiErrorResponse, ChartResponse } from '@shared/http';
import { Effect, Schema } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AuthConfig } from '../auth/config';
import type { AuthRuntime } from '../auth/routes';
import type { AuthenticatedSession, AuthService } from '../auth/service';
import { parseChartQuery, registerChartRoutes } from './routes';
import type { ChartService } from './service';

const now = Date.parse('2026-07-18T12:00:00.000Z');
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
    user: { id: 7, username: 'reader', displayName: 'Reader', isAdmin: false },
    expiresAt: 2_000_000_000_000,
    csrfTokenHash: new Uint8Array(32),
};
const response = ChartResponse.make({
    window: {
        startDate: '2026-06-19',
        endDate: '2026-07-18',
        timeZone: 'UTC' as const,
        dayCount: 30,
    },
    scope: { type: 'all' as const, id: null, name: 'All subscriptions' },
    summary: {
        received: 0,
        currentlyRead: 0,
        currentlySaved: 0,
        currentUnread: 0,
        cohortReadThroughRate: null,
        refreshAttempts: 0,
        refreshSuccesses: 0,
        refreshFailures: 0,
        refreshSuccessRate: null,
        refreshEntriesCreated: 0,
    },
    days: Array.from({ length: 30 }, (_, index) => ({
        date: new Date(
            Date.parse('2026-06-19T00:00:00.000Z') + index * 86_400_000,
        )
            .toISOString()
            .slice(0, 10),
        received: 0,
        currentlyRead: 0,
        currentlyUnread: 0,
        currentlySaved: 0,
        cohortReadThroughRate: null,
        markedRead: null,
        markedUnread: null,
        saved: null,
        unsaved: null,
        refreshSuccesses: 0,
        refreshFailures: 0,
        refreshEntriesCreated: 0,
    })),
    activityCoverageStart: null,
});
const app = () => {
    const hono = new Hono<{ Bindings: Env }>();
    const auth: AuthRuntime = {
        config,
        service: {
            authenticateSession: () => Effect.succeed(session),
        } as unknown as AuthService,
    };
    const service = {
        getCharts: () => Effect.succeed(response),
    } as ChartService;
    registerChartRoutes(hono, {
        runtimeFactory: () => Effect.succeed({ auth, service, now: () => now }),
    });
    return hono;
};
const decode = async <S extends Schema.ConstraintDecoder<unknown>>(
    value: Response,
    schema: S,
): Promise<S['Type']> => Schema.decodeUnknownSync(schema)(await value.json());

describe('chart routes', () => {
    it('parses preset, custom, and owned scope inputs strictly', async () => {
        await expect(
            Effect.runPromise(
                parseChartQuery(
                    new Request(
                        'https://example.test/api/charts?range=90&feed_id=12',
                    ),
                    now,
                ),
            ),
        ).resolves.toMatchObject({
            scope: { type: 'feed', id: 12 },
            endAt: Date.parse('2026-07-19T00:00:00.000Z'),
        });
        await expect(
            Effect.runPromise(
                parseChartQuery(
                    new Request(
                        'https://example.test/api/charts?range=custom&start_date=2026-07-01&end_date=2026-07-18&category_id=13',
                    ),
                    now,
                ),
            ),
        ).resolves.toMatchObject({
            startAt: Date.parse('2026-07-01T00:00:00.000Z'),
            endAt: Date.parse('2026-07-19T00:00:00.000Z'),
            scope: { type: 'category', id: 13 },
        });

        for (const query of [
            'range=100',
            'range=30&start_date=2026-01-01',
            'range=custom&start_date=2026-07-01',
            'range=custom&start_date=2026-07-19&end_date=2026-07-19',
            'range=30&feed_id=1&category_id=2',
            'range=30&feed_id=1&feed_id=2',
            'range=30&unknown=true',
        ]) {
            await expect(
                Effect.runPromise(
                    parseChartQuery(
                        new Request(`https://example.test/api/charts?${query}`),
                        now,
                    ),
                ),
            ).rejects.toMatchObject({ _tag: 'ChartValidationError' });
        }
    });

    it('authenticates and encodes bounded chart responses', async () => {
        expect(() =>
            Schema.encodeUnknownSync(ChartResponse)(response),
        ).not.toThrow();
        const result = await app().request('/api/charts?range=30', {
            headers: {
                Cookie: `${config.sessionCookie.name}=session-token`,
            },
        });

        expect(result.status).toBe(200);
        expect(result.headers.get('cache-control')).toBe('no-store');
        await expect(decode(result, ChartResponse)).resolves.toMatchObject({
            window: { dayCount: 30 },
        });

        const invalid = await app().request('/api/charts?range=100', {
            headers: {
                Cookie: `${config.sessionCookie.name}=session-token`,
            },
        });
        expect(invalid.status).toBe(400);
        await expect(decode(invalid, ApiErrorResponse)).resolves.toMatchObject({
            error: { code: 'validation_error' },
        });
    });
});

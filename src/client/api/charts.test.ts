import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChartClientError, getCharts } from './charts';

const body = {
    window: {
        startDate: '2026-07-18',
        endDate: '2026-07-18',
        timeZone: 'UTC',
        dayCount: 1,
    },
    scope: { type: 'feed', id: 12, name: 'Example feed' },
    summary: {
        received: 1,
        currentlyRead: 1,
        currentlySaved: 0,
        currentUnread: 2,
        cohortReadThroughRate: 100,
        refreshAttempts: 1,
        refreshSuccesses: 1,
        refreshFailures: 0,
        refreshSuccessRate: 100,
        refreshEntriesCreated: 1,
    },
    days: [
        {
            date: '2026-07-18',
            received: 1,
            currentlyRead: 1,
            currentlyUnread: 0,
            currentlySaved: 0,
            cohortReadThroughRate: 100,
            markedRead: 1,
            markedUnread: 0,
            saved: 0,
            unsaved: 0,
            refreshSuccesses: 1,
            refreshFailures: 0,
            refreshEntriesCreated: 1,
        },
    ],
    activityCoverageStart: '2026-07-18',
};

afterEach(() => vi.unstubAllGlobals());

describe('ChartClient', () => {
    it('sends bounded custom dates and one scope', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(Response.json(body)));
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            Effect.runPromise(
                getCharts({
                    range: 'custom',
                    feedId: 12,
                    categoryId: null,
                    startDate: '2026-07-01',
                    endDate: '2026-07-18',
                }),
            ),
        ).resolves.toMatchObject({ scope: { type: 'feed', id: 12 } });

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/charts?range=custom&feed_id=12&start_date=2026-07-01&end_date=2026-07-18',
            expect.objectContaining({
                credentials: 'same-origin',
                method: 'GET',
            }),
        );
    });

    it('rejects malformed successful responses', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.json({ days: 'invalid' }))),
        );

        const error = await Effect.runPromise(
            getCharts({
                range: '30',
                feedId: null,
                categoryId: null,
                startDate: null,
                endDate: null,
            }),
        ).catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(ChartClientError);
        expect(error).toMatchObject({ kind: 'decode', status: 200 });
    });

    it('decodes safe API errors', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    Response.json(
                        {
                            error: {
                                code: 'validation_error',
                                message: 'Invalid chart query',
                            },
                        },
                        { status: 400 },
                    ),
                ),
            ),
        );

        const error = await Effect.runPromise(
            getCharts({
                range: '30',
                feedId: null,
                categoryId: null,
                startDate: null,
                endDate: null,
            }),
        ).catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(ChartClientError);
        expect(error).toMatchObject({
            kind: 'status',
            status: 400,
            code: 'validation_error',
            message: 'Invalid chart query',
        });
    });
});

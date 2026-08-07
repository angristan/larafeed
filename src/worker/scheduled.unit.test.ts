import { describe, expect, it, vi } from 'vitest';

import { runScheduledSubsystems } from './scheduled';

describe('scheduled subsystem isolation', () => {
    it('runs every subsystem and reports every failure', async () => {
        const refreshFailure = new Error('refresh failed');
        const faviconFailure = new Error('favicon failed');
        const refresh = vi.fn(async () => {
            throw refreshFailure;
        });
        const opml = vi.fn(async () => undefined);
        const favicon = vi.fn(async () => {
            throw faviconFailure;
        });

        let caught: unknown;
        try {
            await runScheduledSubsystems([refresh, opml, favicon]);
        } catch (error) {
            caught = error;
        }

        expect(refresh).toHaveBeenCalledOnce();
        expect(opml).toHaveBeenCalledOnce();
        expect(favicon).toHaveBeenCalledOnce();
        expect(caught).toBeInstanceOf(AggregateError);
        expect((caught as AggregateError).errors).toEqual([
            refreshFailure,
            faviconFailure,
        ]);
    });

    it('runs subsystems sequentially', async () => {
        const events: string[] = [];
        let releaseRefresh: (() => void) | undefined;
        const refreshBlocked = new Promise<void>((resolve) => {
            releaseRefresh = resolve;
        });
        const scheduled = runScheduledSubsystems([
            async () => {
                events.push('refresh:start');
                await refreshBlocked;
                events.push('refresh:end');
            },
            async () => {
                events.push('opml');
            },
            async () => {
                events.push('favicon');
            },
        ]);

        await vi.waitFor(() => {
            expect(events).toEqual(['refresh:start']);
        });
        releaseRefresh?.();
        await scheduled;

        expect(events).toEqual([
            'refresh:start',
            'refresh:end',
            'opml',
            'favicon',
        ]);
    });

    it('resolves when every subsystem succeeds', async () => {
        await expect(
            runScheduledSubsystems([
                async () => undefined,
                async () => undefined,
                async () => undefined,
            ]),
        ).resolves.toBeUndefined();
    });
});

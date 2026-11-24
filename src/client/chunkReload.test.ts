import { describe, expect, it } from 'vitest';

import { installChunkReload } from './chunkReload';

type ReloadTarget = Parameters<typeof installChunkReload>[0];
type ReloadStorage = Parameters<typeof installChunkReload>[1];

const makeTarget = () => {
    const listeners: Array<(event: { preventDefault: () => void }) => void> =
        [];
    const state = { reloads: 0 };

    const target = {
        addEventListener: (
            _type: string,
            listener: (event: { preventDefault: () => void }) => void,
        ) => {
            listeners.push(listener);
        },
        location: {
            reload: () => {
                state.reloads += 1;
            },
        },
    } as unknown as ReloadTarget;

    return { listeners, state, target };
};

const makeStorage = (): ReloadStorage => {
    const values = new Map<string, string>();

    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
    } as unknown as ReloadStorage;
};

const dispatch = (
    listeners: Array<(event: { preventDefault: () => void }) => void>,
): boolean => {
    let prevented = false;

    for (const listener of listeners) {
        listener({
            preventDefault: () => {
                prevented = true;
            },
        });
    }

    return prevented;
};

describe('installChunkReload', () => {
    it('reloads when a chunk fails to load after a deploy', () => {
        const { listeners, state, target } = makeTarget();

        installChunkReload(target, makeStorage(), () => 1_000);
        dispatch(listeners);

        expect(state.reloads).toBe(1);
    });

    it('keeps the error page instead of looping when the reload did not help', () => {
        const { listeners, state, target } = makeTarget();
        let clock = 1_000;

        installChunkReload(target, makeStorage(), () => clock);
        dispatch(listeners);

        clock = 4_000;
        dispatch(listeners);

        expect(state.reloads).toBe(1);
    });

    it('reloads again when the previous reload is older than the interval', () => {
        const { listeners, state, target } = makeTarget();
        let clock = 1_000;

        installChunkReload(target, makeStorage(), () => clock);
        dispatch(listeners);

        clock = 30_000;
        dispatch(listeners);

        expect(state.reloads).toBe(2);
    });

    it('prevents the default rejection while it reloads', () => {
        const { listeners, target } = makeTarget();

        installChunkReload(target, makeStorage(), () => 1_000);

        expect(dispatch(listeners)).toBe(true);
    });

    it('lets the failure reach the route error page when it does not reload', () => {
        const { listeners, target } = makeTarget();
        let clock = 1_000;

        installChunkReload(target, makeStorage(), () => clock);
        dispatch(listeners);

        clock = 4_000;

        expect(dispatch(listeners)).toBe(false);
    });
});

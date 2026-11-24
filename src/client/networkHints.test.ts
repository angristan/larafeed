import { afterEach, describe, expect, it } from 'vitest';

import { shouldPrefetchEntryDetails } from './networkHints';

const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
);

function setConnection(connection: unknown) {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { connection },
    });
}

afterEach(() => {
    if (originalNavigator === undefined) {
        Reflect.deleteProperty(globalThis, 'navigator');
        return;
    }

    Object.defineProperty(globalThis, 'navigator', originalNavigator);
});

describe('entry detail prefetching', () => {
    it('prefetches when the browser does not report a network state', () => {
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {},
        });

        expect(shouldPrefetchEntryDetails()).toBe(true);
    });

    it('prefetches when Data Saver is off', () => {
        setConnection({ saveData: false });

        expect(shouldPrefetchEntryDetails()).toBe(true);
    });

    it('does not prefetch when Data Saver is on', () => {
        setConnection({ saveData: true });

        expect(shouldPrefetchEntryDetails()).toBe(false);
    });
});

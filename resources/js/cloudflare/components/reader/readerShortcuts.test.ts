import { describe, expect, it } from 'vitest';

import { isShortcutHelpKey } from './readerShortcuts';

const key = (
    overrides: Partial<Parameters<typeof isShortcutHelpKey>[0]> = {},
): Parameters<typeof isShortcutHelpKey>[0] => ({
    key: '?',
    shiftKey: true,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
});

describe('isShortcutHelpKey', () => {
    it('accepts Shift+?', () => {
        expect(isShortcutHelpKey(key())).toBe(true);
    });

    it('rejects modified and unrelated keys', () => {
        expect(isShortcutHelpKey(key({ ctrlKey: true }))).toBe(false);
        expect(isShortcutHelpKey(key({ key: '/', shiftKey: false }))).toBe(
            false,
        );
    });
});

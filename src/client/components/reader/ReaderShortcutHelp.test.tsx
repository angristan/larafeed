import { describe, expect, it } from 'vitest';

import { modifierKeyLabel } from './ReaderShortcutHelp';

describe('modifierKeyLabel', () => {
    it('shows Command only on Apple platforms', () => {
        expect(modifierKeyLabel('MacIntel')).toBe('⌘');
        expect(modifierKeyLabel('iPhone')).toBe('⌘');
        expect(modifierKeyLabel('Win32')).toBe('Ctrl');
        expect(modifierKeyLabel('Linux x86_64')).toBe('Ctrl');
    });
});

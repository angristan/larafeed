import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatDocumentTitle, setDocumentTitle } from './documentTitle';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('document titles', () => {
    it.each([
        ['Feeds', 'Feeds - Larafeed'],
        ['Log in', 'Log in - Larafeed'],
        ['Create your passkey', 'Create your passkey - Larafeed'],
        ['Recover your account', 'Recover your account - Larafeed'],
        ['Page not found', 'Page not found - Larafeed'],
        ['Something went wrong', 'Something went wrong - Larafeed'],
    ])('formats %s as %s', (pageTitle, expected) => {
        expect(formatDocumentTitle(pageTitle)).toBe(expected);
    });

    it('cleans up without replacing a newer route title', () => {
        const titleState = { title: 'Larafeed' };
        vi.stubGlobal('document', titleState);

        const cleanReaderTitle = setDocumentTitle('Feeds');
        const cleanLoginTitle = setDocumentTitle('Log in');

        cleanReaderTitle();
        expect(titleState.title).toBe('Log in - Larafeed');

        cleanLoginTitle();
        expect(titleState.title).toBe('Larafeed');
    });

    it('ignores stale cleanup when consecutive routes use the same title', () => {
        const titleState = { title: 'Larafeed' };
        vi.stubGlobal('document', titleState);

        const cleanFirstError = setDocumentTitle('Something went wrong');
        const cleanSecondError = setDocumentTitle('Something went wrong');

        cleanFirstError();
        expect(titleState.title).toBe('Something went wrong - Larafeed');

        cleanSecondError();
        expect(titleState.title).toBe('Larafeed');
    });

    it('does not replace a title owned outside the route effect', () => {
        const titleState = { title: 'Larafeed' };
        vi.stubGlobal('document', titleState);

        const cleanup = setDocumentTitle('Feeds');
        titleState.title = 'External title';
        cleanup();

        expect(titleState.title).toBe('External title');
    });
});

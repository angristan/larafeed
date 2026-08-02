import { describe, expect, it } from 'vitest';

import { estimateReadingTime, textFromSanitizedHtml } from './readingTime';

describe('estimateReadingTime', () => {
    it('counts Unicode words without splitting accents or apostrophes', () => {
        expect(
            estimateReadingTime('Café naïve coöperate — l’été. 你好世界'),
        ).toEqual({ words: 6, minutes: 1 });
    });

    it('rounds up at 300 words per minute', () => {
        const text = Array.from(
            { length: 301 },
            (_, index) => `word${index}`,
        ).join(' ');

        expect(estimateReadingTime(text)).toEqual({ words: 301, minutes: 2 });
        expect(estimateReadingTime('   ')).toEqual({ words: 0, minutes: 0 });
    });

    it('extracts displayed text from sanitized article HTML', () => {
        expect(
            textFromSanitizedHtml(
                '<h2>Hello&nbsp;world</h2><p>Café &amp; feeds</p>',
            ).replace(/\s+/g, ' '),
        ).toBe(' Hello world Café & feeds ');
    });

    it('rejects invalid reading speeds', () => {
        expect(() => estimateReadingTime('words', 0)).toThrow(RangeError);
    });
});

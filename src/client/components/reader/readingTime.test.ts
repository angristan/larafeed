import { describe, expect, it } from 'vitest';

import {
    estimateReadingTime,
    readingTimeLabel,
    textFromSanitizedHtml,
} from './readingTime';

describe('estimateReadingTime', () => {
    it('counts Unicode words without splitting accents or apostrophes', () => {
        expect(
            estimateReadingTime('Café naïve coöperate — l’été. 你好世界'),
        ).toEqual({ words: 8, minutes: 0 });
    });

    it('rounds to the nearest minute and formats short reads', () => {
        const words = (count: number) =>
            Array.from({ length: count }, (_, index) => `word${index}`).join(
                ' ',
            );

        expect(estimateReadingTime(words(149))).toEqual({
            words: 149,
            minutes: 0,
        });
        expect(estimateReadingTime(words(150))).toEqual({
            words: 150,
            minutes: 1,
        });
        expect(estimateReadingTime(words(301))).toEqual({
            words: 301,
            minutes: 1,
        });
        expect(estimateReadingTime(words(450))).toEqual({
            words: 450,
            minutes: 2,
        });
        expect(readingTimeLabel(estimateReadingTime(words(149)))).toBe(
            'less than a minute read',
        );
        expect(readingTimeLabel(estimateReadingTime(words(450)))).toBe(
            '2 min read',
        );
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

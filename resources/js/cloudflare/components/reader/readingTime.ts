const WORDS_PER_MINUTE = 300;

const wordSegmenter =
    typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'word' })
        : null;

export interface ReadingTimeEstimate {
    readonly minutes: number;
    readonly words: number;
}

export function estimateReadingTime(
    text: string,
    wordsPerMinute = WORDS_PER_MINUTE,
): ReadingTimeEstimate {
    if (!Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0) {
        throw new RangeError('Words per minute must be a positive number.');
    }

    const words =
        wordSegmenter === null
            ? (text.match(/[\p{L}\p{M}\p{N}]+/gu)?.length ?? 0)
            : [...wordSegmenter.segment(text)].filter(
                  (segment) => segment.isWordLike,
              ).length;

    return {
        words,
        minutes:
            words === 0 ? 0 : Math.max(1, Math.ceil(words / wordsPerMinute)),
    };
}

/**
 * Entry HTML is sanitized by the Worker before it reaches this function.
 * DOMParser gives us the same decoded text that the article displays.
 */
export function textFromSanitizedHtml(html: string): string {
    if (typeof DOMParser === 'undefined') {
        return html
            .replace(/<[^>]*>/g, ' ')
            .replace(/&(?:nbsp|#160);/gi, ' ')
            .replace(/&(?:amp|#38);/gi, '&')
            .replace(/&(?:lt|#60);/gi, '<')
            .replace(/&(?:gt|#62);/gi, '>')
            .replace(/&(?:quot|#34);/gi, '"')
            .replace(/&#(?:39|x27);/gi, "'");
    }

    return (
        new DOMParser().parseFromString(html, 'text/html').body.textContent ??
        ''
    );
}

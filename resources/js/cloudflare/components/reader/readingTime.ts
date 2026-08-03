const WORDS_PER_MINUTE = 300;

const readingTimeTokenPattern =
    /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

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

    const words = text.match(readingTimeTokenPattern)?.length ?? 0;

    return {
        words,
        minutes: Math.round(words / wordsPerMinute),
    };
}

export function readingTimeLabel(estimate: ReadingTimeEstimate): string {
    return estimate.minutes < 1
        ? 'less than a minute read'
        : `${estimate.minutes} min read`;
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

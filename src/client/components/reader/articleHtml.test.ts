import { DOMParser as LinkedomParser } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareArticleHtml } from './articleHtml';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('prepareArticleHtml', () => {
    it('parses the article once for its links and its text', () => {
        let parses = 0;
        const parser = new LinkedomParser();
        vi.stubGlobal(
            'DOMParser',
            class {
                parseFromString(html: string, type: 'text/html') {
                    parses += 1;
                    return parser.parseFromString(html, type);
                }
            },
        );

        // Unlike browsers, linkedom only fills body for a full document.
        const article = prepareArticleHtml(
            '<html><body><p>Read <a href="https://example.com" rel="author">this</a> now</p></body></html>',
        );

        expect(parses).toBe(1);
        expect(article.text).toBe('Read this now');
        expect(article.html).toContain('target="_blank"');
        expect(article.html).toContain('rel="author noopener noreferrer"');
    });
});

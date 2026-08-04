import { describe, expect, it } from 'vitest';

import { sanitizeArticleHtml } from './sanitize';

const baseUrl = 'https://feeds.example.com/articles/entry.xml';

describe('article HTML sanitizer', () => {
    it('preserves basic markup and resolves safe relative URLs', () => {
        const html = sanitizeArticleHtml(
            '<p>Hello <strong>reader</strong>. <a href="../story">Read</a></p>',
            baseUrl,
        );

        expect(html).toBe(
            '<p>Hello <strong>reader</strong>. <a href="https://feeds.example.com/story">Read</a></p>',
        );
    });

    it('removes executable elements, their bodies, and active attributes', () => {
        const html = sanitizeArticleHtml(
            '<div onclick="steal()" style="display:none"><script>alert(1)</script><style>body{}</style><iframe src="https://evil.example">fallback</iframe><form><input></form><p onmouseover="x" srcdoc="x">Safe</p></div>',
            baseUrl,
        );

        expect(html).toBe('<div><p>Safe</p></div>');
        expect(html).not.toMatch(/script|style|iframe|form|onmouse|srcdoc/iu);
    });

    it.each([
        'javascript:alert(1)',
        'java&#x73;cript:alert(1)',
        'jav&#97;script:alert(1)',
        'java\nscript:alert(1)',
        'vbscript:msgbox(1)',
        'data:text/html;base64,PHNjcmlwdD4=',
    ])('drops unsafe link URL %s', (url) => {
        expect(sanitizeArticleHtml(`<a href="${url}">link</a>`, baseUrl)).toBe(
            '<a>link</a>',
        );
    });

    it('rejects data images by default and allows only explicit safe image data', () => {
        const image = 'data:image/png;base64,iVBORw0KGgo=';
        expect(sanitizeArticleHtml(`<img src="${image}">`, baseUrl)).toBe(
            '<img>',
        );
        expect(
            sanitizeArticleHtml(`<img src="${image}">`, baseUrl, {
                allowDataImages: true,
            }),
        ).toBe(`<img src="${image}">`);
        expect(
            sanitizeArticleHtml(
                '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
                baseUrl,
                { allowDataImages: true },
            ),
        ).toBe('<img>');
    });

    it('drops comments, metadata, and unsafe URL credentials', () => {
        const html = sanitizeArticleHtml(
            '<!-- secret --><base href="https://evil.example"><meta http-equiv="refresh"><link href="x"><p><img src="https://user:secret@example.com/a.png" alt="x"></p>',
            baseUrl,
        );

        expect(html).toBe('<p><img alt="x"></p>');
        expect(html).not.toContain('secret');
    });
});

import { describe, expect, it } from 'vitest';
import { extractArticle } from './extract';
import { decodeHtmlBytes } from './fetch';

const paragraph = (index: number): string =>
    `<p>Paragraph ${index}: the quick brown fox jumps over the lazy dog, ` +
    'again and again, to make this article long enough for extraction to ' +
    'consider it the main content of the page.</p>';

const articleBody = Array.from({ length: 12 }, (_, index) =>
    paragraph(index + 1),
).join('\n');

const page = `<!doctype html>
<html>
<head><title>Extraction test page</title></head>
<body>
    <nav><ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li></ul></nav>
    <header><h1>Site name</h1></header>
    <article>
        <h1>The actual article</h1>
        ${articleBody}
        <p>It even has an image: <img src="/images/figure.png" alt="figure"></p>
    </article>
    <aside>Related links and other noise.</aside>
    <footer>Copyright notice.</footer>
</body>
</html>`;

describe('extractArticle', () => {
    it('extracts the main article content from a page', () => {
        const extracted = extractArticle(page);
        expect(extracted).not.toBeNull();
        expect(extracted?.title).toBe('Extraction test page');
        expect(extracted?.html).toContain('Paragraph 1');
        expect(extracted?.html).toContain('Paragraph 12');
        expect(extracted?.html).not.toContain('Copyright notice');
    });

    it('keeps relative image URLs for later base resolution', () => {
        const extracted = extractArticle(page);
        expect(extracted?.html).toContain('/images/figure.png');
    });

    it('returns null when no article can be found', () => {
        expect(extractArticle('<html><body></body></html>')).toBeNull();
        expect(extractArticle('not html at all')).toBeNull();
    });
});

describe('decodeHtmlBytes', () => {
    const utf8 = new TextEncoder();

    it('decodes UTF-8 by default', () => {
        expect(decodeHtmlBytes(utf8.encode('héllo'), null)).toBe('héllo');
    });

    it('honors the content-type charset parameter', () => {
        const latin1 = Uint8Array.from([0x68, 0xe9]); // "hé" in ISO-8859-1
        expect(decodeHtmlBytes(latin1, 'text/html; charset=iso-8859-1')).toBe(
            'hé',
        );
    });

    it('sniffs a meta charset declaration', () => {
        const head = '<html><head><meta charset="iso-8859-1"></head>';
        const bytes = Uint8Array.from([
            ...utf8.encode(head),
            0x68,
            0xe9, // "hé" in ISO-8859-1
        ]);
        expect(decodeHtmlBytes(bytes, 'text/html')).toContain('hé');
    });

    it('falls back to UTF-8 on an unknown charset label', () => {
        expect(
            decodeHtmlBytes(utf8.encode('héllo'), 'text/html; charset=bogus-9'),
        ).toBe('héllo');
    });
});

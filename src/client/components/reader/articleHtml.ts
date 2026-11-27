import { textFromSanitizedHtml } from './readingTime';

function externalizeLinks(doc: Document): void {
    for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        anchor.target = '_blank';
        const rel = new Set(anchor.rel.split(/\s+/u).filter(Boolean));
        rel.add('noopener');
        rel.add('noreferrer');
        anchor.rel = [...rel].join(' ');
    }
}

// Article links must open in a new tab. The attributes are baked into
// the HTML string before rendering because React re-applies
// dangerouslySetInnerHTML on re-renders, which reverted attributes that
// were patched into the live DOM after the fact.
export function externalizeArticleLinks(html: string): string {
    if (typeof DOMParser === 'undefined') return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    externalizeLinks(doc);
    return doc.body.innerHTML;
}

export interface PreparedArticle {
    /** The article HTML with links that open in a new tab. */
    readonly html: string;
    /** The displayed text, for the reading time estimate. */
    readonly text: string;
}

/**
 * Parses sanitized entry HTML once for both the rendered markup and the
 * reading time text. Long articles are expensive to parse, and the entry
 * pane needs both on every open.
 */
export function prepareArticleHtml(html: string): PreparedArticle {
    if (typeof DOMParser === 'undefined') {
        return { html, text: textFromSanitizedHtml(html) };
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = doc.body.textContent ?? '';
    externalizeLinks(doc);
    return { html: doc.body.innerHTML, text };
}

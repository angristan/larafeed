// Article links must open in a new tab. The attributes are baked into
// the HTML string before rendering because React re-applies
// dangerouslySetInnerHTML on re-renders, which reverted attributes that
// were patched into the live DOM after the fact.
export function externalizeArticleLinks(html: string): string {
    if (typeof DOMParser === 'undefined') return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        anchor.target = '_blank';
        const rel = new Set(anchor.rel.split(/\s+/u).filter(Boolean));
        rel.add('noopener');
        rel.add('noreferrer');
        anchor.rel = [...rel].join(' ');
    }
    return doc.body.innerHTML;
}
